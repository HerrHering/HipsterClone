// All Phase 3 game-room logic: creating/joining rooms, and applying the one
// GameAction a client can send. Mirrors cache.ts's shape — one focused
// module, imported straight into server.ts's routes.
//
// Rooms live only in memory (the `rooms` Map below) — restarting the server
// loses every in-progress game. That's a deliberate simplification: this is
// a live party game, not something that needs to survive a server restart.

import type {
  GameAction,
  GamePhase,
  GameState,
  PlayerState,
  SongManifestEntry,
  TimelineCard,
} from "@hipster-clone/shared";
import { currentPlaybackPositionSec, currentPlayerId } from "@hipster-clone/shared";
import { randomUUID } from "node:crypto";
import { loadManifest } from "./cache.js";

const DEBUG = process.env.HIPSTER_DEBUG === "1";

const WIN_TARGET = 10;
const STARTING_TOKENS = 2;

// Keyed by room code. Not exported — every other module goes through the
// functions below instead of touching this Map directly, the same way
// cache.ts is the only thing that knows about inFlightDownloads.
const rooms = new Map<string, GameState>();

// Letters only (no digits) and no easily-confused-looking characters (no I,
// O, or 0/1 lookalikes) — this gets read aloud and typed on a phone
// keyboard by someone else, so it should be unambiguous either way.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 4;

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    // .charAt() (unlike indexing with []) always returns a plain `string`,
    // never `string | undefined` — nothing here needs a non-null assertion.
    code += ROOM_CODE_ALPHABET.charAt(
      Math.floor(Math.random() * ROOM_CODE_ALPHABET.length),
    );
  }
  return code;
}

function newPlayer(name: string): PlayerState {
  return { id: randomUUID(), name, timeline: [], tokens: 0 };
}

// `state.players[id]` alone is typed `PlayerState | undefined` (the repo
// enables noUncheckedIndexedAccess), even right after checking the id came
// from this same state — TypeScript doesn't track that far. Every lookup
// goes through this one helper instead of a raw index, so a bad id always
// surfaces as a clear thrown Error instead of a silent `undefined`.
function requirePlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`no player "${playerId}" in this room`);
  }
  return player;
}

// Rooms are never cleaned up (see the module comment above) — an
// unbounded log on a long-lived room would otherwise grow forever, so
// this caps it at the most recent MAX_LOG_ENTRIES lines.
const MAX_LOG_ENTRIES = 50;

function pushLog(state: GameState, message: string): void {
  state.log.push(message);
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
  }
}

export function createRoom(hostName: string): {
  roomCode: string;
  playerId: string;
  state: GameState;
} {
  // Regenerate on the (extremely unlikely) chance of a collision, rather
  // than ever handing out a code that already points at someone else's room.
  let roomCode = generateRoomCode();
  while (rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }

  const host = newPlayer(hostName);
  const state: GameState = {
    phase: { type: "lobby" },
    players: { [host.id]: host },
    turnOrder: [],
    currentTurnIndex: 0,
    usedSongIds: [],
    nextSongId: null,
    settings: { winTarget: WIN_TARGET, libraryVersion: "1" },
    playback: null,
    log: [],
  };
  pushLog(state, `${hostName} created the room.`);
  rooms.set(roomCode, state);

  if (DEBUG) {
    console.log(`game debug: created room ${roomCode} for "${hostName}"`);
  }
  return { roomCode, playerId: host.id, state };
}

export function joinRoom(
  roomCode: string,
  name: string,
): { playerId: string; state: GameState } {
  const state = rooms.get(roomCode);
  if (!state) {
    throw new Error(`no room with code "${roomCode}"`);
  }
  if (state.phase.type !== "lobby") {
    throw new Error(`room "${roomCode}" has already started`);
  }

  const player = newPlayer(name);
  state.players[player.id] = player;
  pushLog(state, `${player.name} joined the room.`);

  if (DEBUG) {
    console.log(`game debug: "${name}" joined room ${roomCode}`);
  }
  return { playerId: player.id, state };
}

export function getState(roomCode: string): GameState | null {
  return rooms.get(roomCode) ?? null;
}

