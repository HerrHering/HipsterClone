import { describe, expect, it } from "vitest";
import type { SongManifestEntry, TimelineCard } from "@hipster-clone/shared";
import {
  describeSlot,
  describeSong,
  describeTimelineGap,
  type SongLookup,
} from "../apps/web/src/game/songText.ts";

const song = (
  id: string,
  title: string,
  artist: string,
  year: number,
): SongManifestEntry => ({
  id,
  title,
  artist,
  year,
  audio: {
    videoId: `${id}-video`,
    videoTitle: title,
    channel: artist,
    durationSec: 180,
    confidence: 1,
  },
});

const songsById: SongLookup = {
  old: song("old", "Old Song", "First Artist", 1970),
  new: song("new", "New Song", "Second Artist", 1990),
};
const timeline: TimelineCard[] = [
  { songId: "old", year: 1970 },
  { songId: "new", year: 1990 },
];

describe("song display text", () => {
  it("describes known songs and falls back to an unknown id", () => {
    expect(describeSong(songsById, "old")).toBe(
      "Old Song — First Artist (1970)",
    );
    expect(describeSong(songsById, "missing")).toBe("missing — unknown song details");
  });

  it("describes every kind of timeline insertion slot", () => {
    expect(describeSlot(songsById, [], 0)).toBe(
      "this will start your timeline",
    );
    expect(describeSlot(songsById, timeline, 0)).toBe(
      "before Old Song — First Artist (1970)",
    );
    expect(describeSlot(songsById, timeline, 1)).toBe(
      "between Old Song — First Artist (1970) and New Song — Second Artist (1990)",
    );
    expect(describeSlot(songsById, timeline, 2)).toBe(
      "after New Song — Second Artist (1990)",
    );
  });

  it("uses compact year-only gap names, including ties", () => {
    expect(describeTimelineGap([], 0)).toBe("Start timeline");
    const ties = [{ songId: "a", year: 1990 }, { songId: "b", year: 1990 }];
    expect(describeTimelineGap(ties, 0)).toBe("Before 1990");
    expect(describeTimelineGap(ties, 1)).toBe("Between 1990 and 1990");
    expect(describeTimelineGap(ties, 2)).toBe("After 1990");
  });
});
