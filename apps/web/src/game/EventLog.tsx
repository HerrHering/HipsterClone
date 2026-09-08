import { useEffect, useRef } from "react";

interface Props {
  entries: string[];
}

// A Catan-style activity feed: whatever game.ts's pushLog recorded, oldest
// first. Auto-scrolls to the bottom whenever a new entry arrives, so
// there's never a need to manually scroll down to see what just happened.
export function EventLog({ entries }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries.length]);

  return (
    // A native <details>, not a div + button + JS-driven boolean: closed
    // by default (so it doesn't push the board off a phone screen), and
    // forced open on wider screens by index.css overriding the browser's
    // own "closed details hides its children" rule — no JS state needed
    // either way, see index.css's ".event-log" comment.
    <details className="card event-log">
      <summary>Activity</summary>
      <ul ref={listRef}>
        {entries.length === 0 && <li className="event-log-empty">No activity yet.</li>}
        {entries.map((entry, index) => (
          // Plain strings, no id — game.ts's log is append-only apart from
          // the occasional trim of its oldest lines (see MAX_LOG_ENTRIES),
          // and nothing here is stateful/animated per-entry, so an index
          // key is safe: at worst a trimmed line's old index briefly shows
          // different text, never a broken or duplicated element.
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </details>
  );
}
