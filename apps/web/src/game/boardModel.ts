import type { GameState, TimelineCard } from "@hipster-clone/shared";
import { currentPlayerId } from "@hipster-clone/shared";

export type SeatName =
  | "bottom"
  | "top"
  | "left"
  | "right"
  | "lower-left"
  | "lower-right"
  | "upper-left"
  | "upper-right";
export type TimelineOrientation = "horizontal" | "vertical";
export type LayoutMode = "table" | "list";
export type ZoneEmphasis = "active" | "actionable" | "spectator" | "winner";

export interface SeatDescriptor {
  seat: SeatName;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: TimelineOrientation;
}

export interface SeatedPlayer extends SeatDescriptor {
  playerId: string;
  seatIndex: number;
}

const SEATS: Record<number, SeatDescriptor[]> = {
  2: [
    { seat: "bottom", x: 50, y: 86, width: 34, height: 23, orientation: "horizontal" },
    { seat: "top", x: 50, y: 14, width: 34, height: 23, orientation: "horizontal" },
  ],
  3: [
    { seat: "bottom", x: 50, y: 86, width: 34, height: 23, orientation: "horizontal" },
    { seat: "lower-right", x: 85, y: 30, width: 27, height: 42, orientation: "vertical" },
    { seat: "lower-left", x: 15, y: 30, width: 27, height: 42, orientation: "vertical" },
  ],
  4: [
    { seat: "bottom", x: 50, y: 86, width: 34, height: 23, orientation: "horizontal" },
    { seat: "right", x: 86, y: 50, width: 25, height: 49, orientation: "vertical" },
    { seat: "top", x: 50, y: 14, width: 34, height: 23, orientation: "horizontal" },
    { seat: "left", x: 14, y: 50, width: 25, height: 49, orientation: "vertical" },
  ],
  5: [
    { seat: "bottom", x: 50, y: 87, width: 34, height: 21, orientation: "horizontal" },
    { seat: "lower-right", x: 85, y: 69, width: 16, height: 26, orientation: "vertical" },
    { seat: "upper-right", x: 75, y: 18, width: 32, height: 20, orientation: "horizontal" },
    { seat: "upper-left", x: 25, y: 18, width: 32, height: 20, orientation: "horizontal" },
    { seat: "lower-left", x: 15, y: 69, width: 16, height: 26, orientation: "vertical" },
  ],
  6: [
    { seat: "bottom", x: 50, y: 88, width: 34, height: 20, orientation: "horizontal" },
    { seat: "lower-right", x: 84, y: 72, width: 18, height: 31, orientation: "vertical" },
    { seat: "upper-right", x: 84, y: 28, width: 18, height: 31, orientation: "vertical" },
    { seat: "top", x: 50, y: 12, width: 34, height: 20, orientation: "horizontal" },
    { seat: "upper-left", x: 16, y: 28, width: 18, height: 31, orientation: "vertical" },
    { seat: "lower-left", x: 16, y: 72, width: 18, height: 31, orientation: "vertical" },
  ],
};

export function rotateTurnOrder(turnOrder: string[], viewerId: string): string[] {
  const found = turnOrder.indexOf(viewerId);
  const start = found < 0 ? 0 : found;
  return turnOrder.slice(start).concat(turnOrder.slice(0, start));
}

export function layoutMode(playerCount: number): LayoutMode {
  return playerCount >= 2 && playerCount <= 6 ? "table" : "list";
}

export function seatPlayers(turnOrder: string[], viewerId: string): SeatedPlayer[] {
  const order = rotateTurnOrder(turnOrder, viewerId);
  const descriptors = SEATS[order.length];
  if (!descriptors) {
    return order.map((playerId, seatIndex) => ({
      playerId,
      seatIndex,
      seat: seatIndex === 0 ? "bottom" : "top",
      x: 50,
      y: 0,
      width: 100,
      height: 0,
      orientation: "horizontal",
    }));
  }
  return order.map((playerId, seatIndex) => ({ playerId, seatIndex, ...descriptors[seatIndex]! }));
}

export interface BoardInteraction {
  activeId: string | null;
  canControlAudio: boolean;
  canPlace: boolean;
  canVote: boolean;
  canAttemptSteal: boolean;
  canPass: boolean;
  canReveal: boolean;
  canClaimGuessToken: boolean;
  canNextTurn: boolean;
  targetTimelineId: string | null;
  myVote: { playerId: string; position: number | null } | undefined;
}

export function deriveBoardInteraction(state: GameState, viewerId: string): BoardInteraction {
  const activeId = currentPlayerId(state);
  const recognized = state.players[viewerId] !== undefined;
  const isActive = recognized && viewerId === activeId;
  const votes = state.phase.type === "stealWindow" || state.phase.type === "pendingReveal"
    ? state.phase.votes
    : [];
  const myVote = votes.find((vote) => vote.playerId === viewerId);
  const canVote = state.phase.type === "stealWindow" && recognized && !isActive && !myVote;
  return {
    activeId,
    canControlAudio: state.phase.type === "playingSong" && isActive,
    canPlace: state.phase.type === "playingSong" && isActive,
    canVote,
    canAttemptSteal: canVote && state.players[viewerId]!.tokens > 0,
    canPass: canVote,
    canReveal: state.phase.type === "pendingReveal" && isActive,
    canClaimGuessToken: state.phase.type === "reveal" && isActive && !state.phase.guessTokenClaimed,
    canNextTurn: state.phase.type === "reveal" && isActive,
    targetTimelineId: state.phase.type === "playingSong" ? activeId :
      state.phase.type === "stealWindow" || state.phase.type === "pendingReveal" || state.phase.type === "reveal"
        ? activeId : null,
    myVote,
  };
}

