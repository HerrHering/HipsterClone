import type { SongManifestEntry, TimelineCard } from "@hipster-clone/shared";

export type SongLookup = Record<string, SongManifestEntry>;

// GameState only ever stores a songId + year (see TimelineCard in
// protocol.ts) — this is the one place that turns an id back into
// something readable, using the manifest App.tsx already loaded.
export function describeSong(songsById: SongLookup, songId: string): string {
  const song = songsById[songId];
  return song ? `${song.title} — ${song.artist} (${song.year})` : songId;
}

// The accessible name for "insertion slot" number `position` in `timeline`
// (there are timeline.length + 1 of these: before the first card, between
// each pair, and after the last). Used to be visible button text (the old
// "[before]/[between]/[after]" list) — now it's SongTimeline's aria-label
// for what's otherwise an icon-only gap marker between two visible cards.
export function describeSlot(
  songsById: SongLookup,
  timeline: TimelineCard[],
  position: number,
): string {
  const before = timeline[position - 1];
  const after = timeline[position];
  if (!before && !after) {
    return "this will start your timeline";
  }
  if (!before) {
    // `after` must exist here: the only way both `before` and `after` can
    // be missing is the empty-timeline case just handled above.
    return `before ${describeSong(songsById, after!.songId)}`;
  }
  if (!after) {
    return `after ${describeSong(songsById, before.songId)}`;
  }
  return `between ${describeSong(songsById, before.songId)} and ${describeSong(songsById, after.songId)}`;
}
