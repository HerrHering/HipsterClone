// Entry point for the one-time offline content-prep script.
// Run manually via `npm run scrape` (from the repo root) or `npm run scrape -w
// @hipster-clone/scraper`. Never run in the browser or CI.
//
// Phase 1: reads the hand-filled data/songs.csv, checks that a matching mp3 already
// exists under apps/web/public/audio/ (downloaded by hand — see PHASE-1-SUMMARY.md
// for the exact commands), and writes apps/web/public/manifest.json from the songs
// that have one. Rows with no matching audio file are skipped with a warning rather
// than failing the whole run.
//
// Phase 2 will replace the hand-download step with resolveSource + downloadClip,
// so this script's csv-parsing and manifest-writing logic stays the same — only
// where the audio files come from changes.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import type { SongManifestEntry } from "@hipster-clone/shared";
import { buildManifest } from "./buildManifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = resolve(here, "../data/songs.csv");
const audioDir = resolve(here, "../../../apps/web/public/audio");
const manifestPath = resolve(here, "../../../apps/web/public/manifest.json");

interface SongRow {
  id: string;
  title: string;
  artist: string;
  year: string;
}

async function main() {
  const csvText = await readFile(csvPath, "utf-8");
  const rows: SongRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
  });

  const entries: SongManifestEntry[] = [];

  for (const row of rows) {
    const audioPath = resolve(audioDir, `${row.id}.mp3`);
    if (!existsSync(audioPath)) {
      console.warn(`skipping "${row.id}": no audio file at ${audioPath}`);
      continue;
    }

    entries.push({
      id: row.id,
      title: row.title,
      artist: row.artist,
      year: Number(row.year),
      audio: { kind: "local-file", ref: `/audio/${row.id}.mp3` },
    });
  }

  const manifest = await buildManifest(entries, manifestPath);
  console.log(`wrote ${manifest.songs.length} song(s) to ${manifestPath}`);
}

main();
