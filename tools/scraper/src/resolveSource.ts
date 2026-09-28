// Resolves a title+artist to a candidate YouTube video via `yt-dlp` search.
// The matching logic below follows three stages, read top to bottom:
//   1. prepare  — normalize/tokenize every field exactly once
//   2. signals  — six small, independently-justified 0..1 scores
//   3. combine  — weight and sum the signals into one ScoreBreakdown
// See textMatch.ts for the normalize/tokenize/compare primitives this file
// builds on.
//
// Set HIPSTER_DEBUG=1 to print every candidate this considered and why the
// winner won — see the DEBUG block near the bottom of resolveSource().

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { errorMessage } from "@hipster-clone/shared";
import {
  normalize,
  wordOverlapFraction,
  wordsOf,
  type NormalizedText,
  type WordSet,
} from "./textMatch.js";

// `promisify` turns the classic Node callback style
// (`execFile(cmd, args, (err, stdout) => ...)`) into a function that returns
// a Promise instead — so it can be `await`ed below like any other async call.
const execFileAsync = promisify(execFile);

// `import.meta.url` is this file's own location as a `file://...` URL;
// `fileURLToPath` converts that into an ordinary filesystem path so
// `dirname`/`resolve` (which don't understand URLs) can work with it.
const here = dirname(fileURLToPath(import.meta.url));
// LOCAL FILESYSTEM PATH — repoRoot never leaves this machine or gets sent
// anywhere; it's just used below to locate a local executable.
const repoRoot = resolve(here, "../../..");

// yt-dlp needs a recent build to solve YouTube's JS signature challenges
// (see downloadClip.ts) — prefer the project's own .venv if one was set up
// (`python3 -m venv .venv && .venv/bin/pip install -U yt-dlp`), and only
// fall back to whatever "yt-dlp" resolves to on PATH otherwise.
// LOCAL FILESYSTEM PATH — the on-disk location of an executable, not a URL.
const venvYtDlp = resolve(repoRoot, ".venv/bin/yt-dlp");
const YTDLP_BIN = existsSync(venvYtDlp) ? venvYtDlp : "yt-dlp";

// Off by default. Set HIPSTER_DEBUG=1 (e.g. `HIPSTER_DEBUG=1 npm run scrape`)
// to print every search result considered and its full score breakdown —
// not just the winner, which is all the low-confidence warning below shows.
const DEBUG = process.env.HIPSTER_DEBUG === "1";

const SEARCH_RESULT_COUNT = 5;
const CONFIDENCE_WARN_THRESHOLD = 0.4;
const PLAUSIBLE_DURATION_RANGE: [number, number] = [60, 900]; // 1–15 minutes

// Scoring weights — the five positive weights sum to 1.0 (a perfect match
// scores 1), and the non-original penalty is subtracted on top of that, so a
// title that overlaps well but looks like a cover/live version can still
// land below a title that overlaps less but looks canonical.
//
// channelMatchesArtist and artistMentionedInTitle used to be one signal
// (Math.max of the two) — split apart, and weighted very differently, so the
// uploader actually *being* the artist's own channel outweighs a random
// reupload that merely credits the artist correctly in its title. A real
// case that motivated this: a personal-channel reupload titled "Bikini - Adj
// helyet magad mellett" (so it credits the artist fine) was outscoring the
// artist's own official "Bikini - Topic" auto-generated channel, purely
// because the reupload's title happened to overlap the target title more
// exactly. Splitting the signal fixes this without needing to special-case
// "Topic" channels or any other specific channel-naming convention.
const TITLE_OVERLAP_WEIGHT = 0.4;
const CHANNEL_MATCHES_ARTIST_WEIGHT = 0.25;
const ARTIST_MENTIONED_IN_TITLE_WEIGHT = 0.05;
const DURATION_PLAUSIBLE_WEIGHT = 0.15;
const OFFICIAL_MARKER_WEIGHT = 0.15;
const NON_ORIGINAL_PENALTY = 0.3;

