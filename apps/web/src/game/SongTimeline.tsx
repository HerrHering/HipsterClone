import { Fragment } from "react";
import type { TimelineCard } from "@hipster-clone/shared";
import { SongCard } from "./SongCard";
import { describeSlot, type SongLookup } from "./songText";

interface Props {
  timeline: TimelineCard[];
  songsById: SongLookup;
  selected?: number | null;
  onSelect?: (position: number) => void;
  claimedSlots?: Map<number, string>;
  // Post-reveal only: colors specific gaps by correctness — the active
  // placement and every real vote, green if it fell within the correct
  // range (game.ts's correctInsertionRange), red otherwise. See
  // RevealPanel. Omitted everywhere else.
  positionTones?: Map<number, "success" | "danger">;
  ariaLabel?: string;
  describedBy?: string;
}

// The real, physical-feeling timeline: a row of SongCards with a gap
// between each one (and one before the first / after the last). Replaces
// the old SlotPicker's row of "[before] X / [between] X and Y / [after] X"
// text buttons.
//
// Each gap is a real, always-present <button> — the exact same onClick
// handles a mouse click and a phone tap, so there's only one interaction
// path to reason about. Hover (and keyboard focus) is a pure CSS
// enhancement layered on top (see index.css's .timeline-gap:hover rule);
// it simply never matches on touch, no branching needed. `onSelect` being
// optional (omitted for a read-only "just watching" board) mirrors the old
// SlotPicker's own contract exactly.
export function SongTimeline({
  timeline,
  songsById,
  selected = null,
  onSelect,
  claimedSlots,
  positionTones,
  ariaLabel,
  describedBy,
}: Props) {
  const slotCount = timeline.length + 1;

  function gapClassName(position: number, claimedBy: string | undefined): string {
    const classes = ["timeline-gap"];
    if (claimedBy !== undefined) {
      classes.push("timeline-gap-claimed");
    } else if (position === selected) {
      classes.push("timeline-gap-selected");
    }
    const tone = positionTones?.get(position);
    if (tone) {
      classes.push(tone === "success" ? "timeline-gap-success" : "timeline-gap-danger");
    }
    return classes.join(" ");
  }

  function renderGap(position: number) {
    const claimedBy = claimedSlots?.get(position);
    const tone = positionTones?.get(position);
    const isSelected = position === selected;
    const context = [
      isSelected ? "selected" : null,
      claimedBy ? `claimed by ${claimedBy}` : null,
      tone === "success" ? "correct position" : tone === "danger" ? "incorrect position" : null,
    ].filter(Boolean).join(", ");
    return (
      <button
        key={`gap-${position}`}
        type="button"
        className={gapClassName(position, claimedBy)}
        disabled={!onSelect || claimedBy !== undefined}
        onClick={() => onSelect?.(position)}
        aria-label={`${describeSlot(songsById, timeline, position)}${context ? `, ${context}` : ""}`}
        aria-pressed={onSelect ? isSelected : undefined}
      >
        <span className="timeline-marker" />
        {claimedBy && <span className="timeline-gap-label">{claimedBy}</span>}
        {isSelected && !claimedBy && <span className="timeline-gap-state" aria-hidden="true">Selected</span>}
        {tone && <span className="timeline-result-mark" aria-hidden="true">{tone === "success" ? "✓" : "×"}</span>}
      </button>
    );
  }

  return (
    <div className="timeline-scroll" role={onSelect ? "group" : undefined} aria-label={ariaLabel} aria-describedby={describedBy}>
      <div className="timeline-strip">
        {Array.from({ length: slotCount }, (_, position) => (
          <Fragment key={position}>
            {renderGap(position)}
            {position < timeline.length && (
              <SongCard
                songId={timeline[position]!.songId}
                song={songsById[timeline[position]!.songId]}
                size="md"
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
