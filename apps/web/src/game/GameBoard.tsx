import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { GameAction, GameState } from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import { prefetchAudio } from "./api";
import { AudioControls } from "./AudioControls";
import {
  claimedGaps,
  deriveBoardInteraction,
  layoutMode,
  legalTimelinePositions,
  reconcileSelection,
  revealTargetTimeline,
  seatPlayers,
  selectionReducer,
  zoneEmphasis,
} from "./boardModel";
import { EventLog } from "./EventLog";
import { MysteryCard } from "./MysteryCard";
import { PlayerZone } from "./PlayerZone";
import type { TimelineMarker } from "./SongTimeline";
import { describeSong, describeTimelineGap, type SongLookup } from "./songText";
import { usePointerPlacement } from "./usePointerPlacement";

interface Props {
  playerId: string;
  state: GameState;
  songsById: SongLookup;
  muted: boolean;
  onAction: (action: GameAction) => Promise<void>;
}

function statusText(state: GameState, viewerId: string, activeId: string | null): string {
  const activeName = activeId ? state.players[activeId]?.name ?? "the active player" : "the active player";
  const isActive = activeId === viewerId;
  switch (state.phase.type) {
    case "lobby": return "Waiting for the game to start.";
    case "playingSong": return isActive ? "Your turn — play the song, then drag the mystery card into your timeline." : `Listen along while ${activeName} places the mystery card.`;
    case "stealWindow": {
      if (isActive) return "Your placement is locked. Other players may contest it now.";
      const vote = state.phase.votes.find((item) => item.playerId === viewerId);
      if (!vote) return "Drag a token to an open gap to contest, or pass.";
      return vote.position === null ? "You passed. Waiting for the remaining votes." : "Your contest is locked. Waiting for the remaining votes.";
    }
    case "pendingReveal": return isActive ? "All votes are in — make an optional guess, then reveal the card." : `All votes are in. ${activeName} will reveal the answer.`;
    case "reveal": return isActive ? "The answer is revealed. Finish the round when everyone is ready." : `The answer is revealed. Waiting for ${activeName}.`;
    case "gameOver": return `${state.players[state.phase.winnerId]?.name ?? "The winner"} won the game!`;
  }
}

