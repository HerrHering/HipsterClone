import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";

/**
 * Writes apps/web/public/manifest.json from successfully-downloaded songs only,
 * so a partial scrape run still yields a consistent, playable library.
 */
export async function buildManifest(
  entries: SongManifestEntry[],
  outPath: string,
): Promise<SongManifest> {
  const manifest: SongManifest = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    songs: entries,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  return manifest;
}