export function claimedGaps(state: GameState): Map<number, string> {
  const claimed = new Map<number, string>();
  if (state.phase.type !== "stealWindow" && state.phase.type !== "pendingReveal" && state.phase.type !== "reveal") {
    return claimed;
  }
  const activeId = currentPlayerId(state);
  claimed.set(state.phase.activePlacementPosition, activeId ? state.players[activeId]?.name ?? "Active player" : "Active player");
  for (const vote of state.phase.votes) {
    if (vote.position !== null) claimed.set(vote.position, state.players[vote.playerId]?.name ?? vote.playerId);
  }
  return claimed;
}

export function zoneEmphasis(state: GameState, viewerId: string, zoneId: string): ZoneEmphasis {
  if (state.phase.type === "gameOver") return state.phase.winnerId === zoneId ? "winner" : "spectator";
  const interaction = deriveBoardInteraction(state, viewerId);
  if (zoneId === interaction.activeId) return "active";
  if (interaction.canVote && zoneId === viewerId) return "actionable";
  return "spectator";
}

export type PlacementSelection =
  | { kind: "idle" }
  | { kind: "picked"; source: "card" | "token"; over: number | null }
  | { kind: "selected"; source: "card" | "token"; position: number };
export type SelectionEvent =
  | { type: "PICK_UP"; source: "card" | "token" }
  | { type: "MOVE_OVER"; position: number | null }
  | { type: "DROP"; position: number }
  | { type: "SELECT"; source: "card" | "token"; position: number }
  | { type: "CANCEL" };

export function selectionReducer(selection: PlacementSelection, event: SelectionEvent): PlacementSelection {
  switch (event.type) {
    case "PICK_UP": return { kind: "picked", source: event.source, over: null };
    case "MOVE_OVER": return selection.kind === "picked" ? { ...selection, over: event.position } : selection;
    case "DROP": return selection.kind === "picked" ? { kind: "selected", source: selection.source, position: event.position } : selection;
    case "SELECT": return { kind: "selected", source: event.source, position: event.position };
    case "CANCEL": return { kind: "idle" };
  }
}

export function reconcileSelection(selection: PlacementSelection, legalPositions: number[]): PlacementSelection {
  if (selection.kind === "idle") return selection;
  const position = selection.kind === "selected" ? selection.position : selection.over;
  if (position !== null && !legalPositions.includes(position)) return { kind: "idle" };
  return selection;
}

export function legalTimelinePositions(timeline: TimelineCard[], unavailable: Iterable<number> = []): number[] {
  const blocked = new Set(unavailable);
  return Array.from({ length: timeline.length + 1 }, (_, index) => index).filter((index) => !blocked.has(index));
}

export function revealTargetTimeline(state: GameState): TimelineCard[] {
  if (state.phase.type !== "reveal") return [];
  const songId = state.phase.songId;
  const activeId = currentPlayerId(state);
  const timeline = activeId ? state.players[activeId]?.timeline ?? [] : [];
  return state.phase.activePlacementCorrect
    ? timeline.filter((card) => card.songId !== songId)
    : timeline.slice();
}

export const NORMAL_CARD_INLINE = 64;
export const NORMAL_CARD_BLOCK = 86;
export const COMPACT_CARD_INLINE = 48;
export const COMPACT_CARD_BLOCK = 68;
export const GAP_VISUAL_INLINE = 14;
export const EDGE_PADDING = 8;
export const MIN_SCALE = 0.42;

export interface TimelineScale {
  mode: "normal" | "compact" | "scroll";
  scale: number;
  cardInline: number;
  cardBlock: number;
  naturalInline: number;
}

export function calculateTimelineScale(availableInline: number, cardCount: number): TimelineScale {
  const natural = (cardInline: number) => 2 * EDGE_PADDING + cardCount * cardInline + (cardCount + 1) * GAP_VISUAL_INLINE;
  const normalNatural = natural(NORMAL_CARD_INLINE);
  const normalScale = Math.min(1, availableInline / normalNatural);
  if (normalScale >= MIN_SCALE) return { mode: "normal", scale: normalScale, cardInline: NORMAL_CARD_INLINE, cardBlock: NORMAL_CARD_BLOCK, naturalInline: normalNatural };
  const compactNatural = natural(COMPACT_CARD_INLINE);
  const compactScale = Math.min(1, availableInline / compactNatural);
  if (compactScale >= MIN_SCALE) return { mode: "compact", scale: compactScale, cardInline: COMPACT_CARD_INLINE, cardBlock: COMPACT_CARD_BLOCK, naturalInline: compactNatural };
  return { mode: "scroll", scale: MIN_SCALE, cardInline: COMPACT_CARD_INLINE, cardBlock: COMPACT_CARD_BLOCK, naturalInline: compactNatural };
}
