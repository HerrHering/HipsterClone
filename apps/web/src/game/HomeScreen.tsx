import { useState } from "react";

interface Props {
  // Whatever App.tsx already had remembered in localStorage from the last
  // time this phone created or joined a room — "" if it's never happened.
  initialName: string;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (roomCode: string, name: string) => void;
  pending: boolean;
  error: string | null;
}

// The very first screen: pick a name, then either create a fresh room or
// join one a friend already created. Nothing here talks to the server
// directly — App.tsx owns that, and just passes down what to call.
export function HomeScreen({
  initialName,
  onCreateRoom,
  onJoinRoom,
  pending,
  error,
}: Props) {
  // Local, un-submitted form state — only App.tsx's state (roomCode,
  // playerId) actually matters once a room exists. Seeded from
  // `initialName` so returning players don't have to retype it.
  const [name, setName] = useState(initialName);
  const [roomCode, setRoomCode] = useState("");

  const trimmedName = name.trim();

  return (
    <div className="card stack">
      <h2>Play</h2>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Alice"
        />
      </label>

      <button
        className="btn btn-primary"
        disabled={!trimmedName || pending}
        onClick={() => onCreateRoom(trimmedName)}
      >
        Create a new room
      </button>

      <p className="divider">— or —</p>

      <div className="stack-sm">
        <label className="field">
          <span>Room code</span>
          <input
            value={roomCode}
            // Room codes are always uppercase (see game.ts's
            // ROOM_CODE_ALPHABET) — uppercasing here means a friend can type
            // it in lowercase without it mattering.
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            placeholder="ABCD"
            maxLength={4}
          />
        </label>
        <button
          className="btn"
          disabled={!trimmedName || !roomCode.trim() || pending}
          onClick={() => onJoinRoom(roomCode.trim(), trimmedName)}
        >
          Join room
        </button>
      </div>

      {error && <p className="alert">{error}</p>}
    </div>
  );
}
