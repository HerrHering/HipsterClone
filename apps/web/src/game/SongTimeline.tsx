import { Fragment, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { TimelineCard } from "@hipster-clone/shared";
import { GAP_VISUAL_INLINE, EDGE_PADDING, type TimelineOrientation } from "./boardModel";
import { SongCard } from "./SongCard";
import { describeTimelineGap, type SongLookup } from "./songText";
import { useTimelineScale } from "./useTimelineScale";

export interface TimelineMarker {
  label: string;
  tone?: "success" | "danger" | "neutral";
  symbol?: "card" | "token";
}

interface Props {
  timeline: TimelineCard[];
  songsById: SongLookup;
  orientation?: TimelineOrientation;
  selected?: number | null;
  hovered?: number | null;
  source?: "card" | "token";
  onSelect?: (position: number) => void;
  onCancel?: () => void;
  legalPositions?: number[];
  claimedSlots?: Map<number, string>;
  markers?: Map<number, TimelineMarker[]>;
  validRange?: { low: number; high: number };
}

export function SongTimeline({ timeline, songsById, orientation = "horizontal", selected = null, hovered = null, source = "card", onSelect, onCancel, legalPositions, claimedSlots, markers, validRange }: Props) {
  const { ref, geometry, available } = useTimelineScale(timeline.length, orientation);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const legal = legalPositions ?? Array.from({ length: timeline.length + 1 }, (_, index) => index);
  const legalSet = new Set(legal);
  const scaledInline = geometry.naturalInline * geometry.scale;
  const scaledBlock = geometry.cardBlock * geometry.scale;
  const stageInline = Math.max(44, geometry.mode === "scroll" ? scaledInline : Math.min(available, scaledInline));
  const stageStyle = {
    "--timeline-scale": geometry.scale,
    "--timeline-natural-inline": `${geometry.naturalInline}px`,
    "--timeline-card-inline": `${geometry.cardInline}px`,
    "--timeline-card-block": `${geometry.cardBlock}px`,
    ...(orientation === "horizontal" ? { width: `${stageInline}px`, height: `${scaledBlock}px` } : { height: `${stageInline}px`, width: `${scaledBlock}px` }),
  } as CSSProperties;

  function gapCenter(position: number): number {
    const raw = EDGE_PADDING + GAP_VISUAL_INLINE / 2 + position * (geometry.cardInline + GAP_VISUAL_INLINE);
    return Math.max(22, Math.min(stageInline - 22, raw * geometry.scale));
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    const backward = orientation === "horizontal" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const forward = orientation === "horizontal" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!backward && !forward && event.key !== "Home" && event.key !== "End" && event.key !== "Escape") return;
    event.preventDefault();
    if (event.key === "Escape") return onCancel?.();
    const current = legal.indexOf(position);
    const next = event.key === "Home" ? legal[0] : event.key === "End" ? legal.at(-1) : backward ? legal[(current - 1 + legal.length) % legal.length] : legal[(current + 1) % legal.length];
    if (next !== undefined) buttonRefs.current[next]?.focus();
  }

  return (
    <div ref={ref} className={`timeline-viewport timeline-${orientation} timeline-mode-${geometry.mode}`}>
      <span className="timeline-direction" aria-hidden="true">Start → End</span>
      <div className="timeline-stage" style={stageStyle}>
        <div className="timeline-visual" aria-label={`${timeline.length} card timeline`}>
          {Array.from({ length: timeline.length + 1 }, (_, position) => (
            <Fragment key={position}>
              <span className="timeline-spacer" aria-hidden="true" />
              {position < timeline.length && <SongCard songId={timeline[position]!.songId} song={songsById[timeline[position]!.songId]} year={timeline[position]!.year} size="sm" yearOnly className="timeline-card" />}
            </Fragment>
          ))}
        </div>
        <div className="timeline-hit-layer">
          {Array.from({ length: timeline.length + 1 }, (_, position) => {
            const claimed = claimedSlots?.get(position);
            const enabled = Boolean(onSelect) && legalSet.has(position) && !claimed;
            const label = `${describeTimelineGap(timeline, position)}${claimed ? `. Claimed by ${claimed}; unavailable.` : ""}`;
            const markerList = markers?.get(position) ?? [];
            const isValid = validRange && position >= validRange.low && position <= validRange.high;
            const style = orientation === "horizontal" ? { left: `${gapCenter(position)}px` } : { top: `${gapCenter(position)}px` };
            return (
              <button ref={(element) => { buttonRefs.current[position] = element; }} key={position} type="button" className={`timeline-gap${position === selected ? " is-selected" : ""}${position === hovered ? " is-hovered" : ""}${claimed ? " is-claimed" : ""}${isValid ? " is-valid" : ""}`} style={style} data-gap-position={position} disabled={!enabled} aria-label={label} onClick={() => enabled && onSelect?.(position)} onKeyDown={(event) => moveFocus(event, position)}>
                <span className="timeline-marker" aria-hidden="true" />
                {(position === selected || position === hovered) && <span className={`selection-ghost ghost-${source}`} aria-hidden="true">{source === "token" ? "♪" : "?"}</span>}
                {markerList.map((marker, index) => <span key={`${marker.label}-${index}`} className={`claim-marker marker-${marker.tone ?? "neutral"}`}>{marker.tone === "success" ? "✓ " : marker.tone === "danger" ? "✕ " : ""}{marker.label}</span>)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
