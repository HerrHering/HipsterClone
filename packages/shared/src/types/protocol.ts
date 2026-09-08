// The Phase 3 game protocol: what a "room" looks like, and the shape of the
// one HTTP action a client is allowed to send. The server (apps/api/src/game.ts)
// is the *only* thing that ever mutates a GameState — every browser tab just
// polls GET .../state and renders whatever comes back, and sends a GameAction
// when a player does something. There is no client-to-client sync at all;
// two phones only ever agree because they're both looking at the same server
// state.

export type PlayerId = string;

// One song a player has already placed in their personal timeline.
export interface TimelineCard {
  songId: string;
  year: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  // Sorted by year ascending — see game.ts's correctInsertionIndex, which is
  // the one place cards get inserted and is what keeps this sorted.
  timeline: TimelineCard[];
  tokens: number;
}

// Server-authoritative "where is the current song right now." Every phone's
// <audio> element is a dumb follower of this, not an independent player —
// see currentPlaybackPositionSec below for how a client turns this snapshot
// into "the real position right now, this instant."
export interface PlaybackState {
  songId: string;
  isPlaying: boolean;
  // Where the track was, in seconds, as of `updatedAt`. Not updated
  // continuously — only when isPlaying/positionSec actually change (play,
  // pause, seek) — so it's always a little stale by the time a client reads
  // it, which is exactly what `updatedAt` lets a reader correct for.
  positionSec: number;
  // Server epoch ms (Date.now()) when this snapshot was taken.
  updatedAt: number;
}

// Turns a possibly-stale PlaybackState snapshot into "the actual position
// right now." If the track is playing, time has kept moving since
// `updatedAt` was recorded, so that elapsed time gets added on; if it's
// paused, `positionSec` is already exactly right. Used by the server itself
// (to compute a fresh positionSec when PAUSE is requested) and by every
// client's <audio> element (to know how far to nudge currentTime) — one
// formula, so the two can never disagree about what "in sync" means.
export function currentPlaybackPositionSec(playback: PlaybackState): number {
  if (!playback.isPlaying) {
    return playback.positionSec;
  }
  const elapsedSec = (Date.now() - playback.updatedAt) / 1000;
  return playback.positionSec + elapsedSec;
}

// Whose turn it is, independent of which phase that turn is currently in
// (playingSong/stealWindow/reveal all belong to the same turn). `null`
// before a game has started (turnOrder is empty in the lobby).
export function currentPlayerId(state: GameState): PlayerId | null {
  return state.turnOrder[state.currentTurnIndex] ?? null;
}

export type GamePhase =
  | { type: "lobby" }
  // A song is loaded (see GameState.playback) and the active player is
  // deciding + will eventually send CONFIRM_PLACEMENT.
  | { type: "playingSong"; songId: string }
  // The active player has locked in a position. Every *other* player must
  // now explicitly vote — attempt a steal (spend a token, guess a slot) or
  // pass — before the card can turn over; the active player has no say in
  // when that happens at all. `votes` is in submission order (the *first*
  // correct steal guess wins, so order matters and is preserved — a
  // Record<PlayerId, ...> would lose it), one entry per player who has
  // voted so far, `position: null` meaning "passed" rather than guessed.
  // Every guess here — the active player's own placement above, and every
  // vote's `position` — refers to the *same* timeline: the active player's.
  // There's only one timeline in contention this round; a stealer who wins
  // it still gets it inserted into *their own* timeline afterward (see
  // game.ts's insertCard), but the guess itself is judged against the
  // active player's.
  | {
      type: "stealWindow";
      songId: string;
      activePlacementPosition: number;
      votes: { playerId: PlayerId; position: number | null }[];
    }
  // Every non-active player has voted, but the active player hasn't
  // clicked REVEAL yet — same fields as stealWindow (voting is over, so
  // `votes` is now fixed), just a distinct phase so the client can show a
  // "Reveal" button instead of flipping the card automatically. This is
  // also the active player's one chance to lock in a title/artist guess
  // (kept client-side only, see GameAction's CLAIM_GUESS_TOKEN) before
  // seeing the real answer.
  | {
      type: "pendingReveal";
      songId: string;
      activePlacementPosition: number;
      votes: { playerId: PlayerId; position: number | null }[];
    }
  | {
      type: "reveal";
      songId: string;
      correctYear: number;
      // Index into the active player's timeline — the one shared answer
      // every vote (and the active player's own placement) was judged
      // against.
      correctPosition: number;
      activePlacementCorrect: boolean;
      // null covers both "nobody attempted a steal" and "everyone who did
      // guessed wrong" — either way, nobody stole the card.
      stolenBy: PlayerId | null;
      // Whether the active player has already claimed the bonus token for
      // guessing the song's title+artist correctly this round — see
      // GameAction's CLAIM_GUESS_TOKEN. Starts false every time a reveal
      // phase is created; guards against a retried/duplicated claim
      // minting more than one token.
      guessTokenClaimed: boolean;
    }
  | { type: "gameOver"; winnerId: PlayerId };

