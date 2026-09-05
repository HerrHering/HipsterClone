// Entry point for the (mostly) automated catalog-resolution script.
// Run manually via `npm run scrape` (from the repo root) or `npm run scrape -w
// @hipster-clone/scraper`. Never run in the browser or CI.
//
// Reads the hand-filled data/songs.csv (artist,title,year — all three
// hand-typed, no id, no link) and, for each row, derives an id from the
// three fields and either:
//   - reuses a link resolved on a previous run (cheap re-runs, no repeat
//     searches), or
//   - resolves a new YouTube link automatically via resolveSource.
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

import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { parse } from "csv-parse/sync";
import { existsSync } from "node:fs";
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
// LOCAL FILESYSTEM PATH — the hand-edited input file. Never sent anywhere.
const csvPath = resolve(here, "../data/songs.csv");
// LOCAL FILESYSTEM PATH — the generated output file this script writes and
// apps/web serves as a static asset (see App.tsx's `fetch("/manifest.json")`).
const manifestPath = resolve(here, "../../../apps/web/public/manifest.json");

interface SongRow {
  artist: string;
  title: string;
  year: string;
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
        `loadPreviousManifest: ${manifestPath} exists but failed to parse, ignoring it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
}

// Reads the CSV, runs every row through the pipeline below, then writes
// manifest.json.
async function main() {
  const csvText = await readFile(csvPath, "utf-8");
  // `columns: true` reads the first CSV line as header names and returns
  // objects keyed by those headers (e.g. `{ artist: "Queen", title: ...}`)
  // instead of plain arrays of cell values.
  const rows: SongRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
  });

  const previousManifest = await loadPreviousManifest();
  // A `Map` keyed by id, built once up front, so the reuse check below is a
  // single O(1) lookup per row instead of re-scanning the whole previous
  // songs array for every row.
  const previousEntriesById = new Map(
    (previousManifest?.songs ?? []).map((entry) => [entry.id, entry]),
  );

  const entries: SongManifestEntry[] = [];

  // The per-row pipeline: each row runs through as many of these 3 steps as
  // it needs, in order, and `continue`s out as soon as it has an answer.
  for (const row of rows) {
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

    // Step 2 — reuse: whatever entry a previous run already produced for
    // this id needs no new search. This is also what makes a hand-edit to
    // an entry's audio.videoId in manifest.json stick across reruns instead
    // of being silently overwritten by a fresh resolveSource call.
    const previous = previousEntriesById.get(id);
    if (previous) {
      entries.push(previous);
      if (DEBUG) {
        console.log(
          `Reused entry in manifest for "${row.title}" by "${row.artist}"`,
        );
      }
      continue;
    }

    // Step 3 — resolve a new link (calls resolveSource.ts's own pipeline).
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
      audio: {
        // `videoId` is just an 11-character YouTube id here — turning it
        // into an actual playable URL happens later, in downloadClip.ts.
        videoId: resolved.videoId,
        videoTitle: resolved.videoTitle,
        channel: resolved.channel,
        durationSec: resolved.durationSec,
        confidence: resolved.confidence,
      },
    });
    if (DEBUG) {
      console.log(
        `Added new entry to manifest "${row.title}" by "${row.artist}"`,
      );
    }
  }

  const manifest = await buildManifest(entries, manifestPath);
  console.log(`wrote ${manifest.songs.length} song(s) to ${manifestPath}`);
}

main();
