import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";

/**
 * Writes apps/web/public/manifest.json from successfully-downloaded songs only,
 * so a partial scrape run still yields a consistent, playable library.
 * Implemented in Phase 1.
 */
export async function buildManifest(
  _entries: SongManifestEntry[],
  _outPath: string,
): Promise<SongManifest> {
  throw new Error("not implemented yet (Phase 1)");
}
