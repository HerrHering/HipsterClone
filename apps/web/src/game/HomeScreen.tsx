import { useState } from "react";
import { IconMusic, IconUsers } from "../icons";

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
  const [pendingAction, setPendingAction] = useState<"create" | "join" | null>(null);

  const trimmedName = name.trim();

  return (
    <form
      className="card stack home-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmedName || pending) return;
        setPendingAction("create");
        onCreateRoom(trimmedName);
      }}
    >
      <div className="stack-sm">
        <h1 className="screen-heading">Play HipsterClone</h1>
        <p className="screen-subtitle">Listen, place songs in time, and challenge your friends.</p>
      </div>

      <label className="field">
        <span>Your name</span>
        <input
          id="player-name"
          name="playerName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Alice"
          autoComplete="name"
          aria-describedby="name-help"
        />
        <small id="name-help" className="field-help">Needed whether you host or join.</small>
      </label>

      <section className="home-action stack-sm" aria-labelledby="host-heading">
        <h2 id="host-heading">Host a game</h2>
        <p className="screen-subtitle">Create a room and share its code.</p>
        <button className="btn btn-primary" type="submit" disabled={!trimmedName || pending} aria-busy={pendingAction === "create" && pending}>
          <IconMusic size={18} /> {pendingAction === "create" && pending ? "Creating room…" : "Create a new room"}
        </button>
      </section>

      <p className="divider" aria-hidden="true">or</p>

      <section className="home-action home-action-secondary stack-sm" aria-labelledby="join-heading">
        <h2 id="join-heading">Join a game</h2>
        <label className="field">
          <span>Room code</span>
          <input
            id="room-code"
            name="roomCode"
            value={roomCode}
            // Room codes are always uppercase (see game.ts's
            // ROOM_CODE_ALPHABET) — uppercasing here means a friend can type
            // it in lowercase without it mattering.
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            placeholder="ABCD"
            maxLength={4}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            aria-describedby="room-code-help"
            onKeyDown={(event) => {
              if (event.key === "Enter" && trimmedName && roomCode.trim() && !pending) {
                event.preventDefault();
                setPendingAction("join");
                onJoinRoom(roomCode.trim(), trimmedName);
              }
            }}
          />
          <small id="room-code-help" className="field-help">Enter the four-character code from the host.</small>
        </label>
        <button
          className="btn"
          type="button"
          disabled={!trimmedName || !roomCode.trim() || pending}
          aria-busy={pendingAction === "join" && pending}
          onClick={() => {
            setPendingAction("join");
            onJoinRoom(roomCode.trim(), trimmedName);
          }}
        >
          <IconUsers size={18} /> {pendingAction === "join" && pending ? "Joining room…" : "Join room"}
        </button>
      </section>

      {error && <p className="blob blob-danger blob-sm" role="alert">{error}</p>}
    </form>
  );
}