// Picks uniformly at random among songs not yet used this game.
//
// TODO for later (not built now — keep this simple until it's actually
// needed): a real game would rather spread picks evenly across artists and
// years too, so a catalog that's artist-heavy in one direction doesn't just
// keep serving the same few artists back to back. Uniform-over-remaining-
// songs is the simplest thing that works for a small hand-curated catalog.
function pickRandomUnusedSong(
  catalog: SongManifestEntry[],
  usedSongIds: string[],
): SongManifestEntry | null {
  const usedIds = new Set(usedSongIds);
  const available = catalog.filter((song) => !usedIds.has(song.id));
  if (available.length === 0) {
    return null;
  }
  // Safe: index is always < available.length, but noUncheckedIndexedAccess
  // can't see that from the length check above, only from the type itself.
  return available[Math.floor(Math.random() * available.length)]!;
}

// Picks the next song to play, reshuffling the discard pile back in once
// every song has been used at least once. "Reshuffle" means resetting
// usedSongIds down to just the songs currently held in a player's
// timeline — never a song that was played and then discarded (nobody
// guessed it) or has changed hands since, only ones a player would
// instantly recognize a second play of. Returns null only if literally
// every song in the catalog is currently held by someone — loadNextSong's
// existing "no song available" branch still ends the game gracefully then.
function pickNextSong(
  state: GameState,
  catalog: SongManifestEntry[],
): SongManifestEntry | null {
  const song = pickRandomUnusedSong(catalog, state.usedSongIds);
  if (song) {
    return song;
  }
  state.usedSongIds = Object.values(state.players).flatMap((player) =>
    player.timeline.map((card) => card.songId),
  );
  const reshuffled = pickRandomUnusedSong(catalog, state.usedSongIds);
  if (reshuffled) {
    pushLog(state, "Every song has been played — reshuffling the deck.");
  }
  return reshuffled;
}

// Where `year` belongs among `timeline`'s cards, as a single index (0 =
// before everything, timeline.length = after everything). Simplification:
// when two existing cards share a year, only the one canonical index
// counts as "correct" — good enough for a barebones MVP, and exact ties are
// rare in a real song catalog.
function correctInsertionIndex(timeline: TimelineCard[], year: number): number {
  let index = 0;
  for (const card of timeline) {
    if (card.year < year) {
      index++;
    }
  }
  return index;
}

function insertCard(player: PlayerState, songId: string, year: number): void {
  const position = correctInsertionIndex(player.timeline, year);
  player.timeline.splice(position, 0, { songId, year });
}

// True once every player *other* than the active one has cast a vote
// (either STEAL_ATTEMPT or PASS) this round. Room membership can't change
// mid-game (joinRoom refuses once phase isn't "lobby"), so "every non-active
// player" is just "everyone minus one," no need to track who specifically.
function everyoneHasVoted(
  state: GameState,
  votes: { playerId: string; position: number | null }[],
): boolean {
  const nonActiveCount = Object.keys(state.players).length - 1;
  return votes.length >= nonActiveCount;
}

// Resolves a completed voting round (phase "pendingReveal") into a reveal
// (or gameOver): every vote's `position` — and the active player's own
// earlier placement — was a guess at the same single thing, "where does
// this song fit into the active player's timeline," so that's computed
// exactly once here and reused for both checks. Only ever called from the
// REVEAL action below, once the active player asks for it.
async function finishRound(
  state: GameState,
  activeId: string,
  phase: Extract<GamePhase, { type: "pendingReveal" }>,
): Promise<void> {
  const catalog = (await loadManifest()).songs;
  const song = catalog.find((entry) => entry.id === phase.songId);
  if (!song) {
    throw new Error(`song "${phase.songId}" is missing from the catalog`);
  }

  const activePlayer = requirePlayer(state, activeId);
  const correctPosition = correctInsertionIndex(activePlayer.timeline, song.year);
  const activePlacementCorrect = phase.activePlacementPosition === correctPosition;

  let stolenBy: string | null = null;
  if (activePlacementCorrect) {
    insertCard(activePlayer, song.id, song.year);
  } else {
    // First (in submission order) vote whose guess matches the correct
    // position steals the card — a pass, or a wrong guess, costs the
    // voter nothing further (a wrong steal attempt already spent its
    // token when it was recorded).
    const winner = phase.votes.find((vote) => vote.position === correctPosition);
    if (winner) {
      stolenBy = winner.playerId;
      insertCard(requirePlayer(state, winner.playerId), song.id, song.year);
    }
    // If nobody guessed right, the card is simply discarded — nobody's
    // timeline changes, matching the physical game's rule.
  }

  pushLog(state, `The song was "${song.title}" by ${song.artist} (${song.year}).`);
  if (activePlacementCorrect) {
    pushLog(state, `${activePlayer.name} placed it correctly!`);
  } else if (stolenBy) {
    pushLog(state, `${requirePlayer(state, stolenBy).name} stole the card!`);
  } else {
    pushLog(state, `Nobody guessed it — the card is lost.`);
  }

  const winnerId = stolenBy ?? activeId;
  if (requirePlayer(state, winnerId).timeline.length >= state.settings.winTarget) {
    state.phase = { type: "gameOver", winnerId };
    state.playback = null;
    state.nextSongId = null;
    pushLog(state, `${requirePlayer(state, winnerId).name} wins the game!`);
  } else {
    state.phase = {
      type: "reveal",
      songId: phase.songId,
      correctYear: song.year,
      correctPosition,
      activePlacementCorrect,
      stolenBy,
      guessTokenClaimed: false,
    };
  }
}

