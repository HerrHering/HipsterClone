import { useState } from "react";
import type { GameState } from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import { IconCrown } from "../icons";
import { EventLog } from "./EventLog";

interface Props {
  playerId: string;
  state: GameState;
  onStartGame: () => Promise<void>;
}

const MIN_PLAYERS = 2;

// Shown while phase.type === "lobby": who's joined so far (the room code
// itself is shown in the sticky AppHeader), plus the button that kicks off
// game.ts's START_GAME action once there are enough players.
export function LobbyScreen({ playerId, state, onStartGame }: Props) {
  const players = Object.values(state.players);

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
        <h2>Lobby</h2>
        <p className="divider">Tell your friends to join with the room code above.</p>

        <div className="player-grid">
          {players.map((player) => (
            <div
              key={player.id}
              className={player.id === playerId ? "player-card is-me" : "player-card"}
            >
              <span className="player-card-name">
                {player.name}
                {player.id === state.hostId && (
                  <span className="badge" title="Room host">
                    <IconCrown size={12} /> Host
                  </span>
                )}
                {player.id === playerId && <span className="badge badge-muted">You</span>}
              </span>
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
          <span className="badge badge-warning">
            Need at least {MIN_PLAYERS} players to start.
          </span>
        )}
        {startError && <p className="blob blob-danger blob-sm">{startError}</p>}
      </div>

      <EventLog entries={state.log} />
    </div>
  );
}
