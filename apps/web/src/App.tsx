import { useEffect, useState } from "react";
import type {
  GameAction,
  SongManifest,
  SongManifestEntry,
} from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import { GameBoard } from "./game/GameBoard";
import { HomeScreen } from "./game/HomeScreen";
import { LobbyScreen } from "./game/LobbyScreen";
import { createRoom, joinRoom, sendAction } from "./game/api";
import { useGameState } from "./game/useGameState";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "./localStorage";

type ManifestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; songsById: Record<string, SongManifestEntry> };

// Which room + seat this phone currently holds. Persisted to localStorage
// (see below) so refreshing the page — or reopening the tab later — doesn't
// lose your spot in an in-progress game.
interface Seat {
  roomCode: string;
  playerId: string;
}

const SEAT_STORAGE_KEY = "hipster-seat";
const NAME_STORAGE_KEY = "hipster-name";

// Unlike the seat, a stored name is never removed — there's no "clear your
// name" action, it should just keep coming back pre-filled the next time
// this phone joins or creates a room.
function loadStoredName(): string {
  return safeLocalStorageGet(NAME_STORAGE_KEY) ?? "";
}

function storeName(name: string): void {
  if (name) {
    safeLocalStorageSet(NAME_STORAGE_KEY, name);
  }
}

function loadStoredSeat(): Seat | null {
  const raw = safeLocalStorageGet(SEAT_STORAGE_KEY);
  // A malformed/corrupted stored value (e.g. hand-edited in devtools) is
  // treated the same as "nothing stored" — same reasoning as
  // safeLocalStorageGet returning null, just one level up: fall back
  // quietly to the home screen rather than crash on a bad JSON.parse.
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Seat;
  } catch {
    return null;
  }
}

function storeSeat(seat: Seat | null): void {
  if (seat) {
    safeLocalStorageSet(SEAT_STORAGE_KEY, JSON.stringify(seat));
  } else {
    safeLocalStorageRemove(SEAT_STORAGE_KEY);
  }
}

function App() {
  const [manifestState, setManifestState] = useState<ManifestState>({
    status: "loading",
  });
  const [seat, setSeat] = useState<Seat | null>(() => loadStoredSeat());
  const [storedName] = useState<string>(() => loadStoredName());
  const [homePending, setHomePending] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);

  useEffect(() => {
    // STATIC FILE, not an api request — this hits apps/web/public/manifest.json
    // directly, the same file the scraper writes. Still needed in the game
    // itself: GameState only ever stores a songId + year (see protocol.ts's
    // TimelineCard), never a title/artist, so this manifest is what turns
    // an id back into something a player can actually read.
    fetch("/manifest.json")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<SongManifest>;
      })
      .then((manifest) => {
        const songsById: Record<string, SongManifestEntry> = {};
        for (const song of manifest.songs) {
          songsById[song.id] = song;
        }
        setManifestState({ status: "ready", songsById });
      })
      .catch((error: unknown) =>
        setManifestState({ status: "error", message: errorMessage(error) }),
      );
    // Empty dependency array: run this fetch exactly once, when the
    // component first mounts, not on every re-render.
  }, []);

  // Polls the current room's state on an interval once `seat` is set — see
  // useGameState.ts. `applyState` lets an action's own response update the
  // screen immediately, without waiting for the next poll tick.
  const {
    state: gameState,
    error: pollError,
    applyState,
  } = useGameState(seat?.roomCode ?? null);

  function takeSeat(next: Seat): void {
    storeSeat(next);
    setSeat(next);
  }

  function leaveRoom(): void {
    storeSeat(null);
    setSeat(null);
  }

  async function handleCreateRoom(name: string): Promise<void> {
    storeName(name);
    setHomePending(true);
    setHomeError(null);
    try {
      const created = await createRoom(name);
      takeSeat({ roomCode: created.roomCode, playerId: created.playerId });
      applyState(created.state);
    } catch (error) {
      setHomeError(errorMessage(error));
    } finally {
      setHomePending(false);
    }
  }

  async function handleJoinRoom(roomCode: string, name: string): Promise<void> {
    storeName(name);
    setHomePending(true);
    setHomeError(null);
    try {
      const joined = await joinRoom(roomCode, name);
      takeSeat({ roomCode, playerId: joined.playerId });
      applyState(joined.state);
    } catch (error) {
      setHomeError(errorMessage(error));
    } finally {
      setHomePending(false);
    }
  }

  // Sends one action and applies the server's resulting state right away.
  // Thrown errors are left to propagate — GameBoard's own `act()` wrapper is
  // what catches and displays them; this function only exists to hand
  // sendAction the seat details it needs.
  async function handleAction(action: GameAction): Promise<void> {
    if (!seat) {
      return;
    }
    const next = await sendAction(seat.roomCode, seat.playerId, action);
    applyState(next);
  }

  return (
    <main>
      <h1>HipsterClone</h1>

      {manifestState.status === "loading" && <p>Loading songs…</p>}

      {manifestState.status === "error" && (
        <p>
          Couldn't load manifest.json ({manifestState.message}). Run{" "}
          <code>npm run scrape</code> first.
        </p>
      )}

      {manifestState.status === "ready" && (
        <>
          {!seat && (
            <HomeScreen
              initialName={storedName}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              pending={homePending}
              error={homeError}
            />
          )}

          {seat && !gameState && (
            <div>
              {pollError ? (
                <p>Couldn't reach room {seat.roomCode}: {pollError}</p>
              ) : (
                <p>Loading room {seat.roomCode}…</p>
              )}
              <button onClick={leaveRoom}>Back to home</button>
            </div>
          )}

          {seat && gameState && (
            <>
              {/* A poll hiccup after we already have a good state is just
                  noted, not treated as fatal — keep showing the last known
                  state rather than yanking the player back to a loading
                  screen over what might be one missed request. */}
              {pollError && <p>(connection hiccup — showing last known state)</p>}

              {gameState.phase.type === "lobby" ? (
                <LobbyScreen
                  roomCode={seat.roomCode}
                  playerId={seat.playerId}
                  state={gameState}
                  onStartGame={() => handleAction({ type: "START_GAME" })}
                />
              ) : (
                <GameBoard
                  roomCode={seat.roomCode}
                  playerId={seat.playerId}
                  state={gameState}
                  songsById={manifestState.songsById}
                  onAction={handleAction}
                />
              )}

              <button onClick={leaveRoom}>Leave room</button>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default App;