// Called after recording a vote — the instant the *last* non-active player
// has voted, moves the phase from "stealWindow" to "pendingReveal" (and
// does nothing otherwise). This no longer resolves the round itself — it
// just makes the "everyone's voted, waiting on the active player" moment a
// real, distinct phase for REVEAL to act on below, instead of an automatic
// jump straight to the outcome.
function maybeCompleteVoting(
  state: GameState,
  phase: Extract<GamePhase, { type: "stealWindow" }>,
): void {
  if (!everyoneHasVoted(state, phase.votes)) {
    return;
  }
  state.phase = {
    type: "pendingReveal",
    songId: phase.songId,
    activePlacementPosition: phase.activePlacementPosition,
    votes: phase.votes,
  };
}

// Fisher-Yates: swaps each element with a random one at-or-before it,
// working backwards. Standard way to shuffle an array in place with a
// uniformly random result (unlike, say, sorting by Math.random(), which
// doesn't actually produce a uniform shuffle).
function shuffledPlayerIds(players: GameState["players"]): string[] {
  const ids = Object.keys(players);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // Not a one-line destructuring swap: noUncheckedIndexedAccess types
    // `ids[i]`/`ids[j]` as `string | undefined` on read, and both are
    // provably in range here, so a plain temp variable (with a non-null
    // assertion) is clearer than fighting the destructuring types.
    const temp = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = temp;
  }
  return ids;
}

// Loads a fresh song into `playingSong` for whoever's turn it now is,
// mutating `state` in place. Shared by START_GAME (first turn) and
// NEXT_TURN (every turn after). Consumes whatever the *previous* call
// already peeked ahead into `state.nextSongId` (see below) — the very
// first call this game (from START_GAME) has nothing peeked yet, so falls
// back to picking fresh. If nothing is available even after pickNextSong's
// own reshuffle attempt — every catalog song is currently held by some
// player — ends the game instead, crowning whoever has the most cards,
// rather than crashing.
function loadNextSong(state: GameState, catalog: SongManifestEntry[]): void {
  const songId = state.nextSongId ?? pickNextSong(state, catalog)?.id ?? null;
  if (!songId) {
    const winner = Object.values(state.players).reduce((best, player) =>
      player.timeline.length > best.timeline.length ? player : best,
    );
    state.phase = { type: "gameOver", winnerId: winner.id };
    state.playback = null;
    state.nextSongId = null;
    pushLog(state, `${winner.name} wins the game!`);
    return;
  }

  if (!state.usedSongIds.includes(songId)) {
    state.usedSongIds.push(songId);
  }
  state.phase = { type: "playingSong", songId };
  // Loaded but not playing yet — the active player has to press Play
  // themselves, same as picking up the physical card and starting the clip.
  state.playback = {
    songId,
    isPlaying: false,
    positionSec: 0,
    updatedAt: Date.now(),
  };
  // Never the song itself — that stays hidden until its own reveal phase.
  const nextActive = requirePlayer(state, currentPlayerId(state)!);
  pushLog(state, `It's ${nextActive.name}'s turn.`);

  // Peek one turn further ahead so the client can start prefetching this
  // song's audio while the one that just loaded above is still playing —
  // reserved in usedSongIds immediately (inside pickNextSong) so the next
  // loadNextSong call above is guaranteed to consume exactly this song,
  // never a different random pick.
  state.nextSongId = pickNextSong(state, catalog)?.id ?? null;
}

