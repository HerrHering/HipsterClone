import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentPlaybackPositionSec,
  currentPlayerId,
  errorMessage,
  type GameState,
} from "../packages/shared/src/index.ts";

describe("shared helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns errors and arbitrary thrown values into messages", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
    expect(errorMessage("plain failure")).toBe("plain failure");
    expect(errorMessage(null)).toBe("null");
  });

  it("advances playing snapshots and leaves paused snapshots unchanged", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:05.000Z"));

    expect(
      currentPlaybackPositionSec({
        songId: "song",
        isPlaying: true,
        positionSec: 12.5,
        updatedAt: Date.parse("2025-01-01T00:00:02.000Z"),
      }),
    ).toBe(15.5);
    expect(
      currentPlaybackPositionSec({
        songId: "song",
        isPlaying: false,
        positionSec: 12.5,
        updatedAt: 0,
      }),
    ).toBe(12.5);
  });

  it("finds the active player and handles an empty turn order", () => {
    const state = {
      turnOrder: ["alice", "bob"],
      currentTurnIndex: 1,
    } as GameState;

    expect(currentPlayerId(state)).toBe("bob");
    state.turnOrder = [];
    expect(currentPlayerId(state)).toBeNull();
  });
});
