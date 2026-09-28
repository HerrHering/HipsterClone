import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testData = vi.hoisted(() => {
  const makeSong = (id: string, year: number): SongManifestEntry => ({
    id,
    title: `Song ${year}`,
    artist: `Artist ${year}`,
    year,
    audio: [
      {
        videoId: `video-${year}`,
        videoTitle: `Song ${year}`,
        channel: `Artist ${year}`,
        durationSec: 180,
        confidence: 1,
      },
    ],
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
});