export function GameBoard({ playerId, state, songsById, muted, onAction }: Props) {
  const interaction = deriveBoardInteraction(state, playerId);
  const activeId = interaction.activeId;
  const activePlayer = activeId ? state.players[activeId] : undefined;
  const [selection, dispatch] = useReducer(selectionReducer, { kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [guessDraft, setGuessDraft] = useState("");
  const [lockedGuess, setLockedGuess] = useState<string | null>(null);
  const prefetched = useRef<string | null>(null);
  const tableScrollport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.nextSongId || prefetched.current === state.nextSongId) return;
    prefetched.current = state.nextSongId;
    void prefetchAudio(state.nextSongId).catch((error: unknown) => console.error("prefetchAudio() failed:", error));
  }, [state.nextSongId]);

  async function act(action: GameAction, kind: string): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(kind);
    setActionError(null);
    try {
      await onAction(action);
      return true;
    } catch (error) {
      const message = errorMessage(error);
      setActionError(message);
      setAnnouncement(`Action failed: ${message}`);
      return false;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  const claims = useMemo(() => claimedGaps(state), [state]);
  const targetTimeline = state.phase.type === "reveal" ? revealTargetTimeline(state) : activePlayer?.timeline ?? [];
  const source: "card" | "token" = interaction.canPlace ? "card" : "token";
  const legalPositions = interaction.canPlace
    ? legalTimelinePositions(targetTimeline)
    : interaction.canAttemptSteal ? legalTimelinePositions(targetTimeline, claims.keys()) : [];
  const reconciled = reconcileSelection(selection, legalPositions);

  useEffect(() => {
    if (selection.kind !== "idle" && reconciled.kind === "idle") {
      dispatch({ type: "CANCEL" });
      if (selection.source === "token" && interaction.canVote) {
        // Poll reconciliation is intentionally surfaced to assistive tech.
        // oxlint-disable-next-line react/set-state-in-effect
        setAnnouncement("That gap was claimed by another player; choose another gap or pass.");
        document.getElementById("token-drag-source")?.focus();
      }
    }
  }, [interaction.canVote, reconciled.kind, selection]);

  const pointer = usePointerPlacement({ enabled: source === "card" ? interaction.canPlace : interaction.canAttemptSteal, source, legalPositions, selection, dispatch, announce: setAnnouncement });
  const selectedPosition = selection.kind === "selected" && selection.source === source ? selection.position : null;
  const hoveredPosition = selection.kind === "picked" && selection.source === source ? selection.over : null;

  function selectGap(position: number) {
    dispatch({ type: "SELECT", source, position });
    setAnnouncement(`${describeTimelineGap(targetTimeline, position)} selected. Confirm when ready.`);
  }

  const markers = new Map<number, TimelineMarker[]>();
  if (state.phase.type === "stealWindow" || state.phase.type === "pendingReveal" || state.phase.type === "reveal") {
    const low = state.phase.type === "reveal" ? state.phase.correctPositionRange.low : null;
    const high = state.phase.type === "reveal" ? state.phase.correctPositionRange.high : null;
    const add = (position: number, label: string) => {
      const tone = low === null || high === null ? "neutral" : position >= low && position <= high ? "success" : "danger";
      const resultLabel = tone === "success" ? `${label} · Correct` : tone === "danger" ? `${label} · Incorrect` : label;
      markers.set(position, [...(markers.get(position) ?? []), { label: resultLabel, tone }]);
    };
    add(state.phase.activePlacementPosition, activePlayer?.name ?? "Active player");
    for (const vote of state.phase.votes) if (vote.position !== null) add(vote.position, state.players[vote.playerId]?.name ?? vote.playerId);
  }

  const seated = seatPlayers(state.turnOrder, playerId);
  const mode = layoutMode(seated.length);
  const visualById = new Map(seated.map((seat) => [seat.playerId, seat]));
  const domOrder = [playerId, activeId, ...seated.map((seat) => seat.playerId)].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
  const voteStatus = new Map<string, string>();
  if (state.phase.type === "stealWindow" || state.phase.type === "pendingReveal" || state.phase.type === "reveal") {
    for (const id of state.turnOrder) {
      if (id === activeId) continue;
      const vote = state.phase.votes.find((item) => item.playerId === id);
      voteStatus.set(id, vote ? vote.position === null ? "Passed" : "Vote submitted" : "Still deciding");
    }
  }
  const validRange = state.phase.type === "reveal" ? state.phase.correctPositionRange : undefined;
  const boardInteraction = activeId && (interaction.canPlace || interaction.canAttemptSteal) ? {
    selected: selectedPosition,
    hovered: hoveredPosition,
    source,
    legalPositions,
    claimedSlots: interaction.canAttemptSteal ? claims : undefined,
    markers,
    validRange,
    onSelect: selectGap,
    onCancel: () => dispatch({ type: "CANCEL" as const }),
  } : undefined;

  const outcome = state.phase.type === "reveal"
    ? state.phase.activePlacementCorrect ? `${activePlayer?.name ?? "The active player"} placed it correctly.`
      : state.phase.stolenBy ? `${state.players[state.phase.stolenBy]?.name ?? "A player"} won the steal.` : "No placement was correct; the card is discarded."
    : null;

  useEffect(() => {
    const scrollport = tableScrollport.current;
    if (!scrollport || mode !== "table") return;
    scrollport.scrollLeft = Math.max(0, (scrollport.scrollWidth - scrollport.clientWidth) / 2);
    scrollport.scrollTop = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
  }, [mode]);

  return (
    <div className="game-board">
      <p className="turn-instruction" role="status">{statusText(state, playerId, activeId)}</p>
      <p className="table-scroll-hint">Drag or scroll the table to see every player</p>
      <div ref={tableScrollport} className="tabletop-scrollport">
        <div className={mode === "table" ? "tabletop" : "tabletop tabletop-list"}>
          <section className={`draw-stack${state.phase.type === "reveal" ? " is-revealed" : ""}`} aria-label="Draw pile and turn actions">
            {state.phase.type === "gameOver" ? (
              <div className="winner-card"><span>Winner</span><strong>{state.players[state.phase.winnerId]?.name ?? "Unknown player"}</strong></div>
            ) : state.phase.type === "reveal" ? (
              <MysteryCard side="back" songId={state.phase.songId} song={songsById[state.phase.songId]} correctYear={state.phase.correctYear} tone={state.phase.activePlacementCorrect ? "correct" : "incorrect"} />
            ) : (
              <MysteryCard side="front" draggable={interaction.canPlace} sourceHandlers={interaction.canPlace ? pointer.sourceHandlers : undefined} />
            )}
            {state.playback && <AudioControls key={state.playback.songId} playback={state.playback} canControl={interaction.canControlAudio} muted={muted} onAction={(action) => act(action, "audio")} />}
          </section>

          {domOrder.map((id) => {
            const player = state.players[id];
            const seat = visualById.get(id);
            if (!player || !seat) return null;
            const target = id === activeId;
            return <PlayerZone key={id} player={player} seat={seat} songsById={songsById} layoutMode={mode} host={id === state.hostId} viewer={id === playerId} active={target && state.phase.type !== "gameOver"} winner={state.phase.type === "gameOver" && id === state.phase.winnerId} emphasis={zoneEmphasis(state, playerId, id)} voteStatus={voteStatus.get(id)} winTarget={state.settings.winTarget} draggableToken={id === playerId && interaction.canAttemptSteal} tokenHandlers={id === playerId && interaction.canAttemptSteal ? pointer.sourceHandlers : undefined} interaction={target ? boardInteraction : undefined} readOnlyMarkers={target ? markers : undefined} validRange={target ? validRange : undefined} timelineOverride={target && state.phase.type === "reveal" ? targetTimeline : undefined} />;
          })}
        </div>
      </div>

      <section className="action-tray" aria-label="Turn actions" onKeyDown={(event) => { if (event.key === "Escape") dispatch({ type: "CANCEL" }); }}>
        {selectedPosition !== null && <p><strong>{describeTimelineGap(targetTimeline, selectedPosition)}</strong> selected. You can move it before confirming.</p>}
        {interaction.canPlace && <button className="btn btn-primary" disabled={selectedPosition === null || Boolean(pending)} onClick={async () => { if (selectedPosition !== null && await act({ type: "CONFIRM_PLACEMENT", position: selectedPosition }, "placement")) { dispatch({ type: "CANCEL" }); setAnnouncement("Placement confirmed."); } }}>Confirm placement</button>}
        {interaction.canVote && <div className="btn-row">
          {interaction.canAttemptSteal && <button className="btn btn-warning" disabled={selectedPosition === null || Boolean(pending)} onClick={async () => { if (selectedPosition !== null && await act({ type: "STEAL_ATTEMPT", position: selectedPosition }, "vote")) { dispatch({ type: "CANCEL" }); setAnnouncement("Steal submitted."); } }}>Confirm steal · costs 1 token</button>}
          <button className="btn btn-outline" disabled={Boolean(pending)} onClick={() => void act({ type: "PASS" }, "vote")}>Pass</button>
        </div>}
        {interaction.canVote && !interaction.canAttemptSteal && <p>You have no tokens left, but you can still pass.</p>}
        {state.phase.type === "pendingReveal" && interaction.canReveal && <div className="guess-actions">
          <label className="field"><span>Guess the title + artist (optional)</span><input value={guessDraft} onChange={(event) => setGuessDraft(event.target.value)} placeholder="Song title — artist" /></label>
          <button className="btn btn-primary" disabled={Boolean(pending)} onClick={() => { setLockedGuess(guessDraft.trim()); void act({ type: "REVEAL" }, "reveal"); }}>Reveal card</button>
        </div>}
        {state.phase.type === "reveal" && <div className="reveal-actions">
          <p className={state.phase.activePlacementCorrect ? "result-success" : "result-danger"}>{outcome} Correct gap{state.phase.correctPositionRange.low === state.phase.correctPositionRange.high ? "" : "s"}: {state.phase.correctPositionRange.low}{state.phase.correctPositionRange.low !== state.phase.correctPositionRange.high ? `–${state.phase.correctPositionRange.high}` : ""}.</p>
          {interaction.canClaimGuessToken && lockedGuess !== null && <div className="guess-verdict"><p>{lockedGuess ? <>You guessed “{lockedGuess}”. The answer is {describeSong(songsById, state.phase.songId)}. Were you right?</> : <>Did you say {describeSong(songsById, state.phase.songId)} correctly out loud?</>}</p><div className="btn-row"><button className="btn btn-success" disabled={Boolean(pending)} onClick={async () => { if (await act({ type: "CLAIM_GUESS_TOKEN" }, "claim")) setLockedGuess(null); }}>Yes, claim a token</button><button className="btn btn-outline" onClick={() => setLockedGuess(null)}>No bonus token</button></div></div>}
          {state.phase.guessTokenClaimed && <p>{activePlayer?.name} earned a bonus token for the song guess.</p>}
          {interaction.canNextTurn && lockedGuess === null && <button className="btn btn-primary" disabled={Boolean(pending)} onClick={() => void act({ type: "NEXT_TURN" }, "next")}>Next turn</button>}
        </div>}
        {actionError && <p className="blob blob-danger blob-sm" role="alert">{actionError}</p>}
      </section>
      {pointer.preview && <div className={`drag-preview drag-${source}`} style={{ left: pointer.preview.x, top: pointer.preview.y }} aria-hidden="true">{source === "token" ? "♪" : "?"}</div>}
      <div className="visually-hidden" aria-live="polite">{announcement}</div>
      <EventLog entries={state.log} />
    </div>
  );
}
