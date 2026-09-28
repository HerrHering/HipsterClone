// Entry point for the (mostly) automated catalog-resolution script.
// Run manually via `npm run scrape` (from the repo root) or `npm run scrape -w
// @hipster-clone/scraper`. Never run in the browser or CI.
//
// Reads every hand-filled active_*.csv under data/ (artist,title,year — all
// three hand-typed, no id, no link) and, for each row, derives an id from the
// three fields and either:
//   - reuses a link resolved on a previous run (cheap re-runs, no repeat
//     searches), or
//   - resolves a new YouTube link automatically via resolveSource.
//
// inactive_*.csv files are never read — their content only matters once a
// file is renamed to active_ and this script reruns. Instead, every song
// from the *previous* manifest that isn't part of this run's active batch
// (its file is currently named inactive_*.csv, or its row was deleted
// outright) is carried forward unchanged except for being flagged
// `active: false`, so its resolved audio survives indefinitely and
// reactivating it later needs no re-resolving. See SongManifestEntry.active.
//
// No audio bytes are ever downloaded here — only a manifest.json describing
// where to find each song is written. apps/api is what actually downloads and
// caches audio, the first time a browser asks to play a song.
//
// One-off manual song: there's no dedicated override mechanism in this
// script — for the rare case, hand-edit the entry's audio.videoId directly
// in manifest.json to point at a different YouTube video. That edit sticks:
// the "reuse" step below copies forward whatever entry a previous run
// already has for a given id, so it isn't clobbered by the next
// `npm run scrape` as long as the id (derived from title/artist/year)
// doesn't change.
//
// Set HIPSTER_DEBUG=1 to see why a previous manifest failed to load (see
// loadPreviousManifest below) — silent otherwise, since falling back to "no
// previous manifest" and just re-resolving everything is a safe, working
// outcome that doesn't need to alarm a normal run.

// Side-effect import, kept first so console.warn/console.error are already
// colored before anything below (or in resolveSource.ts) can log.
import "./colorConsole.js";

import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import { parse } from "csv-parse/sync";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "./buildManifest.js";
import { resolveSource } from "./resolveSource.js";
import { slugify } from "./slug.js";

const DEBUG = process.env.HIPSTER_DEBUG === "1";

// `import.meta.url` is this file's own location as a `file://...` URL;
// `fileURLToPath` + `dirname` turn that into "the folder this file lives
// in" as an ordinary filesystem path, which is what `resolve` below needs.
const here = dirname(fileURLToPath(import.meta.url));
// LOCAL FILESYSTEM PATH — the hand-edited input files. Never sent anywhere.
const dataDir = resolve(here, "../data");
// LOCAL FILESYSTEM PATH — the generated output file this script writes and
// apps/web serves as a static asset (see App.tsx's `fetch("/manifest.json")`).
const manifestPath = resolve(here, "../../../apps/web/public/manifest.json");

// Every song-list CSV in data/ must be named active_<name>.csv or
// inactive_<name>.csv — the prefix is how a whole collection is turned on or
// off (see SongManifestEntry.active), just by renaming the file and
// rerunning this script. Only active_*.csv files are actually read (see
// findActiveSongListFiles below); an inactive_*.csv's presence is still
// logged under HIPSTER_DEBUG for visibility, but its rows are never parsed.
const SONG_LIST_PATTERN = /^(active|inactive)_.+\.csv$/;

interface SongRow {
  artist: string;
  title: string;
  year: string;
}

function findActiveSongListFiles(): string[] {
  const files = readdirSync(dataDir).filter((name) => name.endsWith(".csv"));
  const activePaths: string[] = [];
  for (const name of files.sort()) {
    const match = SONG_LIST_PATTERN.exec(name);
    if (!match) {
      console.warn(
        `skipping ${name}: song-list CSVs must be named active_<name>.csv or inactive_<name>.csv`,
      );
      continue;
    }
    const active = match[1] === "active";
    if (DEBUG) {
      console.log(`found song list ${name} (active: ${active})`);
    }
    if (active) {
      activePaths.push(resolve(dataDir, name));
    }
  }
  return activePaths;
}

// Helper for the reuse step below — reads last run's output so this run can
// skip re-resolving a link it already found.
async function loadPreviousManifest(): Promise<SongManifest | null> {
  // No file yet (e.g. the very first run) is completely normal — not an
  // error at all, so it's handled before the try/catch below rather than by
  // letting `readFile` throw and catching that.
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(manifestPath, "utf-8")) as SongManifest;
  } catch (error) {
    // A file that exists but fails to parse (truncated/corrupted JSON) is
    // unusual but non-fatal — the code below just treats it the same as "no
    // previous manifest" and re-resolves every row from scratch. Only worth
    // mentioning under HIPSTER_DEBUG; a normal run doesn't need to be
    // alarmed by something it's already recovering from gracefully.
    if (DEBUG) {
      console.warn(
        `loadPreviousManifest: ${manifestPath} exists but failed to parse, ignoring it: ${errorMessage(error)}`,
      );
    }
    return null;
  }
}

