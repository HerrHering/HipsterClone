// Entry point for the (mostly) automated catalog-resolution script.
// Run manually via `npm run scrape` (from the repo root) or `npm run scrape -w
// @hipster-clone/scraper`. Never run in the browser or CI.
//
// Phase 2: reads the hand-filled data/songs.csv (artist,title,year — no id, no
// link), derives an id from all three fields, and for each row either:
//   - reuses a hand-downloaded local mp3 if one already exists at that id
//     (also the manual override: drop a corrected mp3 there to bypass
//     automated resolution for a specific song), or
//   - reuses a link resolved on a previous run (cheap re-runs, no repeat
//     searches), or
//   - resolves a new YouTube link automatically via resolveSource.
//
// No audio bytes are ever downloaded here — only a manifest.json describing
// where to find each song is written. apps/api is what actually downloads and
// caches audio, the first time a browser asks to play an "embedded-link" song.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { buildManifest } from "./buildManifest.js";
import { resolveSource } from "./resolveSource.js";
import { slugify } from "./slug.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = resolve(here, "../data/songs.csv");
const audioDir = resolve(here, "../../../apps/web/public/audio");
const manifestPath = resolve(here, "../../../apps/web/public/manifest.json");

interface SongRow {
  artist: string;
  title: string;
  year: string;
}

async function loadPreviousManifest(): Promise<SongManifest | null> {
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(manifestPath, "utf-8")) as SongManifest;
  } catch {
    return null;
  }
}

async function main() {
  const csvText = await readFile(csvPath, "utf-8");
  const rows: SongRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
  });

  const previousManifest = await loadPreviousManifest();
  const previousEntriesById = new Map(
    (previousManifest?.songs ?? []).map((entry) => [entry.id, entry]),
  );

  const entries: SongManifestEntry[] = [];

  for (const row of rows) {
    const id = slugify(`${row.title}-${row.artist}-${row.year}`);
    const year = Number(row.year);
    const localAudioPath = resolve(audioDir, `${id}.mp3`);

    if (existsSync(localAudioPath)) {
      entries.push({
        id,
        title: row.title,
        artist: row.artist,
        year,
        audio: { kind: "local-file", ref: `/audio/${id}.mp3` },
      });
      continue;
    }

    const previous = previousEntriesById.get(id);
    if (previous && previous.audio.kind === "embedded-link") {
      entries.push(previous);
      continue;
    }

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
        kind: "embedded-link",
        ref: resolved.videoId,
        durationSec: resolved.durationSec,
      },
    });
  }

  const manifest = await buildManifest(entries, manifestPath);
  console.log(`wrote ${manifest.songs.length} song(s) to ${manifestPath}`);
}

main();