// This catalog is entirely Hungarian songs, and Hungarian-titled search
// results routinely use the Hungarian word instead of (or as well as) the
// English one — "koncert" doesn't contain the substring "concert", so an
// English-only list lets those slip through entirely. A real case: a video
// titled "...(25 éves koncert)" tied for the top score because this list
// didn't recognize it as a live recording.
const NON_ORIGINAL_KEYWORDS = [
  "cover",
  "live",
  "concert",
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
  // Hungarian equivalents.
  "koncert",
  "koncerten",
  "koncertfelvétel",
  "élő",
  "élőben",
  "feldolgozás",
  "akusztik",
  "akusztikus",
];

// "official" alone misses Hungarian uploads that mark themselves as
// "hivatalos" (official) instead.
const OFFICIAL_MARKER_KEYWORDS = ["official", "hivatalos"];

export interface ResolvedSource {
  videoId: string;
  videoTitle: string;
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

// ---------------------------------------------------------------------------
// Stage 1: prepare — normalize/tokenize every field exactly once, up front.
// An earlier version of this file called `normalize(candidate.title)` three
// separate times (once per signal that needed it) — a real, found bug, not a
// hypothetical one. Every signal below reads from this struct only; nothing
// past this point ever touches a raw string again.
// ---------------------------------------------------------------------------
interface PreparedMatch {
  candidateTitleNormalized: NormalizedText;
  candidateTitleWords: WordSet;
  targetTitleWords: WordSet;
  artistWords: WordSet;
  channelWords: WordSet;
  durationSec: number;
}

// PIPELINE STAGE 1 (prepare): builds the one struct every signal function
// below reads from — nothing after this line ever calls normalize/wordsOf
// again for this candidate.
function prepare(
  candidate: RawCandidate,
  targetTitle: string,
  targetArtist: string,
): PreparedMatch {
  // Normalized once here, then reused for both `candidateTitleWords` below
  // and the raw keyword scan inside nonOriginalPenalty() — that's why it's
  // returned as its own field instead of only ever appearing as a WordSet.
  const candidateTitleNormalized = normalize(candidate.title);
  return {
    candidateTitleNormalized,
    candidateTitleWords: wordsOf(candidateTitleNormalized),
    targetTitleWords: wordsOf(normalize(targetTitle)),
    artistWords: wordsOf(normalize(targetArtist)),
    // `??` (nullish coalescing) — yt-dlp's JSON sometimes has `channel` but
    // not `uploader`, sometimes the reverse, sometimes neither. This tries
    // `channel` first, falls back to `uploader`, and finally to an empty
    // string so `normalize`/`wordsOf` below always get a real `string`,
    // never `null`/`undefined`.
    channelWords: wordsOf(normalize(candidate.channel ?? candidate.uploader ?? "")),
    durationSec: candidate.duration ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Stage 2: signals — each function answers exactly one narrow question about
// a *prepared* match and returns a plain 0..1 number (the penalty is the one
// exception, see below). Kept separate, rather than folded into one scoring
// expression, so each one can be read and second-guessed on its own — the
// comments below are that critical look, not just a description of the code.
// ---------------------------------------------------------------------------

// Combines two directions of title overlap — recall (what fraction of the
// target title's words show up in the candidate) and precision (what
// fraction of the candidate's own words, besides the artist's name, are
// actually part of the target title) — as their geometric mean, so a
// candidate needs to do reasonably well on *both* rather than fully
// compensating a weak one with a strong other.
//
// Recall alone is the strongest signal available for "is this roughly the
// right song": two videos of completely different songs essentially never
// share most of their title words, whereas the right video — even with
// "(Official Video)" tacked on, or the artist name reordered into the
// title — almost always does. But recall alone can't tell "Ki Visz Haza"
// apart from "Részegen Ki Visz Majd Haza" ("... — drunk version"): every
// target word still shows up somewhere in the longer title, so a
// recall-only score treats padding the title with unrelated extra words as
// free. Precision catches exactly that: the extra "Részegen" isn't part of
// the target title, so it drags precision down (while a legitimate
// "Artist - Song" prefix doesn't, since the artist's own name is excluded
// from the candidate side of the precision check — that's expected,
// wanted content, not padding).
// PIPELINE STAGE 2 (signal 1 of 6).
function titleOverlapSignal(m: PreparedMatch): number {
  const recall = wordOverlapFraction(m.targetTitleWords, m.candidateTitleWords);
  const candidateWordsExcludingArtist = new Set(
    [...m.candidateTitleWords].filter((word) => !m.artistWords.has(word)),
  );
  const precision = wordOverlapFraction(
    candidateWordsExcludingArtist,
    m.targetTitleWords,
  );
  return Math.sqrt(recall * precision);
}

// Fraction of the artist's significant name-words that show up in the
// uploading channel's own name — e.g. a channel called "queenofficial" or
// "Queen - Topic" matches "queen" here. This is deliberately its own signal,
// separate from artistMentionedInTitleSignal below, and weighted far more
// heavily: the uploader actually *being* the artist's channel is a much
// stronger authenticity signal than a title merely crediting the artist
// correctly, which any reupload can do. This used to be folded into one
// Math.max'd signal with the title check, which meant the two were
// indistinguishable — a personal-channel reupload with a well-credited title
// scored identically to the artist's own official channel.
// PIPELINE STAGE 2 (signal 2 of 6).
function channelMatchesArtistSignal(m: PreparedMatch): number {
  return wordOverlapFraction(m.artistWords, m.channelWords);
}

// Fraction of the artist's significant name-words that show up in the
// video's own title — e.g. "Bohemian Rhapsody (Queen)" matches "queen" here
// even when the uploading channel doesn't. Kept as a small, separate signal
// (see channelMatchesArtistSignal above for why it's not combined with that
// one): a fan reupload that credits the artist properly is still slightly
// more trustworthy than one that doesn't, just not nearly as trustworthy as
// the artist's own channel.
// PIPELINE STAGE 2 (signal 3 of 6).
function artistMentionedInTitleSignal(m: PreparedMatch): number {
  return wordOverlapFraction(m.artistWords, m.candidateTitleWords);
}

// 1 if the candidate's duration falls inside a plausible studio-track range,
// else 0. Deliberately *not* a text-similarity signal like the two above —
// it's a sanity check that catches results title/artist matching alone
// can't: a 15-second ringtone or a 3-hour "full album" upload can both have
// a title that matches perfectly, but neither is ever the actual song.
// PIPELINE STAGE 2 (signal 4 of 6).
function durationPlausibleSignal(m: PreparedMatch): number {
  // Array destructuring: PLAUSIBLE_DURATION_RANGE is `[60, 900]`, so this
  // pulls the first element into `min` and the second into `max` in one line
  // (equivalent to `const min = PLAUSIBLE_DURATION_RANGE[0]; const max = ...`).
  const [min, max] = PLAUSIBLE_DURATION_RANGE;
  return m.durationSec >= min && m.durationSec <= max ? 1 : 0;
}

// 1 if the candidate's title contains a marker like "official" (as in
// "Official Video"/"Official Music Video"/"Official Audio") or its Hungarian
// equivalent "hivatalos", else 0 — the single most reliable marker an
// artist/label uses to flag their own canonical upload. This exists because
// the other signals alone can tie: a real case we hit had the true official
// upload score identically to two *live performance* clips (a Grammy
// performance, a talent-show performance) that simply don't contain the word
// "live" anywhere in their titles, so nonOriginalPenalty below couldn't catch
// them either. Rather than try to enumerate every possible award-show/venue
// name — a losing game — this gives the genuinely official upload a real,
// structural edge instead of relying on it merely tying and happening to
// sort first.
// Checked against the fully-normalized title, not the stopword-filtered
// word set used by the other signals — "official" is itself in STOPWORDS
// (see textMatch.ts) precisely because it's too common to help *title*
// matching, but that's exactly the word we want to detect here.
// PIPELINE STAGE 2 (signal 5 of 6).
function officialMarkerSignal(m: PreparedMatch): number {
  return OFFICIAL_MARKER_KEYWORDS.some((keyword) =>
    m.candidateTitleNormalized.includes(keyword),
  )
    ? 1
    : 0;
}

// A flat penalty (subtracted after weighting, not itself weighted — see
// "combine" below) if the title contains a marker word like "cover", "live",
// or "remix". Deliberately a literal keyword scan, not a word-overlap
// comparison like the signals above: this is checking for one specific
// marker phrase actually being present, not "how similar are these two
// pieces of text" — a lenient/fuzzy match here would risk false positives
// with no benefit, since the whole point is to catch an exact, deliberate
// marker word.
// PIPELINE STAGE 2 (signal 6 of 6 — a penalty, not a positive signal).
function nonOriginalPenalty(m: PreparedMatch): number {
  // `.some(...)` short-circuits on the first match — this is just "does any
  // keyword from the list appear in the title," expressed without a loop.
  const looksNonOriginal = NON_ORIGINAL_KEYWORDS.some((keyword) =>
    m.candidateTitleNormalized.includes(keyword),
  );
  return looksNonOriginal ? NON_ORIGINAL_PENALTY : 0;
}

// ---------------------------------------------------------------------------
// Stage 3: combine — weight and sum the signals. Returns the full breakdown,
// not just the total, so a low-confidence warning can show exactly which
// signal was weak instead of one opaque number.
// ---------------------------------------------------------------------------
export interface ScoreBreakdown {
  titleOverlap: number;
  channelMatchesArtist: number;
  artistMentionedInTitle: number;
  durationPlausible: number;
  officialMarker: number;
  nonOriginalPenalty: number;
  total: number;
}

// PIPELINE STAGE 3 (combine): weights + sums the 6 signals into one
// ScoreBreakdown for a single candidate.
function scoreCandidate(
  candidate: RawCandidate,
  targetTitle: string,
  targetArtist: string,
): ScoreBreakdown {
  const prepared = prepare(candidate, targetTitle, targetArtist);

  const titleOverlap = titleOverlapSignal(prepared);
  const channelMatchesArtist = channelMatchesArtistSignal(prepared);
  const artistMentionedInTitle = artistMentionedInTitleSignal(prepared);
  const durationPlausible = durationPlausibleSignal(prepared);
  const officialMarker = officialMarkerSignal(prepared);
  const penalty = nonOriginalPenalty(prepared);

  const total = Math.max(
    0,
    titleOverlap * TITLE_OVERLAP_WEIGHT +
      channelMatchesArtist * CHANNEL_MATCHES_ARTIST_WEIGHT +
      artistMentionedInTitle * ARTIST_MENTIONED_IN_TITLE_WEIGHT +
      durationPlausible * DURATION_PLAUSIBLE_WEIGHT +
      officialMarker * OFFICIAL_MARKER_WEIGHT -
      penalty,
  );
  // Clamped at 0 — a candidate that overlaps poorly AND looks like a cover
  // shouldn't sort as "worse than a non-existent candidate" (e.g. below a
  // hard search failure), just as the worst real option available. (The top
  // end doesn't need a symmetric clamp at 1: the five positive weights
  // already sum to exactly 1.0, so nothing can score above that.)

  return {
    titleOverlap,
    channelMatchesArtist,
    artistMentionedInTitle,
    durationPlausible,
    officialMarker,
    nonOriginalPenalty: penalty,
    total,
  };
}

/**
 * ORCHESTRATOR — runs the yt-dlp search, then Stage 1/2/3 above for every
 * candidate it gets back, and returns up to 3 of the highest-scoring ones.
 * This is the only exported function in this file; everything above is a
 * private helper it calls.
 *
 * Resolves a title+artist to candidate YouTube videos via `yt-dlp` search,
 * scored by title/artist similarity and plausible duration. The best-scored
 * candidate is always included (never blocks waiting for human confirmation,
 * and a low-confidence pick is logged with its full score breakdown so a bad
 * auto-pick can be spotted and fixed by hand later) — but 2 further backups
 * are included too, each only if it individually clears
 * CONFIDENCE_WARN_THRESHOLD, so `apps/api/src/cache.ts`'s download path has
 * somewhere to fall back to if the top pick turns out to be broken
 * server-side (a real case: a YouTube-side streaming restriction hit the
 * #1 pick specifically while a lower-scored candidate for the same song
 * worked fine). See index.ts's reuse step for how a hand-edit to any of
 * these videoIds in manifest.json sticks across future scrapes.
 */
export async function resolveSource(
  title: string,
  artist: string,
): Promise<ResolvedSource[] | null> {
  // NOT A REAL URL — `ytsearch5:...` is yt-dlp's own pseudo-URL syntax
  // meaning "search YouTube for this text and treat the top N results as a
  // playlist." It only means anything to yt-dlp itself; it's never sent as
  // an actual HTTP request the way the video-download URL in
  // downloadClip.ts is.
  const query = `ytsearch${SEARCH_RESULT_COUNT}:${artist} ${title}`;

  let stdout: string;
  try {
    // Destructuring assignment into an *already-declared* variable needs
    // the surrounding parentheses — `{ stdout } = ...` on its own would be
    // parsed as a block statement, not an object pattern.
    ({ stdout } = await execFileAsync(
      YTDLP_BIN,
      ["--dump-json", "--no-download", "--flat-playlist", query],
      { maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch (error) {
    // yt-dlp itself failing (missing binary, network down, etc.) is a real,
    // unexpected problem — not a normal outcome of searching — so this
    // always prints, regardless of HIPSTER_DEBUG. Under debug, also dump the
    // full error (stack included), not just its message.
    console.warn(
      `resolveSource: yt-dlp search failed for "${title}" by "${artist}": ${errorMessage(error)}`,
    );
    if (DEBUG) {
      console.error(error);
    }
    return null;
  }

  // yt-dlp's `--dump-json` prints one JSON object per line (not one big JSON
  // array) — split on newlines, drop blank lines, and parse each separately.
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
      breakdown: scoreCandidate(candidate, title, artist),
    }))
    // Descending by total score — `b - a` (rather than `a - b`) is what
    // makes `.sort()` put the highest score first instead of last.
    .sort((a, b) => b.breakdown.total - a.breakdown.total);

  // Non-null assertion (`!`): `scored` is guaranteed non-empty here because
  // we already returned early above when `candidates.length === 0`, but
  // TypeScript can't see that connection through the `.map()`/`.sort()`
  // chain, so `!` tells it "trust me, index 0 exists."
  const best = scored[0]!;

  if (DEBUG) {
    console.log(
      `resolveSource debug: "${title}" by "${artist}" — ${scored.length} candidate(s):`,
    );
    for (const { candidate, breakdown: b } of scored) {
      console.log(
        `  ${candidate.id} "${candidate.title}" ` +
          `titleOverlap=${b.titleOverlap.toFixed(2)} channelMatchesArtist=${b.channelMatchesArtist.toFixed(2)} ` +
          `artistMentionedInTitle=${b.artistMentionedInTitle.toFixed(2)} ` +
          `durationPlausible=${b.durationPlausible} officialMarker=${b.officialMarker} ` +
          `nonOriginalPenalty=${b.nonOriginalPenalty} total=${b.total.toFixed(2)}`,
      );
    }
    console.log(
      `resolveSource debug: picked ${best.candidate.id} — highest score.`,
    );
  }

  if (best.breakdown.total < CONFIDENCE_WARN_THRESHOLD) {
    const b = best.breakdown;
    console.warn(
      `resolveSource: low-confidence match for "${title}" by "${artist}" -> "${best.candidate.title}" (${best.candidate.id}). ` +
        `score breakdown: titleOverlap=${b.titleOverlap.toFixed(2)} channelMatchesArtist=${b.channelMatchesArtist.toFixed(2)} ` +
        `artistMentionedInTitle=${b.artistMentionedInTitle.toFixed(2)} ` +
        `durationPlausible=${b.durationPlausible} officialMarker=${b.officialMarker} ` +
        `nonOriginalPenalty=${b.nonOriginalPenalty} total=${b.total.toFixed(2)}. ` +
        `Verify manually, or hand-edit this song's audio.videoId directly in manifest.json — it'll stick across future scrapes.`,
    );
  }

  // #1 is always kept regardless of score (matches the "best effort" warning
  // above — a low-confidence pick still beats no pick at all). #2 and #3 are
  // added only as a contiguous prefix of `scored` that also clears
  // CONFIDENCE_WARN_THRESHOLD, so a backup is never *worse* than what the
  // low-confidence warning would already have flagged as risky on its own.
  const kept = [best];
  for (const next of scored.slice(1, 3)) {
    if (next.breakdown.total < CONFIDENCE_WARN_THRESHOLD) {
      break;
    }
    kept.push(next);
  }

  if (DEBUG && kept.length > 1) {
    console.log(
      `resolveSource debug: keeping ${kept.length} candidate(s) as fallbacks: ` +
        kept.map(({ candidate }) => candidate.id).join(", "),
    );
  }

  return kept.map(({ candidate, breakdown }) => ({
    videoId: candidate.id,
    videoTitle: candidate.title,
    channel: candidate.channel ?? candidate.uploader ?? "",
    durationSec: candidate.duration ?? 0,
    confidence: breakdown.total,
  }));
}
