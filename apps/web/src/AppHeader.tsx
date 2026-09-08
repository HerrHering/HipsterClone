import { IconLogOut, IconMusic } from "./icons";

interface Props {
  // Omitted pre-seat (HomeScreen) — same optional-prop-omission pattern
  // SongTimeline's onSelect already uses for "this piece of UI doesn't
  // apply yet."
  roomCode?: string;
  turnLabel?: string;
  onLeave?: () => void;
  muted?: boolean;
  onToggleMute?: () => void;
}

// A slim, persistent bar replacing the old static <h1>HipsterClone</h1> and
// each screen's own duplicated "Room {code}"/"You are X"/"Leave room" bits.
// Sticky (see index.css's .app-header) so the room code and leave action
// stay reachable without scrolling back up — the "reorganize so it's
// easier to navigate" ask, without introducing tabs or routing.
export function AppHeader({ roomCode, turnLabel, onLeave, muted = false, onToggleMute }: Props) {
  return (
    <header className="app-header">
      <span className="app-header-brand">
        <IconMusic />
        HipsterClone
      </span>
      <div className="app-header-info">
        {roomCode && (
          <span className="app-header-room">
            <span className="app-header-room-label">Room code:</span>
            {roomCode}
          </span>
        )}
        {turnLabel && <span className="badge badge-accent">{turnLabel}</span>}
        {onToggleMute && (
          <button className="btn btn-outline mute-button" onClick={onToggleMute} aria-pressed={muted} aria-label={muted ? "Unmute this device" : "Mute this device"}>
            {muted ? "Unmute this device" : "Mute this device"}
          </button>
        )}
        {onLeave && (
          <button className="btn btn-danger-outline" onClick={onLeave} aria-label="Leave room">
            <IconLogOut size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
