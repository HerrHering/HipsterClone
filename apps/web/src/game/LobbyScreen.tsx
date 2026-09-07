import { useState } from "react";
import type { GameState } from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import { EventLog } from "./EventLog";

interface Props {
  roomCode: string;
  playerId: string;
  state: GameState;
  onStartGame: () => Promise<void>;
}

const MIN_PLAYERS = 2;

// Shown while phase.type === "lobby": just the room code (to hand out) and
// who's joined so far, plus the button that kicks off game.ts's
// START_GAME action once there are enough players.
export function LobbyScreen({ roomCode, playerId, state, onStartGame }: Props) {
  const players = Object.values(state.players);
  const me = state.players[playerId];

  // Same manual "catch it, show it" as GameBoard's own act() — a rejected
  // START_GAME (e.g. a player left right as this was clicked) used to only
  // go to console.debug, so this button could look like it did nothing.
  const [startError, setStartError] = useState<string | null>(null);
  async function handleStartGame() {
    setStartError(null);
    try {
      await onStartGame();
    } catch (error) {
      setStartError(errorMessage(error));
    }
  }

  return (
    <div className="stack">
      <div className="card stack-sm">
        <h2>Room {roomCode}</h2>
        <p>
          You are <strong>{me?.name ?? playerId}</strong>.
        </p>
        <p className="divider">Tell your friends to join with this code.</p>

        <div className="player-grid">
          {players.map((player) => (
            <div key={player.id} className="player-card">
              <span className="player-card-name">{player.name}</span>
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary"
          disabled={players.length < MIN_PLAYERS}
          onClick={handleStartGame}
        >
          Start game
        </button>
        {players.length < MIN_PLAYERS && (
          <span className="badge badge-muted">
            Need at least {MIN_PLAYERS} players to start.
          </span>
        )}
        {startError && <p className="alert">{startError}</p>}
      </div>

      <EventLog entries={state.log} />
    </div>
  );
}
