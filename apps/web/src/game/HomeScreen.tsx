import { useState } from "react";

interface Props {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (roomCode: string, name: string) => void;
  pending: boolean;
  error: string | null;
}

// The very first screen: pick a name, then either create a fresh room or
// join one a friend already created. Nothing here talks to the server
// directly — App.tsx owns that, and just passes down what to call.
export function HomeScreen({ onCreateRoom, onJoinRoom, pending, error }: Props) {
  // Local, un-submitted form state — only App.tsx's state (roomCode,
  // playerId) actually matters once a room exists.
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const trimmedName = name.trim();

  return (
    <div>
      <h2>Play</h2>
      <p>
        <label>
          Your name{" "}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alice"
          />
        </label>
      </p>

      <p>
        <button
          disabled={!trimmedName || pending}
          onClick={() => onCreateRoom(trimmedName)}
        >
          Create a new room
        </button>
      </p>

      <p>— or —</p>

      <p>
        <label>
          Room code{" "}
          <input
            value={roomCode}
            // Room codes are always uppercase (see game.ts's
            // ROOM_CODE_ALPHABET) — uppercasing here means a friend can type
            // it in lowercase without it mattering.
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            placeholder="ABCD"
            maxLength={4}
          />
        </label>{" "}
        <button
          disabled={!trimmedName || !roomCode.trim() || pending}
          onClick={() => onJoinRoom(roomCode.trim(), trimmedName)}
        >
          Join room
        </button>
      </p>

      {error && <p>{error}</p>}
    </div>
  );
}
