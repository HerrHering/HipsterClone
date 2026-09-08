import type { CSSProperties, HTMLAttributes } from "react";
import type { PlayerState, TimelineCard } from "@hipster-clone/shared";
import { IconCrown } from "../icons";
import type { SeatedPlayer, ZoneEmphasis } from "./boardModel";
import { SongTimeline, type TimelineMarker } from "./SongTimeline";
import type { SongLookup } from "./songText";
import { TokenPile } from "./TokenPile";

interface Props {
  player: PlayerState;
  seat: SeatedPlayer;
  songsById: SongLookup;
  layoutMode: "table" | "list";
  host: boolean;
  viewer: boolean;
  active: boolean;
  winner: boolean;
  emphasis: ZoneEmphasis;
  voteStatus?: string;
  winTarget: number;
  draggableToken: boolean;
  tokenHandlers?: HTMLAttributes<HTMLButtonElement>;
  interaction?: {
    selected: number | null;
    hovered: number | null;
    source: "card" | "token";
    legalPositions: number[];
    claimedSlots?: Map<number, string>;
    markers?: Map<number, TimelineMarker[]>;
    validRange?: { low: number; high: number };
    onSelect: (position: number) => void;
    onCancel: () => void;
  };
  readOnlyMarkers?: Map<number, TimelineMarker[]>;
  validRange?: { low: number; high: number };
  timelineOverride?: TimelineCard[];
}

export function PlayerZone({ player, seat, songsById, layoutMode, host, viewer, active, winner, emphasis, voteStatus, winTarget, draggableToken, tokenHandlers, interaction, readOnlyMarkers, validRange, timelineOverride }: Props) {
  const timeline = timelineOverride ?? player.timeline;
  const seatStyle = layoutMode === "table" ? {
    "--seat-x": `${seat.x}%`,
    "--seat-y": `${seat.y}%`,
    "--seat-w": `${seat.width}%`,
    "--seat-h": `${seat.height}%`,
  } as CSSProperties : undefined;
  const status = winner ? "Winner" : voteStatus ?? (active ? "On turn" : emphasis === "actionable" ? "Your action" : undefined);
  return (
    <section className={`player-zone seat-${seat.seat} emphasis-${emphasis}`} style={seatStyle} aria-label={`${player.name}'s timeline`}>
      <div className="zone-tokens"><TokenPile count={player.tokens} draggable={draggableToken} sourceHandlers={tokenHandlers} /></div>
      <div className="player-plate">
        <strong title={player.name}>{player.name}</strong>
        <span className="plate-badges">
          {host && <span title="Room host"><IconCrown size={13} /> Host</span>}
          {viewer && <span>You</span>}
          {status && <span>{status}</span>}
          <span>{player.timeline.length} / {winTarget}</span>
        </span>
      </div>
      <SongTimeline
        timeline={timeline}
        songsById={songsById}
        orientation={layoutMode === "list" ? "horizontal" : seat.orientation}
        selected={interaction?.selected}
        hovered={interaction?.hovered}
        source={interaction?.source}
        onSelect={interaction?.onSelect}
        onCancel={interaction?.onCancel}
        legalPositions={interaction?.legalPositions}
        claimedSlots={interaction?.claimedSlots}
        markers={interaction?.markers ?? readOnlyMarkers}
        validRange={interaction?.validRange ?? validRange}
      />
    </section>
  );
}