export async function applyAction(
  roomCode: string,
  playerId: string,
  action: GameAction,
): Promise<GameState> {
  const state = rooms.get(roomCode);
  if (!state) {
    throw new Error(`no room with code "${roomCode}"`);
  }
  requirePlayer(state, playerId);

  const activeId = currentPlayerId(state);
  const phase: GamePhase = state.phase;

  switch (action.type) {
    case "START_GAME": {
      if (phase.type !== "lobby") {
        throw new Error("game has already started");
      }
      const playerIds = Object.keys(state.players);
      if (playerIds.length < 2) {
        throw new Error("need at least 2 players to start");
      }

      const catalog = (await loadManifest()).songs;
      state.turnOrder = shuffledPlayerIds(state.players);
      state.currentTurnIndex = 0;
      pushLog(state, "The game has started!");

      // Deal every player a starting card (auto-placed — it just seeds
      // their timeline) and their starting tokens, before the first real
      // turn's song is picked below.
      for (const id of state.turnOrder) {
        const player = requirePlayer(state, id);
        const starterSong = pickRandomUnusedSong(catalog, state.usedSongIds);
        if (starterSong) {
          state.usedSongIds.push(starterSong.id);
          player.timeline = [{ songId: starterSong.id, year: starterSong.year }];
        }
        player.tokens = STARTING_TOKENS;
      }

      loadNextSong(state, catalog);
      break;
    }

    case "CONFIRM_PLACEMENT": {
      if (phase.type !== "playingSong") {
        throw new Error(`can't confirm a placement during "${phase.type}"`);
      }
      if (playerId !== activeId) {
        throw new Error("only the active player can confirm a placement");
      }
      state.phase = {
        type: "stealWindow",
        songId: phase.songId,
        activePlacementPosition: action.position,
        votes: [],
      };
      pushLog(
        state,
        `${requirePlayer(state, playerId).name} placed a card at slot ${action.position} in their timeline.`,
      );
      break;
    }

    case "STEAL_ATTEMPT": {
      if (phase.type !== "stealWindow") {
        throw new Error(`can't attempt a steal during "${phase.type}"`);
      }
      if (playerId === activeId) {
        throw new Error("the active player can't steal from themselves");
      }
      const player = requirePlayer(state, playerId);
      if (player.tokens < 1) {
        throw new Error("no tokens left to attempt a steal");
      }
      if (phase.votes.some((vote) => vote.playerId === playerId)) {
        throw new Error("already voted this round");
      }
      // Slots are exclusive: the active player's own placement, and every
      // slot someone else already claimed, are off-limits. Checked (and
      // rejected) before the token is touched below — a request that loses
      // this race never costs its sender anything, regardless of how late
      // it arrived relative to whoever claimed the slot first.
      const slotTaken =
        action.position === phase.activePlacementPosition ||
        phase.votes.some((vote) => vote.position === action.position);
      if (slotTaken) {
        throw new Error(`slot ${action.position} is already claimed`);
      }
      // Spent immediately, win or lose — matches the physical game's rule
      // that a wrong guess still costs you the token.
      player.tokens -= 1;
      phase.votes.push({ playerId, position: action.position });
      pushLog(state, `${player.name} attempted to steal at slot ${action.position}.`);
      maybeCompleteVoting(state, phase);
      break;
    }

    case "PASS": {
      if (phase.type !== "stealWindow") {
        throw new Error(`can't pass during "${phase.type}"`);
      }
      if (playerId === activeId) {
        throw new Error(
          "the active player doesn't vote — they already placed the card",
        );
      }
      if (phase.votes.some((vote) => vote.playerId === playerId)) {
        throw new Error("already voted this round");
      }
      phase.votes.push({ playerId, position: null });
      pushLog(state, `${requirePlayer(state, playerId).name} passed.`);
      maybeCompleteVoting(state, phase);
      break;
    }

    case "REVEAL": {
      if (phase.type !== "pendingReveal") {
        throw new Error(`can't reveal during "${phase.type}"`);
      }
      if (playerId !== activeId) {
        throw new Error("only the active player can reveal the card");
      }
      await finishRound(state, activeId, phase);
      break;
    }

    case "CLAIM_GUESS_TOKEN": {
      if (phase.type !== "reveal") {
        throw new Error(`can't claim a guess token during "${phase.type}"`);
      }
      if (playerId !== activeId) {
        throw new Error("only the active player can claim a guess token");
      }
      if (phase.guessTokenClaimed) {
        throw new Error("a guess token was already claimed this round");
      }
      phase.guessTokenClaimed = true;
      requirePlayer(state, activeId).tokens += 1;
      pushLog(
        state,
        `${requirePlayer(state, activeId).name} guessed the title and artist for a bonus token!`,
      );
      break;
    }

    case "NEXT_TURN": {
      if (phase.type !== "reveal") {
        throw new Error(`can't advance turn during "${phase.type}"`);
      }
      // `activeId` still refers to whoever just took the turn being
      // revealed — currentTurnIndex only moves a few lines below, once
      // this check has passed. Only they may advance to the next turn.
      if (playerId !== activeId) {
        throw new Error("only the active player can advance to the next turn");
      }
      state.currentTurnIndex =
        (state.currentTurnIndex + 1) % state.turnOrder.length;
      const catalog = (await loadManifest()).songs;
      loadNextSong(state, catalog);
      break;
    }

    // Playback controls: only the active player may touch these, checked
    // here — not just in the UI — so nothing but the UI stops a different
    // player's phone from calling this route directly.
    case "PLAY":
    case "PAUSE":
    case "SEEK": {
      if (playerId !== activeId) {
        throw new Error("only the active player can control playback");
      }
      if (!state.playback) {
        throw new Error("no song is loaded");
      }
      if (action.type === "PLAY") {
        state.playback.isPlaying = true;
        state.playback.updatedAt = Date.now();
      } else if (action.type === "PAUSE") {
        // Snapshot "where the track actually is right now" before freezing
        // it, using the same formula every client uses to read it — see
        // currentPlaybackPositionSec in protocol.ts.
        state.playback.positionSec = currentPlaybackPositionSec(state.playback);
        state.playback.isPlaying = false;
        state.playback.updatedAt = Date.now();
      } else {
        // A seek always freezes the timestamp exactly where it points,
        // rather than preserving isPlaying: if it kept playing, every
        // follower's own network/poll delay before it actually applies
        // this would get silently baked into where they land — whoever's
        // slowest to find out ends up furthest from the second the active
        // player actually pointed at. Freezing it means every client, no
        // matter when it catches up, computes exactly `positionSec` (no
        // elapsed-time term applies while paused) — a hard, deterministic
        // sync point. A plain PLAY (unchanged) is what starts the clock
        // again, together, for everyone, from this exact position.
        state.playback.positionSec = action.positionSec;
        state.playback.isPlaying = false;
        state.playback.updatedAt = Date.now();
      }
      break;
    }

    default: {
      // Every real GameAction variant has its own `case` above — the only
      // way to land here is an action type that doesn't exist in the
      // current protocol (a stale client, or a hand-crafted request).
      // Without this branch, an unrecognized `action.type` would just fall
      // straight through the switch and this function would return
      // `state` completely unchanged: a silent 200 that looks like nothing
      // happened, with no way for the caller to know why. Throwing here
      // instead means it takes the exact same path every other rejected
      // action already does (a 400 with a message — see server.ts).
      //
      // `const _exhaustive: never = action;` is a compile-time trip wire,
      // not a runtime check: TypeScript only allows assigning a value to
      // `never` if every other case has already narrowed `action` down to
      // nothing. So the moment `GameAction` gains a new variant without a
      // matching `case` above, *this line* stops compiling — catching the
      // mistake here, at build time, instead of a player discovering it as
      // a mysteriously silent button later.
      const _exhaustive: never = action;
      throw new Error(`unrecognized action "${JSON.stringify(_exhaustive)}"`);
    }
  }

  return state;
}