export interface GameSettings {
  // First player to reach this many timeline cards wins.
  winTarget: number;
  libraryVersion: string;
}

export interface GameState {
  phase: GamePhase;
  players: Record<PlayerId, PlayerState>;
  turnOrder: PlayerId[];
  currentTurnIndex: number;
  // Every songId already played this game, win or lose or stolen — checked
  // by game.ts's song picker so the same song never comes up twice in one game.
  usedSongIds: string[];
  // The song reserved to load at the next NEXT_TURN/START_GAME call — already
  // pushed into usedSongIds so it can never be picked twice, and already known
  // one turn ahead so the client can prefetch its audio while the current song
  // is still playing (see game.ts's loadNextSong/pickNextSong). null only in
  // the degenerate case where every song in the whole catalog is currently
  // held in some player's timeline — the next loadNextSong call is what
  // actually ends the game then, same as an ordinary empty catalog always has.
  nextSongId: string | null;
  settings: GameSettings;
  // null only in `lobby` — every other phase has a song loaded.
  playback: PlaybackState | null;
  // A running, capped (see game.ts's MAX_LOG_ENTRIES) history of
  // human-readable event lines — "Alice joined the room," "Bob placed a
  // card" — in the order they happened, oldest first. Deliberately plain
  // strings rather than a structured {id, timestamp, kind} shape: nothing
  // renders these interactively, so there's nothing that structure would
  // buy over a client just listing them out. Never mentions a song's
  // title/artist before its `reveal` phase, so it can't spoil anything.
  log: string[];
}

// The one thing a client ever sends to change a room's state. Joining a room
// is its own dedicated route (POST /api/rooms/:code/join), not an action,
// since it needs to hand back a fresh playerId — every action below assumes
// the caller already has one.
export type GameAction =
  | { type: "START_GAME" }
  | { type: "CONFIRM_PLACEMENT"; position: number }
  | { type: "STEAL_ATTEMPT"; position: number }
  | { type: "PASS" }
  // Only the active player, and only once every other player has voted
  // (phase "pendingReveal") — turns the card over. Deliberately a real,
  // player-triggered action instead of an automatic phase change, so the
  // reveal itself is a moment of suspense rather than something that just
  // happens the instant the last vote comes in.
  | { type: "REVEAL" }
  // Only the active player, and only once (phase "reveal", guarded by
  // guessTokenClaimed) — self-reported: the client already showed this
  // player their own typed guess next to the real title/artist and asked
  // "are they the same?" before ever sending this. The guess text itself
  // never reaches the server; only the player's own yes/no verdict does.
  | { type: "CLAIM_GUESS_TOKEN" }
  | { type: "NEXT_TURN" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK"; positionSec: number };
