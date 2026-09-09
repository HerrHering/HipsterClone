import { describe, expect, it } from "vitest";
import type { GameState } from "../packages/shared/src/index.ts";
import { MIN_SCALE, calculateTimelineScale, claimedGaps, deriveBoardInteraction, layoutMode, legalTimelinePositions, reconcileSelection, revealTargetTimeline, rotateTurnOrder, seatPlayers, selectionReducer, zoneEmphasis } from "../apps/web/src/game/boardModel.ts";

function gameState(phase: GameState["phase"]): GameState {
  return {
    phase,
    players: {
      a: { id: "a", name: "Alice", timeline: [{ songId: "old", year: 1980 }], tokens: 2 },
      b: { id: "b", name: "Bob", timeline: [{ songId: "b-old", year: 1990 }], tokens: 0 },
      c: { id: "c", name: "Cleo", timeline: [{ songId: "c-old", year: 2000 }], tokens: 3 },
    },
    hostId: "a", turnOrder: ["a", "b", "c"], currentTurnIndex: 0,
    usedSongIds: [], nextSongId: null, settings: { winTarget: 10, libraryVersion: "1" },
    playback: phase.type === "gameOver" || phase.type === "lobby" ? null : { songId: phase.songId, isPlaying: false, positionSec: 0, updatedAt: 0 }, log: [],
  };
}

describe("tabletop seating", () => {
  it("rotates without mutating clockwise order", () => {
    const order = ["a", "b", "c", "d"];
    expect(rotateTurnOrder(order, "c")).toEqual(["c", "d", "a", "b"]);
    expect(rotateTurnOrder(order, "missing")).toEqual(order);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });
  it.each([2, 3, 4, 5, 6])("places a viewer at bottom for %i players", (count) => {
    const order = Array.from({ length: count }, (_, index) => String(index));
    const seats = seatPlayers(order, "1");
    expect(seats).toHaveLength(count);
    expect(seats[0]).toMatchObject({ playerId: "1", seat: "bottom", seatIndex: 0 });
    expect(new Set(seats.map((seat) => `${seat.x},${seat.y}`)).size).toBe(count);
    expect(layoutMode(count)).toBe("table");
  });
  it("uses list fallback outside the supported table count", () => {
    expect(layoutMode(0)).toBe("list");
    expect(layoutMode(1)).toBe("list");
    expect(layoutMode(7)).toBe("list");
  });
  it("keeps the six-player clockwise seat map exact", () => {
    expect(seatPlayers(["0", "1", "2", "3", "4", "5"], "0")).toMatchObject([
      { seat: "bottom", x: 50, y: 88, width: 34, height: 20, orientation: "horizontal" },
      { seat: "lower-right", x: 84, y: 72, width: 18, height: 31, orientation: "vertical" },
      { seat: "upper-right", x: 84, y: 28, width: 18, height: 31, orientation: "vertical" },
      { seat: "top", x: 50, y: 12, width: 34, height: 20, orientation: "horizontal" },
      { seat: "upper-left", x: 16, y: 28, width: 18, height: 31, orientation: "vertical" },
      { seat: "lower-left", x: 16, y: 72, width: 18, height: 31, orientation: "vertical" },
    ]);
  });
});

describe("board permissions and claims", () => {
  it("allows only the active player to place and control audio", () => {
    const playing = gameState({ type: "playingSong", songId: "live" });
    expect(deriveBoardInteraction(playing, "a")).toMatchObject({ canPlace: true, canControlAudio: true, canVote: false });
    expect(deriveBoardInteraction(playing, "b")).toMatchObject({ canPlace: false, canControlAudio: false });
  });
  it("keeps voting unordered and respects tokens and prior votes", () => {
    const stealing = gameState({ type: "stealWindow", songId: "live", activePlacementPosition: 1, votes: [{ playerId: "c", position: 0 }] });
    expect(deriveBoardInteraction(stealing, "b")).toMatchObject({ canVote: true, canAttemptSteal: false, canPass: true });
    expect(deriveBoardInteraction(stealing, "c")).toMatchObject({ canVote: false, canAttemptSteal: false });
    expect(zoneEmphasis(stealing, "b", "b")).toBe("actionable");
    expect([...claimedGaps(stealing)]).toEqual([[1, "Alice"], [0, "Cleo"]]);
  });
  it("reconstructs the active pre-insertion timeline after an active win", () => {
    const revealed = gameState({ type: "reveal", songId: "live", correctYear: 1985, correctPositionRange: { low: 1, high: 1 }, activePlacementPosition: 1, votes: [], activePlacementCorrect: true, stolenBy: null, guessTokenClaimed: false });
    revealed.players.a!.timeline.push({ songId: "live", year: 1985 });
    expect(revealTargetTimeline(revealed)).toEqual([{ songId: "old", year: 1980 }]);
  });
  it("keeps the active target unchanged when a steal wins", () => {
    const revealed = gameState({ type: "reveal", songId: "live", correctYear: 1985, correctPositionRange: { low: 1, high: 1 }, activePlacementPosition: 0, votes: [{ playerId: "c", position: 1 }], activePlacementCorrect: false, stolenBy: "c", guessTokenClaimed: false });
    revealed.players.c!.timeline.push({ songId: "live", year: 1985 });
    expect(revealTargetTimeline(revealed)).toEqual([{ songId: "old", year: 1980 }]);
  });
  it("gates reveal, claim, and next-turn actions to the active player", () => {
    const pending = gameState({ type: "pendingReveal", songId: "live", activePlacementPosition: 1, votes: [] });
    expect(deriveBoardInteraction(pending, "a")).toMatchObject({ canReveal: true, canClaimGuessToken: false, canNextTurn: false });
    expect(deriveBoardInteraction(pending, "c").canReveal).toBe(false);
    const revealed = gameState({ type: "reveal", songId: "live", correctYear: 1985, correctPositionRange: { low: 1, high: 2 }, activePlacementPosition: 1, votes: [], activePlacementCorrect: true, stolenBy: null, guessTokenClaimed: false });
    expect(deriveBoardInteraction(revealed, "a")).toMatchObject({ canReveal: false, canClaimGuessToken: true, canNextTurn: true });
    expect(deriveBoardInteraction(revealed, "missing")).toMatchObject({ canClaimGuessToken: false, canNextTurn: false });
  });
});

describe("placement selection and scaling", () => {
  it("selects locally and cancels when legality changes", () => {
    let selection = selectionReducer({ kind: "idle" }, { type: "PICK_UP", source: "token" });
    selection = selectionReducer(selection, { type: "MOVE_OVER", position: 2 });
    selection = selectionReducer(selection, { type: "DROP", position: 2 });
    expect(selection).toEqual({ kind: "selected", source: "token", position: 2 });
    expect(reconcileSelection(selection, [0, 1])).toEqual({ kind: "idle" });
  });
  it("retains every unblocked boundary gap", () => {
    const timeline = Array.from({ length: 10 }, (_, year) => ({ songId: String(year), year }));
    expect(legalTimelinePositions(timeline, [3, 7])).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
  });
  it("chooses normal, compact, then bounded scroll geometry", () => {
    expect(calculateTimelineScale(800, 10).mode).toBe("normal");
    expect(calculateTimelineScale(280, 10).mode).toBe("compact");
    const tiny = calculateTimelineScale(80, 10);
    expect(tiny.mode).toBe("scroll");
    expect(tiny.scale).toBe(MIN_SCALE);
    for (const available of [80, 280, 800, 2000]) {
      const geometry = calculateTimelineScale(available, 10);
      expect(geometry.scale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(geometry.scale).toBeLessThanOrEqual(1);
    }
  });
});
