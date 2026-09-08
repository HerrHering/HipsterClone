import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testData = vi.hoisted(() => {
  const makeSong = (id: string, year: number): SongManifestEntry => ({
    id,
    title: `Song ${year}`,
    artist: `Artist ${year}`,
    year,
    audio: {
      videoId: `video-${year}`,
      videoTitle: `Song ${year}`,
      channel: `Artist ${year}`,
      durationSec: 180,
      confidence: 1,
    },
  });
  const manifest: SongManifest = {
    version: "test-catalog",
    generatedAt: "2025-01-01T00:00:00.000Z",
    songs: [1960, 1970, 1980, 1990, 2000, 2010].map((year) =>
      makeSong(`song-${year}`, year),
    ),
  };
  return { manifest };
});

vi.mock("../apps/api/src/cache.ts", () => ({
  loadManifest: vi.fn(async () => testData.manifest),
}));

async function startedGame() {
  const game = await import("../apps/api/src/game.ts");
  const created = game.createRoom("Host");
  const joined = game.joinRoom(created.roomCode, "Guest");
  const state = await game.applyAction(created.roomCode, created.playerId, {
    type: "START_GAME",
  });
  return {
    game,
    roomCode: created.roomCode,
    hostId: created.playerId,
    guestId: joined.playerId,
    state,
  };
}