// Reads every active_*.csv, runs every row through the pipeline below, then
// writes manifest.json.
async function main() {
  const activeListPaths = findActiveSongListFiles();

  const rows: SongRow[] = [];
  for (const path of activeListPaths) {
    const csvText = await readFile(path, "utf-8");
    // `columns: true` reads the first CSV line as header names and returns
    // objects keyed by those headers (e.g. `{ artist: "Queen", title: ...}`)
    // instead of plain arrays of cell values.
    const parsed: SongRow[] = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
    });
    rows.push(...parsed);
  }

  const previousManifest = await loadPreviousManifest();
  // A `Map` keyed by id, built once up front, so the reuse check below is a
  // single O(1) lookup per row instead of re-scanning the whole previous
  // songs array for every row.
  const previousEntriesById = new Map(
    (previousManifest?.songs ?? []).map((entry) => [entry.id, entry]),
  );

  const entries: SongManifestEntry[] = [];
  // Every id seen in this run's active batch, whether reused or freshly
  // resolved — used below to tell "still active" apart from "not part of
  // this run, so it must have moved to an inactive_*.csv (or been deleted)
  // and should just be flagged inactive" without ever reading inactive files.
  const activeIds = new Set<string>();

  // The per-row pipeline: each row runs through as many of these 3 steps as
  // it needs, in order, and `continue`s out as soon as it has an answer.
  for (const [index, row] of rows.entries()) {
    // Step 1 — require a year, then derive the id. All three CSV fields are
    // hand-typed; there's no automatic lookup for a blank one.
    if (!row.year || row.year.trim() === "") {
      console.warn(
        `skipping "${row.title}" by "${row.artist}": year is required`,
      );
      continue;
    }

    const id = slugify(`${row.title}-${row.artist}-${row.year}`);
    const year = Number(row.year);
    activeIds.add(id);

    // Step 2 — reuse: whatever entry a previous run already produced for
    // this id needs no new search. This is also what makes a hand-edit to
    // an entry's audio.videoId in manifest.json stick across reruns instead
    // of being silently overwritten by a fresh resolveSource call.
    const previous = previousEntriesById.get(id);
    if (previous) {
      // Defensive normalization for manifests written before an entry could
      // hold multiple candidates: `audio` used to be a single object, not an
      // array. Wrapping it here (rather than requiring a full re-scrape)
      // means existing songs migrate to the new shape for free, with zero
      // new YouTube requests — only genuinely new/re-resolved songs get more
      // than one candidate.
      const audio = Array.isArray(previous.audio) ? previous.audio : [previous.audio];
      entries.push({ ...previous, audio, active: true });
      if (DEBUG) {
        console.log(
          `(${index + 1}/${rows.length}) Reused entry in manifest for "${row.title}" by "${row.artist}"`,
        );
      }
      continue;
    }

    // Step 3 — resolve a new link (calls resolveSource.ts's own pipeline).
    console.log(
      `(${index + 1}/${rows.length}) resolving source for "${row.title}" by "${row.artist}"...`,
    );
    const resolved = await resolveSource(row.title, row.artist);
    if (!resolved) {
      console.warn(
        `skipping "${row.title}" by "${row.artist}": could not resolve a source`,
      );
      continue;
    }

    entries.push({
      id,
      title: row.title,
      artist: row.artist,
      year,
      active: true,
      // `resolved` is already an array of up to 3 candidates, best-first —
      // see resolveSource's own docs for why more than one gets kept.
      // `videoId` on each is just an 11-character YouTube id; turning it
      // into an actual playable URL happens later, in downloadClip.ts.
      audio: resolved,
    });
    if (DEBUG) {
      console.log(
        `Added new entry to manifest "${row.title}" by "${row.artist}"`,
      );
    }
  }

  // Carry forward everything from the previous manifest that this run's
  // active batch didn't touch — flagged inactive, audio untouched — so
  // songs living in an inactive_*.csv (never read above) stay available and
  // instantly reactivatable instead of disappearing from the manifest.
  for (const [id, previous] of previousEntriesById) {
    if (activeIds.has(id)) {
      continue;
    }
    entries.push({ ...previous, active: false });
  }

  const manifest = await buildManifest(entries, manifestPath);
  console.log(`wrote ${manifest.songs.length} song(s) to ${manifestPath}`);
}

main();
