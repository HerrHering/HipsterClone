// The text-matching pipeline behind resolveSource.ts's YouTube video
// scoring — "search something, score the candidates against a hand-typed
// title." Kept as its own module rather than folded into resolveSource.ts:
// these are generic normalize/tokenize/compare primitives, separate from the
// video-specific scoring signals (title overlap, artist mention, duration,
// non-original keywords) that consume them. There are exactly three stages,
// and each stage has its own type so a later stage's function signature
// simply cannot accept an earlier stage's un-prepared input — the compiler
// enforces the pipeline order, instead of a comment asking callers to
// remember it:
//
//   raw string --normalize()--> NormalizedText --wordsOf()--> WordSet
//
// wordOverlapFraction() is the *one* comparison primitive built on top of
// WordSet. Every "does A mention/match B" question resolveSource.ts asks —
// including "is the artist's name in this channel/title" — is answered by
// it. That used to be a separate, ad hoc substring check
// (`channel.includes(artist)`), which is actually *stricter* than a word
// overlap for no real benefit: it demands the artist's name appear as one
// unbroken run of characters, so a channel handle like "OfficialQueenMusic"
// or a multi-word name in a different order both fail it, while telling us
// nothing a word-overlap fraction doesn't already tell us. "What fraction of
// A's significant words also appear in B" is the same question whether A/B
// are (target title, candidate title) or (artist name, channel name) — so
// it's answered the same way both times.

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

// TS note for a C++ reader: this is a "branded type" — think of it like a
// strong typedef, e.g. `struct NormalizedText { std::string value; };`
// instead of a bare `std::string`, except TS lets us fake that wrapper for
// free using `&` (intersection of types) instead of an actual runtime
// struct. At runtime a NormalizedText *is* just a string with no wrapper at
// all — the `{ __brand: ... }` part never exists in memory, it's purely a
// compile-time label. That's what makes normalize() the only function
// allowed to produce one (via the single, contained, intentional cast
// below): passing a plain `string` anywhere a `NormalizedText` is expected
// is a compile error, so "did you normalize this yet?" gets caught by the
// compiler instead of by reading confusing output later.
export type NormalizedText = string & { readonly __brand: "NormalizedText" };

// PIPELINE STAGE marker, not a stage itself: the set of a normalized text's
// significant words, produced only by wordsOf() below. `ReadonlySet<string>`
// is TS's built-in hash-set type (like C++'s `std::unordered_set<string>`,
// but `Readonly` additionally blocks calling any mutating method on it).
export type WordSet = ReadonlySet<string>;

/**
 * PIPELINE STAGE 1 of 3 — raw string -> NormalizedText.
 * Lowercases, strips punctuation, and collapses whitespace. Every
 * title/artist/channel string goes through this exactly once before
 * anything else touches it.
 *
 * Deliberately does *not* strip bracketed content like "(Official Video)"
 * or "(Live 8 2005)" — an earlier version did, on the theory that it was
 * just noise for word-overlap matching. That was a real bug, found by
 * testing: resolveSource.ts's keyword-based signals (officialMarkerSignal,
 * nonOriginalPenalty) scan this exact normalized text for words like
 * "official"/"live"/"cover" — but those words almost always live *inside*
 * parentheses in a real YouTube title, so stripping brackets was silently
 * blinding both signals to the single most common place their target words
 * actually appear. Leaving brackets in doesn't hurt word-overlap matching
 * either: the generic filler words that would've been stripped (official,
 * video, audio, lyrics, ...) are already dropped by STOPWORDS in wordsOf()
 * below, and wordOverlapFraction() only checks whether the target's words
 * appear in the candidate — an extra, unmatched word from inside a bracket
 * never lowers that score.
 */
export function normalize(text: string): NormalizedText {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() as NormalizedText;
}

/**
 * PIPELINE STAGE 2 of 3 — NormalizedText -> WordSet (tokenize).
 * Splits already-normalized text into words, dropping filler
 * ("official", "video", "feat", ...) that would otherwise inflate overlap
 * scores without actually indicating a match. Takes `NormalizedText`, not
 * `string` — the type itself is what stops this from ever running on raw,
 * un-normalized input.
 */
export function wordsOf(text: NormalizedText): WordSet {
  return new Set(
    text.split(" ").filter((word) => word.length > 0 && !STOPWORDS.has(word)),
  );
}

/**
 * PIPELINE STAGE 3 of 3 — compare two WordSets -> a 0..1 score.
 * What fraction of `target`'s words also appear in `candidate`.
 * This is the one comparison primitive every resolver's scoring is built
 * from — see the file header for why it replaces substring checks too, not
 * just literal title-vs-title comparisons.
 */
export function wordOverlapFraction(
  target: WordSet,
  candidate: WordSet,
): number {
  if (target.size === 0) {
    return 0;
  }
  let matched = 0;
  for (const word of target) {
    if (candidate.has(word)) {
      matched++;
    }
  }
  return matched / target.size;
}