describe("game rooms", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("creates, joins, and starts a deterministic two-player room", async () => {
    const game = await import("../apps/api/src/game.ts");
    const created = game.createRoom("Host");

    expect(created.roomCode).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(created.state.phase).toEqual({ type: "lobby" });
    expect(game.getState(created.roomCode)).toBe(created.state);
    await expect(
      game.applyAction(created.roomCode, created.playerId, {
        type: "START_GAME",
      }),
    ).rejects.toThrow("need at least 2 players");

    const joined = game.joinRoom(created.roomCode, "Guest");
    const state = await game.applyAction(created.roomCode, created.playerId, {
      type: "START_GAME",
    });

    expect(state.turnOrder).toEqual([joined.playerId, created.playerId]);
    expect(state.phase.type).toBe("playingSong");
    expect(state.playback).toMatchObject({ isPlaying: false, positionSec: 0 });
    expect(state.usedSongIds).toHaveLength(3);
    expect(state.nextSongId).not.toBeNull();
    for (const player of Object.values(state.players)) {
      expect(player.timeline).toHaveLength(1);
      expect(player.tokens).toBe(2);
    }
    expect(() => game.joinRoom(created.roomCode, "Latecomer")).toThrow(
      "has already started",
    );
  });

  it("enforces turn ownership and resolves a correct placement", async () => {
    const { game, roomCode, state } = await startedGame();
    const activeId = state.turnOrder[0]!;
    const otherId = state.turnOrder[1]!;

    await expect(
      game.applyAction(roomCode, otherId, { type: "PLAY" }),
    ).rejects.toThrow("only the active player can control playback");

    await game.applyAction(roomCode, activeId, { type: "PLAY" });
    expect(state.playback?.isPlaying).toBe(true);
    await game.applyAction(roomCode, activeId, {
      type: "SEEK",
      positionSec: 42,
    });
    expect(state.playback).toMatchObject({
      isPlaying: false,
      positionSec: 42,
    });

    const phase = state.phase;
    expect(phase.type).toBe("playingSong");
    if (phase.type !== "playingSong") throw new Error("expected playingSong");
    const currentSong = testData.manifest.songs.find(
      (entry) => entry.id === phase.songId,
    )!;
    const active = state.players[activeId]!;
    const correctPosition = active.timeline.filter(
      (card) => card.year < currentSong.year,
    ).length;

    await game.applyAction(roomCode, activeId, {
      type: "CONFIRM_PLACEMENT",
      position: correctPosition,
    });
    await game.applyAction(roomCode, otherId, { type: "PASS" });
    expect(state.phase.type).toBe("pendingReveal");
    await expect(
      game.applyAction(roomCode, otherId, { type: "REVEAL" }),
    ).rejects.toThrow("only the active player can reveal");
    await game.applyAction(roomCode, activeId, { type: "REVEAL" });

    expect(state.phase).toMatchObject({
      type: "reveal",
      songId: currentSong.id,
      activePlacementCorrect: true,
      stolenBy: null,
    });
    expect(active.timeline.map((card) => card.year)).toEqual(
      [...active.timeline.map((card) => card.year)].sort((a, b) => a - b),
    );
    expect(active.timeline).toHaveLength(2);

    await game.applyAction(roomCode, activeId, { type: "CLAIM_GUESS_TOKEN" });
    expect(active.tokens).toBe(3);
    await expect(
      game.applyAction(roomCode, activeId, { type: "CLAIM_GUESS_TOKEN" }),
    ).rejects.toThrow("already claimed");
  });

  it("spends a token and awards a card for a successful steal", async () => {
    const { game, roomCode, state } = await startedGame();
    const activeId = state.turnOrder[0]!;
    const stealerId = state.turnOrder[1]!;
    const phase = state.phase;
    if (phase.type !== "playingSong") throw new Error("expected playingSong");
    const currentSong = testData.manifest.songs.find(
      (entry) => entry.id === phase.songId,
    )!;
    const active = state.players[activeId]!;
    const correctPosition = active.timeline.filter(
      (card) => card.year < currentSong.year,
    ).length;
    const wrongPosition = correctPosition === 0 ? 1 : 0;

    await game.applyAction(roomCode, activeId, {
      type: "CONFIRM_PLACEMENT",
      position: wrongPosition,
    });
    await expect(
      game.applyAction(roomCode, stealerId, {
        type: "STEAL_ATTEMPT",
        position: wrongPosition,
      }),
    ).rejects.toThrow("already claimed");
    expect(state.players[stealerId]!.tokens).toBe(2);

    await game.applyAction(roomCode, stealerId, {
      type: "STEAL_ATTEMPT",
      position: correctPosition,
    });
    expect(state.players[stealerId]!.tokens).toBe(1);
    expect(state.phase.type).toBe("pendingReveal");
    await game.applyAction(roomCode, activeId, { type: "REVEAL" });

    expect(state.phase).toMatchObject({
      type: "reveal",
      activePlacementCorrect: false,
      stolenBy: stealerId,
    });
    expect(state.players[stealerId]!.timeline).toContainEqual({
      songId: currentSong.id,
      year: currentSong.year,
    });
  });

  it("rejects invalid rooms, players, and actions for the current phase", async () => {
    const game = await import("../apps/api/src/game.ts");
    expect(game.getState("NOPE")).toBeNull();
    expect(() => game.joinRoom("NOPE", "Guest")).toThrow("no room");
    await expect(
      game.applyAction("NOPE", "player", { type: "PLAY" }),
    ).rejects.toThrow("no room");

    const created = game.createRoom("Host");
    await expect(
      game.applyAction(created.roomCode, "player", { type: "PLAY" }),
    ).rejects.toThrow("no player");
    game.joinRoom(created.roomCode, "Guest");
    const state = await game.applyAction(created.roomCode, created.playerId, {
      type: "START_GAME",
    });
    state.playback = null;
    await expect(
      game.applyAction(created.roomCode, state.turnOrder[0]!, { type: "PLAY" }),
    ).rejects.toThrow('no song is loaded');
  });

  it("pauses playback, advances a revealed round, and rejects a second start", async () => {
    const { game, roomCode, hostId, state } = await startedGame();
    const activeId = state.turnOrder[0]!;

    await game.applyAction(roomCode, activeId, { type: "PLAY" });
    await game.applyAction(roomCode, activeId, { type: "PAUSE" });
    expect(state.playback?.isPlaying).toBe(false);
    await expect(
      game.applyAction(roomCode, hostId, { type: "START_GAME" }),
    ).rejects.toThrow("already started");

    await game.applyAction(roomCode, activeId, {
      type: "CONFIRM_PLACEMENT",
      position: 0,
    });
    const otherId = state.turnOrder[1]!;
    await game.applyAction(roomCode, otherId, { type: "PASS" });
    await game.applyAction(roomCode, activeId, { type: "REVEAL" });
    await expect(
      game.applyAction(roomCode, otherId, { type: "NEXT_TURN" }),
    ).rejects.toThrow("only the active player");
    await game.applyAction(roomCode, activeId, { type: "NEXT_TURN" });
    expect(state.phase.type).toBe("playingSong");
  });

  it("enforces steal vote and token rules", async () => {
    const { game, roomCode, state } = await startedGame();
    const activeId = state.turnOrder[0]!;
    const stealerId = state.turnOrder[1]!;
    await game.applyAction(roomCode, activeId, {
      type: "CONFIRM_PLACEMENT",
      position: 0,
    });

    await expect(
      game.applyAction(roomCode, activeId, {
        type: "STEAL_ATTEMPT",
        position: 1,
      }),
    ).rejects.toThrow("can't steal");
    await expect(
      game.applyAction(roomCode, stealerId, {
        type: "STEAL_ATTEMPT",
        position: 0,
      }),
    ).rejects.toThrow("already claimed");

    state.players[stealerId]!.tokens = 0;
    await expect(
      game.applyAction(roomCode, stealerId, {
        type: "STEAL_ATTEMPT",
        position: 1,
      }),
    ).rejects.toThrow("no tokens");
  });

  it("discards an incorrectly placed card when nobody steals it", async () => {
    const { game, roomCode, state } = await startedGame();
    const activeId = state.turnOrder[0]!;
    const otherId = state.turnOrder[1]!;
    const phase = state.phase;
    if (phase.type !== "playingSong") throw new Error("expected playingSong");
    const song = testData.manifest.songs.find((entry) => entry.id === phase.songId)!;
    const active = state.players[activeId]!;
    const correctPosition = active.timeline.filter(
      (card) => card.year < song.year,
    ).length;

    await game.applyAction(roomCode, activeId, {
      type: "CONFIRM_PLACEMENT",
      position: correctPosition === 0 ? 1 : 0,
    });
    await game.applyAction(roomCode, otherId, { type: "PASS" });
    await game.applyAction(roomCode, activeId, { type: "REVEAL" });

    expect(state.phase).toMatchObject({
      type: "reveal",
      activePlacementCorrect: false,
      stolenBy: null,
    });
    expect(active.timeline).toHaveLength(1);
  });

  it("ends the game when a player reaches the win target", async () => {
    const { game, roomCode, state } = await startedGame();
    const activeId = state.turnOrder[0]!;
    const otherId = state.turnOrder[1]!;
    const phase = state.phase;
    if (phase.type !== "playingSong") throw new Error("expected playingSong");
    const song = testData.manifest.songs.find((entry) => entry.id === phase.songId)!;
    const active = state.players[activeId]!;
    state.settings.winTarget = 2;

    await game.applyAction(roomCode, activeId, {
      type: "CONFIRM_PLACEMENT",
      position: active.timeline.filter((card) => card.year < song.year).length,
    });
    await game.applyAction(roomCode, otherId, { type: "PASS" });
    await game.applyAction(roomCode, activeId, { type: "REVEAL" });

    expect(state.phase).toEqual({ type: "gameOver", winnerId: activeId });
    expect(state.playback).toBeNull();
  });
});
