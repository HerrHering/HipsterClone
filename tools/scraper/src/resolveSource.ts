export interface ResolvedSource {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  confidence: number;
}

/**
 * Resolves a title+artist to a candidate YouTube video via `yt-dlp` search,
 * scored by title/artist similarity and plausible duration. Implemented in Phase 2 —
 * Phase 1 resolves songs by hand instead (see PHASE-1-SUMMARY.md).
 */
export async function resolveSource(
  _title: string,
  _artist: string,
): Promise<ResolvedSource | null> {
  throw new Error("not implemented yet (Phase 1)");
}
