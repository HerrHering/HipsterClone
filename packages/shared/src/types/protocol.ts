export type PlayerId = string;

export interface TimelineCard {
  songId: string;
  year: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  connected: boolean;
  timeline: TimelineCard[];
  tokens: number;
}

export type GamePhase =
  | { type: "lobby" }
  | { type: "playingSong"; songId: string; activePlayerId: PlayerId }
  | {
      type: "awaitingPlacement";
      songId: string;
      activePlayerId: PlayerId;
      /** index into the active player's timeline where they're currently proposing to insert the card */
      activeDraftPosition: number | null;
      /** every other connected player's current guess at the correct index, for the token/steal mechanic */
      spectatorGuesses: Record<PlayerId, number | null>;
    }
  | {
      type: "reveal";
      songId: string;
      correctPosition: number;
      activePlacementCorrect: boolean;
      stolenBy: PlayerId | null;
    }
  | { type: "gameOver"; winnerId: PlayerId };

export interface GameSettings {
  winTarget: number;
  libraryVersion: string;
}

export interface GameState {
  phase: GamePhase;
  players: Record<PlayerId, PlayerState>;
  turnOrder: PlayerId[];
  currentTurnIndex: number;
  usedSongIds: string[];
  settings: GameSettings;
}

// Intents: peer -> host. The host is the only party allowed to mutate GameState;
// every other participant expresses what it wants to happen and waits for a STATE_SYNC.
export type Intent =
  | { type: "JOIN_REQUEST"; name: string }
  | { type: "PLAY_READY" }
  | { type: "DRAFT_POSITION_UPDATE"; position: number | null }
  | { type: "CONFIRM_PLACEMENT"; position: number }
  | { type: "SPECTATOR_GUESS_UPDATE"; position: number | null }
  | { type: "SPECTATOR_GUESS_CONFIRM"; position: number };

// Events: host -> all peers (including itself, for a single local update path).
export type GameEvent =
  | { type: "STATE_SYNC"; state: GameState }
  | { type: "PLAYER_JOINED"; playerId: PlayerId; name: string }
  | { type: "PLAYER_LEFT"; playerId: PlayerId };
