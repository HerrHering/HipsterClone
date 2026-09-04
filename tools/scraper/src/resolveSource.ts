import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// yt-dlp needs a recent build to solve YouTube's JS signature challenges
// (see downloadClip.ts) — prefer the project's own .venv if one was set up
// (`python3 -m venv .venv && .venv/bin/pip install -U yt-dlp`), and only
// fall back to whatever "yt-dlp" resolves to on PATH otherwise.
const venvYtDlp = resolve(repoRoot, ".venv/bin/yt-dlp");
const YTDLP_BIN = existsSync(venvYtDlp) ? venvYtDlp : "yt-dlp";

const SEARCH_RESULT_COUNT = 5;
const CONFIDENCE_WARN_THRESHOLD = 0.4;
const PLAUSIBLE_DURATION_RANGE: [number, number] = [60, 900]; // 1–15 minutes

// Scoring weights — the three positive weights sum to 1.0 (a perfect match
// scores 1), and the non-original penalty is subtracted on top of that, so a
// title that overlaps well but looks like a cover/live version can still
// land below a title that overlaps less but looks canonical.
const TITLE_OVERLAP_WEIGHT = 0.6;
const ARTIST_MENTIONED_WEIGHT = 0.25;
const DURATION_PLAUSIBLE_WEIGHT = 0.15;
const NON_ORIGINAL_PENALTY = 0.3;

const NON_ORIGINAL_KEYWORDS = [
  "cover",
  "live",
  "reaction",
  "karaoke",
  "tutorial",
  "remix",
  "parody",
  "8-bit",
  "8 bit",
  "nightcore",
  "sped up",
  "slowed",
];
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "official",
  "video",
  "audio",
  "music",
  "hd",
  "hq",
  "ft",
  "feat",
  "featuring",
  "lyrics",
  "lyric",
]);

export interface ResolvedSource {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  confidence: number;
}

interface RawCandidate {
  id: string;
  title: string;
  channel?: string | null;
  uploader?: string | null;
  duration?: number | null;
}

// Lowercases, strips "(Official Video)"/"[Lyrics]"-style bracketed noise and
// punctuation, and collapses whitespace — the shared cleanup step every
// title/artist/channel string goes through exactly once before comparison.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[([][^)\]]*[)\]]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Splits already-normalized text into words, dropping filler ("official",
// "video", "feat", ...) that would otherwise inflate overlap scores without
// actually indicating a title match.
function wordsOf(normalizedText: string): string[] {
  return normalizedText.split(" ").filter((word) => word.length > 0 && !STOPWORDS.has(word));
}

// Fraction of the target title's significant words that also appear in the
// candidate's title — the strongest signal that this is the right song.
function titleOverlapScore(targetWords: string[], candidateWords: Set<string>): number {
  if (targetWords.length === 0) {
    return 0;
  }
  const matchedCount = targetWords.filter((word) => candidateWords.has(word)).length;
  return matchedCount / targetWords.length;
}

// 1 if the artist's name shows up in the uploader/channel name or in the
// video's own title (e.g. "Queen - Bohemian Rhapsody"), else 0 — catches the
// common case of an official artist channel.
function artistMentionedScore(
  normalizedArtist: string,
  normalizedChannel: string,
  normalizedCandidateTitle: string,
): number {
  if (normalizedArtist.length === 0) {
    return 0;
  }
  const mentioned =
    normalizedChannel.includes(normalizedArtist) ||
    normalizedCandidateTitle.includes(normalizedArtist);
  return mentioned ? 1 : 0;
}

// 1 if the candidate's duration falls inside a plausible studio-track range,
// else 0 — filters out short teasers and multi-hour "full album" uploads
// without needing to understand what the video actually contains.
function durationPlausibleScore(durationSec: number): number {
  const [min, max] = PLAUSIBLE_DURATION_RANGE;
  return durationSec >= min && durationSec <= max ? 1 : 0;
}

// A flat penalty if the title contains words like "cover"/"live"/"remix" —
// a heuristic for "probably not the canonical studio version."
function nonOriginalPenalty(normalizedCandidateTitle: string): number {
  const looksNonOriginal = NON_ORIGINAL_KEYWORDS.some((keyword) =>
    normalizedCandidateTitle.includes(keyword),
  );
  return looksNonOriginal ? NON_ORIGINAL_PENALTY : 0;
}

function scoreCandidate(
  candidate: RawCandidate,
  targetTitle: string,
  targetArtist: string,
): number {
  // Normalize each input exactly once, up front, and hand the results to
  // the sub-scores below — candidate.title in particular used to get
  // re-normalized three separate times (once per sub-score that needed it).
  const normalizedCandidateTitle = normalize(candidate.title);
  const candidateWords = new Set(wordsOf(normalizedCandidateTitle));
  const targetWords = wordsOf(normalize(targetTitle));
  const normalizedArtist = normalize(targetArtist);
  const normalizedChannel = normalize(candidate.channel ?? candidate.uploader ?? "");

  const score =
    titleOverlapScore(targetWords, candidateWords) * TITLE_OVERLAP_WEIGHT +
    artistMentionedScore(normalizedArtist, normalizedChannel, normalizedCandidateTitle) *
      ARTIST_MENTIONED_WEIGHT +
    durationPlausibleScore(candidate.duration ?? 0) * DURATION_PLAUSIBLE_WEIGHT -
    nonOriginalPenalty(normalizedCandidateTitle);

  // Clamp at 0 — a candidate that overlaps poorly AND looks like a cover
  // shouldn't sort as "worse than a non-existent candidate" (e.g. below a
  // hard search failure), just as the worst real option available.
  return Math.max(0, score);
}

/**
 * Resolves a title+artist to a candidate YouTube video via `yt-dlp` search,
 * scored by title/artist similarity and plausible duration. Always returns its
 * single best-scored candidate (never blocks waiting for human confirmation) —
 * but a low `confidence` is logged as a warning so a bad auto-pick can be
 * spotted and fixed later by hand (see index.ts's local-file override).
 */
export async function resolveSource(
  title: string,
  artist: string,
): Promise<ResolvedSource | null> {
  const query = `ytsearch${SEARCH_RESULT_COUNT}:${artist} ${title}`;

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      YTDLP_BIN,
      ["--dump-json", "--no-download", "--flat-playlist", query],
      { maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch (error) {
    console.warn(
      `resolveSource: yt-dlp search failed for "${title}" by "${artist}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  const candidates: RawCandidate[] = stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RawCandidate);

  if (candidates.length === 0) {
    console.warn(`resolveSource: no search results for "${title}" by "${artist}"`);
    return null;
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, title, artist),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;

  if (best.score < CONFIDENCE_WARN_THRESHOLD) {
    console.warn(
      `resolveSource: low-confidence match (${best.score.toFixed(2)}) for "${title}" by "${artist}" -> "${best.candidate.title}" (${best.candidate.id}). Verify manually, or override by placing a corrected mp3 at apps/web/public/audio/<id>.mp3.`,
    );
  }

  return {
    videoId: best.candidate.id,
    title: best.candidate.title,
    channel: best.candidate.channel ?? best.candidate.uploader ?? "",
    durationSec: best.candidate.duration ?? 0,
    confidence: best.score,
  };
}
