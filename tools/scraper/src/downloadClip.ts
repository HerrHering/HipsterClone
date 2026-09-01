/**
 * Downloads audio for a resolved YouTube video id via `yt-dlp`, then cuts a
 * short clip with `ffmpeg` into data/cache/<songId>.mp3. Implemented in Phase 2 —
 * Phase 1 downloads songs by hand instead (see PHASE-1-SUMMARY.md).
 */
export async function downloadClip(
  _songId: string,
  _videoId: string,
  _cacheDir: string,
): Promise<{ filePath: string; durationSec: number } | null> {
  throw new Error("not implemented yet (Phase 1)");
}
