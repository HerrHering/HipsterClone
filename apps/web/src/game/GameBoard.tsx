import { useEffect, useRef, useState } from "react";
import type {
  GameAction,
  GamePhase,
  GameState,
  TimelineCard,
} from "@hipster-clone/shared";
import {
  currentPlaybackPositionSec,
  currentPlayerId,
  errorMessage,
} from "@hipster-clone/shared";
import { IconCoin, IconCrown, IconUsers } from "../icons";
import { safeLocalStorageGet, safeLocalStorageSet } from "../localStorage";
import { prefetchAudio } from "./api";
import { EventLog } from "./EventLog";
import { SongCard } from "./SongCard";
import { SongTimeline } from "./SongTimeline";
import { describeSong, type SongLookup } from "./songText";
import { POLL_INTERVAL_MS } from "./useGameState";

interface Props {
  playerId: string;
  state: GameState;
  songsById: SongLookup;
  onAction: (action: GameAction) => Promise<void>;
  onLeave: () => void;
}

// SERVER API REQUEST — same as App.tsx's own audioSrc: apps/api downloads
// (if needed) and serves this transparently, the browser can't tell it
// apart from a plain static file.
function audioSrc(songId: string): string {
  return `/api/audio/${songId}`;
}

// One sentence describing what happened at reveal. Pulled out of the JSX
// so it isn't a 3-way nested ternary to read inline — this is exactly the
// same three outcomes as before, just as plain if/return statements.
function describeOutcome(
  phase: Extract<GamePhase, { type: "reveal" }>,
  players: GameState["players"],
  activeName: string | undefined,
): string {
  if (phase.activePlacementCorrect) {
    return `${activeName} placed it correctly!`;
  }
  if (phase.stolenBy) {
    // `!`: stolenBy, when set, always came from a real vote's playerId —
    // game.ts's applyAction only ever records a vote from a playerId it
    // already validated against state.players — so this is always a real
    // player, never a fallback-needing gap.
    return `${activeName} was wrong — ${players[phase.stolenBy]!.name} stole it!`;
  }
  return `${activeName} was wrong, and nobody stole it — the card is lost.`;
}

type StatusTone = "info" | "success" | "warning";
interface StatusLine {
  text: string;
  tone: StatusTone;
}

// The one place that answers "what should *I* (whoever's looking at this
// phone) do right now" — always rendered in the same spot on the board, so
// a player never has to infer their own status from which panel happens to
// be showing. `tone` drives which color-coded .blob-* class it renders as
// (see index.css) — "warning" for "an action is owed from you right now,"
// "success" for the game-over win line, "info" for plain waiting/status text.
function myStatusLine(state: GameState, playerId: string): StatusLine {
  // `!`: this function's only caller (GameBoard, below) never renders
  // during "lobby" — the one phase where turnOrder can be empty and
  // currentPlayerId can return null — and every id in turnOrder is
  // guaranteed to be a real player (turnOrder is built once, from
  // Object.keys(state.players), and nothing ever removes anyone from it
  // afterward). So there's always a real active player with a real name
  // here; the "lobby"/"gameOver" cases below only exist because this
  // switch has to stay exhaustive over the full GamePhase type, not
  // because either can actually run through this line first.
  const activeId = currentPlayerId(state)!;
  const isActive = playerId === activeId;
  const activeName = state.players[activeId]!.name;

  switch (state.phase.type) {
    case "lobby":
      return { text: "Waiting for the game to start.", tone: "info" };
    case "playingSong":
      return isActive
        ? { text: "Your turn — listen, then place the card.", tone: "info" }
        : { text: `Waiting for ${activeName} to place their card.`, tone: "info" };
    case "stealWindow": {
      if (isActive) {
        return { text: "Waiting for everyone else to vote.", tone: "info" };
      }
      const myVote = state.phase.votes.find((vote) => vote.playerId === playerId);
      if (!myVote) {
        return { text: "Your turn to vote — attempt a steal or pass.", tone: "warning" };
      }
      return myVote.position === null
        ? { text: "You voted: passed.", tone: "info" }
        : { text: `You voted: attempted a steal at slot ${myVote.position}.`, tone: "info" };
    }
    case "pendingReveal":
      return isActive
        ? { text: "All votes are in — reveal the card when you're ready.", tone: "warning" }
        : { text: `Waiting for ${activeName} to reveal the card.`, tone: "info" };
    case "reveal":
      return isActive
        ? { text: 'Click "Next turn" when you\'re ready.', tone: "warning" }
        : { text: `Waiting for ${activeName} to click "Next turn."`, tone: "info" };
    case "gameOver":
      // `!`: winnerId always comes from either activeId or stolenBy in
      // game.ts's finishRound/loadNextSong — both always real players.
      return { text: `${state.players[state.phase.winnerId]!.name} won the game!`, tone: "success" };
  }
}

// Owns the "which slot did I pick" state for one round of placing a card.
// Deliberately *not* lifted into GameBoard with a useEffect to reset it
// when a new song loads — GameBoard instead remounts this component (via
// `key={songId}`) each round, which gives it fresh state for free. That's
// the idiomatic React way to say "reset when X changes": remount, don't
// synchronize.
function PlacementPanel({
  timeline,
  songsById,
  onConfirm,
  pending,
}: {
  timeline: TimelineCard[];
  songsById: SongLookup;
  onConfirm: (position: number) => void;
  pending: boolean;
}) {
  const [position, setPosition] = useState<number | null>(null);
  return (
    <div className="card stack-sm">
      <h3>Where does this go in your timeline?</h3>
      <p id="placement-help" className="timeline-instruction">Choose a gap before, between, or after the cards.</p>
      <SongTimeline
        timeline={timeline}
        songsById={songsById}
        selected={position}
        onSelect={setPosition}
        ariaLabel="Choose a placement in your timeline"
        describedBy="placement-help"
      />
      <button
        className="btn btn-primary"
        disabled={position === null || pending}
        aria-busy={pending}
        onClick={() => position !== null && onConfirm(position)}
      >
        {pending ? "Confirming…" : "Confirm placement"}
      </button>
    </div>
  );
}

// Same remount-for-reset trick as PlacementPanel, for a non-active player's
// vote instead of the active player's own placement. Note `timeline` here
// is the *active* player's timeline, not this voter's own — every vote is
// judged against that one shared reference (see protocol.ts's stealWindow
// phase comment for why), so that's what a voter needs to see to guess.
function StealPanel({
  timeline,
  songsById,
  activePlayerName,
  tokens,
  claimedSlots,
  onAttempt,
  onPass,
  pendingAction,
}: {
  timeline: TimelineCard[];
  songsById: SongLookup;
  activePlayerName: string | undefined;
  tokens: number;
  claimedSlots: Map<number, string>;
  onAttempt: (position: number) => void;
  onPass: () => void;
  pendingAction: "STEAL_ATTEMPT" | "PASS" | null;
}) {
  const [position, setPosition] = useState<number | null>(null);
  // A slot picked before this poll tick can become claimed by someone else
  // between then and now — SongTimeline already disables the button for it,
  // but the stale selection could still be sitting in `position`. Checked
  // here too so "Attempt steal" can't submit a slot that's since been
  // claimed out from under it (the server would reject it anyway, this
  // just avoids sending a request already known to fail).
  const positionStillOpen = position !== null && !claimedSlots.has(position);
  return (
    <div className="card stack-sm">
      <h3>Where does this go in {activePlayerName}'s timeline?</h3>
      {tokens < 1 ? (
        <p>No tokens left to attempt a steal — you can still pass.</p>
      ) : (
        <>
          <p id="steal-help" className="timeline-instruction">Choose a gap before, between, or after the cards.</p>
          <SongTimeline
            timeline={timeline}
            songsById={songsById}
            selected={position}
            onSelect={setPosition}
            claimedSlots={claimedSlots}
            ariaLabel={`Choose a steal position in ${activePlayerName}'s timeline`}
            describedBy="steal-help"
          />
        </>
      )}
      <div className="btn-row">
        <button
          className="btn btn-warning"
          disabled={tokens < 1 || !positionStillOpen || pendingAction !== null}
          aria-busy={pendingAction === "STEAL_ATTEMPT"}
          onClick={() => positionStillOpen && position !== null && onAttempt(position)}
        >
          {pendingAction === "STEAL_ATTEMPT" ? "Submitting steal…" : "Attempt steal (1 token, win or lose)"}
        </button>
        <button className="btn btn-outline" onClick={onPass} disabled={pendingAction !== null} aria-busy={pendingAction === "PASS"}>
          {pendingAction === "PASS" ? "Passing…" : "Pass"}
        </button>
      </div>
    </div>
  );
}

// Owns the reveal moment end-to-end: the active player's "Reveal" button
// (plus their optional title/artist guess input) while votes are all in but
// the card hasn't turned over yet, and — once it has — the outcome text and
// the guess self-judgment prompt. `key={songId}` at the call site (see
// GameBoard) is what resets `guessDraft`/`lockedGuess` for a new round —
// same remount-for-reset trick as PlacementPanel/StealPanel above, not a
// useEffect — and precisely because `songId` stays the same across the
// pendingReveal → reveal transition *within* one round, this component
// isn't remounted then, so `lockedGuess` survives from "Reveal was
// clicked" through to the confirmation prompt below.
function RevealPanel({
  phase,
  songsById,
  players,
  activeId,
  activeName,
  isActive,
  onReveal,
  onClaimToken,
  onNextTurn,
  pendingAction,
}: {
  phase: Extract<GamePhase, { type: "pendingReveal" | "reveal" }>;
  songsById: SongLookup;
  players: GameState["players"];
  activeId: string;
  activeName: string;
  isActive: boolean;
  onReveal: () => Promise<void>;
  onClaimToken: () => Promise<void>;
  onNextTurn: () => Promise<void>;
  pendingAction: GameAction["type"] | null;
}) {
  const [guessDraft, setGuessDraft] = useState("");
  const [lockedGuess, setLockedGuess] = useState<string | null>(null);

  if (phase.type === "pendingReveal") {
    // Nothing to show a non-active player here — myStatusLine and the
    // votes list (both rendered by GameBoard, outside this component)
    // already cover "waiting for X to reveal the card."
    if (!isActive) {
      return null;
    }
    return (
      <div className="card stack-sm">
        <h3>All votes are in!</h3>
        <label className="field">
          <span>Guess the title + artist (optional)</span>
          <input
            name="songGuess"
            value={guessDraft}
            onChange={(event) => setGuessDraft(event.target.value)}
            placeholder="Song title — artist"
            autoComplete="off"
            aria-describedby="guess-help"
          />
          <small id="guess-help" className="field-help">Keep it private until the song is revealed.</small>
        </label>
        <button
          className="btn btn-primary"
          disabled={pendingAction !== null}
          aria-busy={pendingAction === "REVEAL"}
          onClick={() => {
            // Locked in *before* the reveal request goes out — this is
            // the player's blind guess, not one made with the answer
            // already on screen. Always a string (never coerced to null)
            // so an empty field still means "revealed, judgment pending" —
            // they may have said the title+artist out loud instead of
            // typing it, and should still get asked.
            setLockedGuess(guessDraft.trim());
            onReveal();
          }}
        >
          {pendingAction === "REVEAL" ? "Revealing…" : "Reveal"}
        </button>
      </div>
    );
  }

  const { low, high } = phase.correctPositionRange;
  const slotText = low === high ? `slot ${low}` : `slots ${low}–${high} (a tie)`;
  const outcomeTone = phase.activePlacementCorrect ? "success" : phase.stolenBy ? "warning" : "danger";

  // Reconstructs the board as it looked *before* the revealed card was
  // inserted — insertCard (game.ts) already mutated the winner's timeline
  // in place by the time this phase exists, so the just-revealed song is
  // filtered back out to make the original gap positions meaningful again.
  // Safe because a song can only ever be a live card in exactly one
  // timeline at a time (pickNextSong's reshuffle excludes any currently-
  // held song from being redrawn).
  const winnerId = phase.stolenBy ?? activeId;
  const winnerTimeline = players[winnerId]!.timeline.filter(
    (card) => card.songId !== phase.songId,
  );
  const revealClaimedSlots = new Map<number, string>();
  const positionTones = new Map<number, "success" | "danger">();
  const toneFor = (position: number): "success" | "danger" =>
    position >= low && position <= high ? "success" : "danger";
  revealClaimedSlots.set(phase.activePlacementPosition, activeName);
  positionTones.set(phase.activePlacementPosition, toneFor(phase.activePlacementPosition));
  for (const vote of phase.votes) {
    if (vote.position !== null) {
      // `!`: every vote's playerId was already validated to exist before
      // game.ts ever pushed it — same invariant as describeOutcome's own
      // stolenBy lookup below.
      revealClaimedSlots.set(vote.position, players[vote.playerId]!.name);
      positionTones.set(vote.position, toneFor(vote.position));
    }
  }

  return (
    <div className="card stack-sm">
      <div className="reveal-hero">
        <SongCard
          songId={phase.songId}
          song={songsById[phase.songId]}
          size="lg"
          tone={phase.activePlacementCorrect ? "correct" : "incorrect"}
        />
        <p className={`blob blob-${outcomeTone}`} role="status" aria-live="polite" aria-atomic="true">
          It belongs at {slotText} in {activeName}'s timeline.{" "}
          {describeOutcome(phase, players, activeName)}
        </p>
      </div>

      <SongTimeline
        timeline={winnerTimeline}
        songsById={songsById}
        claimedSlots={revealClaimedSlots}
        positionTones={positionTones}
        ariaLabel="Revealed placement results"
      />

      {/* The guess itself was never sent to the server — it only ever
          lived in this browser's `lockedGuess` state. Comparing it to the
          real answer, and deciding whether they're "close enough," is
          entirely up to the active player: the server just records their
          yes/no verdict (CLAIM_GUESS_TOKEN), guarded by guessTokenClaimed
          so it can only happen once per round. */}
      {isActive && lockedGuess !== null && !phase.guessTokenClaimed && (
        <div className="stack-sm">
          <p>
            {lockedGuess ? (
              <>
                The song was {describeSong(songsById, phase.songId)}, you
                guessed "{lockedGuess}". Are they the same?
              </>
            ) : (
              <>
                The song was {describeSong(songsById, phase.songId)} — did
                you say the title + artist out loud correctly?
              </>
            )}
          </p>
          <div className="btn-row">
            <button
              className="btn btn-success"
              disabled={pendingAction !== null}
              aria-busy={pendingAction === "CLAIM_GUESS_TOKEN"}
              onClick={async () => {
                await onClaimToken();
                setLockedGuess(null);
              }}
            >
              {pendingAction === "CLAIM_GUESS_TOKEN" ? "Claiming token…" : "Yes, they are the same, I deserve a token!"}
            </button>
            <button className="btn btn-outline" disabled={pendingAction !== null} onClick={() => setLockedGuess(null)}>
              No, the songs are not the same, I don't deserve a token!
            </button>
          </div>
        </div>
      )}

      {phase.guessTokenClaimed && (
        <p className="badge badge-accent">
          {activeName} earned a bonus token for that guess!
        </p>
      )}

      {/* Gated on `lockedGuess === null` rather than on the phase alone —
          both the "Yes" and "No" buttons above reset lockedGuess to null
          the instant one is clicked, so this one condition already covers
          every case: never guessed (shows immediately), guessed and
          answered either way (shows right after). Without this, an active
          player who'd typed a guess could click straight past it and lose
          their one chance to claim the bonus token — the phase moves on
          to the next round the moment NEXT_TURN fires. */}
      {isActive && lockedGuess === null && (
        <button className="btn btn-primary" disabled={pendingAction !== null} aria-busy={pendingAction === "NEXT_TURN"} onClick={onNextTurn}>
          {pendingAction === "NEXT_TURN" ? "Starting next turn…" : "Next turn"}
        </button>
      )}
    </div>
  );
}

// The "open cards" summary this game is meant to have: every player's name,
// card/token counts, and full timeline, always visible to everyone.
//
// `voteStatusByPlayerId` (only meaningful during stealWindow/pendingReveal
// — see GameBoard's own `votes` derivation) folds what used to be a
// separate "Waiting on votes" list into each player's own card instead, as
// a small badge — same information, one less panel on the page.
function PlayerSummary({
  state,
  songsById,
  highlightId,
  viewerId,
  voteStatusByPlayerId,
}: {
  state: GameState;
  songsById: SongLookup;
  highlightId?: string | null;
  // This device's own playerId — drives the small "You" badge, distinct
  // from `highlightId` (whose *turn* it is, which may be a different
  // player entirely).
  viewerId?: string;
  voteStatusByPlayerId?: Record<string, string>;
}) {
  return (
    <div className="card">
      <h3>
        <IconUsers size={18} /> Players
      </h3>
      <div className="player-grid">
        {Object.values(state.players).map((player) => {
          const voteStatus = voteStatusByPlayerId?.[player.id];
          const cardClasses = ["player-card"];
          if (player.id === highlightId) {
            cardClasses.push("is-active");
          }
          if (player.id === viewerId) {
            cardClasses.push("is-me");
          }
          return (
            <div key={player.id} className={cardClasses.join(" ")}>
              <div className="player-card-name">
                <strong>{player.name}</strong>
                {player.id === state.hostId && (
                  <span className="badge" title="Room host">
                    <IconCrown size={12} /> Host
                  </span>
                )}
                {player.id === viewerId && <span className="badge badge-muted">You</span>}
                {player.id === highlightId && (
                  <span className="badge badge-accent">On turn</span>
                )}
                {voteStatus && <span className="badge badge-muted">{voteStatus}</span>}
              </div>
              <div className="player-card-counts">
                <span className="badge">
                  {player.timeline.length} card{player.timeline.length === 1 ? "" : "s"}
                </span>
                <span className="badge badge-token">
                  <IconCoin size={12} /> {player.tokens} token{player.tokens === 1 ? "" : "s"}
                </span>
              </div>
              <div className="player-card-timeline">
                {player.timeline.map((card) => (
                  <SongCard
                    key={card.songId}
                    songId={card.songId}
                    song={songsById[card.songId]}
                    size="sm"
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GameBoard({ playerId, state, songsById, onAction, onLeave }: Props) {
  // Two *non-active-player* elements: `audioRef` is the real, invisible
  // "dumb follower" that produces their actual sound (unchanged from
  // before); `visualAudioRef` is a second, muted, click-through copy that
  // exists purely so they can *see* the same native play/pause/scrub-bar
  // display the active player gets, without being able to touch it. The
  // active player gets neither ref — they get one real, native, directly
  // interactive element instead (see the `isActive` branch below), which
  // doesn't need programmatic corrections at all.
  const audioRef = useRef<HTMLAudioElement>(null);
  const visualAudioRef = useRef<HTMLAudioElement>(null);

  // Per-device preference only — this never touches GameState or the
  // server. Only one phone is actually near a speaker; everyone else can
  // mute themselves without affecting anyone else's playback or sync.
  const [muted, setMuted] = useState<boolean>(
    () => safeLocalStorageGet("hipster-muted") === "1",
  );
  useEffect(() => {
    safeLocalStorageSet("hipster-muted", muted ? "1" : "0");
  }, [muted]);

  // What this phone's own <audio> element is actually doing right now —
  // every player has their own copy of this, since every phone fetches the
  // audio independently (see audioSrc). The interesting case this exists
  // for: the *first* phone to ask for a given song can trigger a real
  // yt-dlp download server-side (see apps/api/src/cache.ts's ensureCached)
  // that takes far longer than a normal "buffering" pause — without this,
  // that would just look like nothing happening at all.
  //
  // Driven entirely by the <audio> element's own events below (onLoadStart
  // etc.) — not by GameState, since this is purely about *this device's*
  // local network/fetch progress, something the server has no visibility
  // into at all.
  const [audioStatus, setAudioStatus] = useState<
    "loading" | "buffering" | "playing" | "paused"
  >("loading");

  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<GameAction["type"] | null>(null);
  const pendingActionRef = useRef<GameAction["type"] | null>(null);

  // Wraps every button's action: clears any previous error, sends it, and
  // surfaces a new one if the server rejects it (e.g. a stale poll made a
  // button clickable for a moment after it stopped being valid).
  async function act(action: GameAction, trackPending = true): Promise<void> {
    if (trackPending && pendingActionRef.current !== null) return;
    setActionError(null);
    if (trackPending) {
      pendingActionRef.current = action.type;
      setPendingAction(action.type);
    }
    try {
      await onAction(action);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      if (trackPending) {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    }
  }

  // True for the duration of any PLAY/PAUSE/SEEK request the active
  // player's own real <audio controls> element (below) sends — shown as
  // "Syncing with server…" so a click doesn't look like it did nothing
  // while the request is in flight. Only reflects *this device's* own
  // round trip; whether every other player's poll has caught up too isn't
  // something this client can see.
  const [syncing, setSyncing] = useState(false);
  async function mirror(action: GameAction) {
    setSyncing(true);
    try {
      await act(action, false);
    } finally {
      setSyncing(false);
    }
  }

  // True from the moment the active player seeks until one full poll
  // interval later — long enough that every other player's own poll is
  // guaranteed to have picked up the frozen position (see game.ts's SEEK
  // handling) before anyone's clock starts moving again. While true, the
  // active player's own element is locked (unclickable, see the
  // `isActive` branch below) — an *enforced* pause, not just a value
  // that would get silently corrected back if they tried to jump the gun.
  const [locked, setLocked] = useState(false);
  const resumeTimerRef = useRef<number | null>(null);
  // Set right before the one-time catch-up seek below (onLoadedMetadata)
  // sets .currentTime — that alone fires a native 'seeked' event same as
  // a real drag would, which would otherwise wrongly trigger the full
  // seek-lock/auto-resume flow just from loading the page. Consumed
  // (reset to false) the moment that one seeked event is skipped.
  const suppressNextSeekRef = useRef(false);

  // A new song always cancels any pending auto-resume left over from the
  // previous one (and starts unlocked) — otherwise a stale timer from a
  // seek on the *previous* song could fire a PLAY for the wrong round.
  // Reset during render (comparing against last render's songId) rather
  // than in an effect body — same "adjust state when a value changes"
  // pattern used elsewhere in this file, avoiding an extra render pass.
  const currentSongId = state.playback?.songId ?? null;
  const [lockedForSongId, setLockedForSongId] = useState(currentSongId);
  if (currentSongId !== lockedForSongId) {
    setLockedForSongId(currentSongId);
    setLocked(false);
  }
  // The resume timer itself is a real external resource (a browser
  // timer), so disposing of it — on a song change or on unmount — is
  // exactly what an effect is for.
  useEffect(() => {
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [currentSongId]);

  // Runs on every poll tick (state is a brand-new object each time
  // useGameState.ts's interval fires, whether or not anything actually
  // changed) — nudges this phone's own follower <audio> elements to match
  // the server's authoritative PlaybackState. This is the "dumb
  // follower": it never decides to play/pause/seek on its own, only
  // reacts. Loops over both non-active-player elements (the real, audible
  // one and the visible-but-click-through display copy) identically —
  // the active player's own element is never in this list at all (see
  // the `isActive` branch below), since nothing but their own actions
  // could ever change playback during their turn in the first place.
  useEffect(() => {
    const playback = state.playback;
    if (!playback) {
      return;
    }
    for (const ref of [audioRef, visualAudioRef]) {
      const audio = ref.current;
      if (!audio) {
        continue;
      }
      const target = currentPlaybackPositionSec(playback);
      // Only correct real drift, not the small gap that naturally builds
      // up between poll ticks — otherwise this fights the browser's own,
      // perfectly fine playback clock every 1.5 seconds for no reason.
      if (Math.abs(audio.currentTime - target) > 1) {
        audio.currentTime = target;
      }
      if (playback.isPlaying && audio.paused) {
        // Usually just a browser autoplay policy (fixed by clicking
        // anywhere on the page first, nothing actually broken) rather
        // than a real failure — logged to the console rather than shown
        // on screen so a routine "hasn't interacted with the page yet"
        // moment doesn't read as an alarming error banner.
        void audio.play().catch((error: unknown) => {
          console.error("audio.play() failed:", error);
        });
      } else if (!playback.isPlaying && !audio.paused) {
        audio.pause();
      }
    }
  }, [state]);

  // Prefetches the *next* song's audio while the current one is still being
  // played out, so the download (yt-dlp can take a few seconds on a cache
  // miss) has already happened by the time NEXT_TURN loads it — same
  // fire-and-forget style as audio.play() above. A ref (not state) tracks
  // the last id already prefetched so this fires once per song, not once
  // per poll tick. Every player's phone independently fires this, not just
  // the active player's — harmless, since ensureCached's in-flight dedupe
  // collapses redundant calls into one real download.
  const prefetchedSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextSongId = state.nextSongId;
    if (!nextSongId || prefetchedSongIdRef.current === nextSongId) {
      return;
    }
    prefetchedSongIdRef.current = nextSongId;
    void prefetchAudio(nextSongId).catch((error: unknown) => {
      console.error("prefetchAudio() failed:", error);
    });
  }, [state.nextSongId]);

  if (state.phase.type === "gameOver") {
    // `!`: same invariant as myStatusLine's own gameOver case below —
    // winnerId always comes from either activeId or stolenBy, both always
    // real players (see game.ts's finishRound/loadNextSong).
    return (
      <div className="stack">
        <h1 className="screen-heading">Game over!</h1>
        <p className="blob blob-success" role="status" aria-live="polite">
          <IconCrown /> {state.players[state.phase.winnerId]!.name} wins!
        </p>
        <div className="card game-over-actions stack-sm">
          <p>Thanks for playing. Leave the room to return home.</p>
          <button className="btn btn-primary" onClick={onLeave}>Back to home</button>
        </div>
        <PlayerSummary state={state} songsById={songsById} viewerId={playerId} />
        <EventLog entries={state.log} />
      </div>
    );
  }

  // `!`: this line only runs once the "gameOver" case above has already
  // returned — every remaining phase requires the game to have started,
  // which is exactly when turnOrder stops being empty and currentPlayerId
  // stops being able to return null (same invariant as myStatusLine's own
  // `!` above).
  const activeId = currentPlayerId(state)!;
  const isActive = playerId === activeId;
  const activePlayer = state.players[activeId]!;
  const activeName = activePlayer.name;
  // Unlike activePlayer, `me` genuinely can be undefined: it's looked up
  // by *this device's own* locally-stored playerId (App.tsx's seat), which
  // can point at a room that no longer recognizes it — e.g. the server
  // restarted (rooms are in-memory only, see game.ts) and a brand-new room
  // coincidentally reused the same 4-letter code. The `me?.name ?? playerId`
  // fallback below is a real one, not a dead one.
  const me = state.players[playerId];
  // Hoisted once here (instead of re-checking `state.phase.type` a second
  // time inside the vote-list's `.map()` below) — a plain `if` narrows
  // `state.phase` for the rest of *this* function body, but that narrowing
  // doesn't carry into a nested arrow function, so re-deriving it as its
  // own variable up front avoids needing to repeat the check in a closure.
  const votes =
    state.phase.type === "stealWindow" || state.phase.type === "pendingReveal"
      ? state.phase.votes
      : null;
  // Whether *this* player has already cast their vote this round — passed
  // or attempted a steal, either counts. Drives whether their voting
  // controls render at all below; the server enforces the same rule
  // independently (a second vote from the same player is rejected — see
  // game.ts), this is just the client reflecting that so there's nothing
  // left to click a second time.
  const myVote = votes?.find((vote) => vote.playerId === playerId);
  // Every slot nobody may pick anymore this round: the active player's own
  // placement, plus every vote already recorded with a real position
  // (a pass doesn't claim a slot). Labeled with who claimed it, so
  // StealPanel can gray each one out and say who's there. Always a real
  // (possibly empty) Map, not `| null` — simpler for StealPanel's prop
  // type, and it's only ever rendered during stealWindow anyway.
  const claimedSlots = new Map<number, string>();
  if (state.phase.type === "stealWindow" || state.phase.type === "pendingReveal") {
    claimedSlots.set(state.phase.activePlacementPosition, activeName);
    for (const vote of state.phase.votes) {
      if (vote.position !== null) {
        // `!`: every vote's playerId was already validated to exist
        // before game.ts ever pushed it — same invariant as
        // describeOutcome's own stolenBy lookup above.
        claimedSlots.set(vote.position, state.players[vote.playerId]!.name);
      }
    }
  }
  // Folded into each player's own scoreboard card (see PlayerSummary)
  // instead of a separate "Waiting on votes" panel — same data as before,
  // just relocated. Only meaningful during stealWindow/pendingReveal;
  // `undefined` the rest of the time so PlayerSummary shows no badge.
  const voteStatusByPlayerId: Record<string, string> | undefined = votes
    ? Object.fromEntries(
        Object.values(state.players)
          .filter((player) => player.id !== activeId)
          .map((player) => {
            const vote = votes.find((v) => v.playerId === player.id);
            const status =
              vote === undefined
                ? "Still deciding"
                : vote.position === null
                  ? "Passed"
                  : `Stole @${vote.position}`;
            return [player.id, status];
          }),
      )
    : undefined;
  const status = myStatusLine(state, playerId);
  return (
    <div className="stack">
      <h1 className="visually-hidden">Game in progress</h1>
      <p className={`blob blob-${status.tone}`} role="status" aria-live="polite" aria-atomic="true">{status.text}</p>

      <div className="game-layout">
        <div className="main-column">
          {(state.phase.type === "pendingReveal" || state.phase.type === "reveal") && (
            // key={songId}: a fresh RevealPanel (and thus a fresh, empty
            // guess) each round — see the component's own comment. Not
            // remounted by the pendingReveal → reveal transition itself,
            // since songId stays the same across those two phases within
            // one round.
            <RevealPanel
              key={state.phase.songId}
              phase={state.phase}
              songsById={songsById}
              players={state.players}
              activeId={activeId}
              activeName={activeName}
              isActive={isActive}
              onReveal={() => act({ type: "REVEAL" })}
              onClaimToken={() => act({ type: "CLAIM_GUESS_TOKEN" })}
              onNextTurn={() => act({ type: "NEXT_TURN" })}
              pendingAction={pendingAction}
            />
          )}

          {state.playback && (
            <div className="card playback-card stack-sm">
              <h2>Now playing</h2>
              {isActive ? (
            // The active player gets one real, native, directly
            // interactive element — no separate invisible twin, no
            // separate "Mute for me" button. Nothing but their own
            // actions can ever change playback during their turn (the
            // server rejects anyone else's PLAY/PAUSE/SEEK), so there's
            // no other "truth" for this device to follow — the one
            // exception is the short window right after *this player's
            // own* seek, until everyone else has had a chance to catch
            // up, handled explicitly below via `locked`.
            <>
              <audio
                controls
                src={audioSrc(state.playback.songId)}
                preload="auto"
                // Enforces the pause below: with no pointer events and no
                // keyboard focus, there is no native control left to
                // click to jump the gun — not just a value that would get
                // silently corrected back if they tried.
                style={locked ? { pointerEvents: "none" } : undefined}
                tabIndex={locked ? -1 : undefined}
                // One-time catch-up, not a recurring correction: a fresh
                // <audio> element (this branch only exists at all while
                // `isActive`, so it's freshly created every time this
                // player's turn starts, most notably right after a page
                // refresh mid-turn) otherwise has no idea the server's
                // playback might already be mid-song and/or playing — it
                // would just sit at 0:00, paused, regardless. Fires again
                // at the *start* of every later turn too, but harmlessly:
                // a fresh turn's server state is already positionSec 0 /
                // paused (see game.ts's loadNextSong), exactly matching a
                // freshly-loaded element's own default — nothing to catch
                // up to. `suppressNextSeekRef` stops the .currentTime
                // write below from being mistaken for a real user seek.
                onLoadedMetadata={(event) => {
                  const playback = state.playback;
                  if (!playback) {
                    return;
                  }
                  const audio = event.currentTarget;
                  suppressNextSeekRef.current = true;
                  audio.currentTime = currentPlaybackPositionSec(playback);
                  if (playback.isPlaying) {
                    void audio.play().catch((error: unknown) => {
                      console.error("audio.play() failed:", error);
                    });
                  }
                }}
                // Same loading/buffering feedback the non-active follower
                // element below already has — the active player can
                // trigger the same server-side yt-dlp download as anyone
                // else (see cache.ts's ensureCached) and deserves the same
                // "something's happening" indicator, not just silence.
                onLoadStart={() => setAudioStatus("loading")}
                onWaiting={() => setAudioStatus("buffering")}
                // The one that was missing: onWaiting above moves this into
                // "buffering," but nothing ever moved it back out once real
                // playback actually resumed, so it stuck on "Buffering…"
                // forever even after the song was audibly playing.
                onPlaying={() => setAudioStatus("playing")}
                onCanPlay={() =>
                  setAudioStatus((current) =>
                    current === "loading" ? "paused" : current,
                  )
                }
                onPlay={() => mirror({ type: "PLAY" })}
                onPause={() => {
                  mirror({ type: "PAUSE" });
                  setAudioStatus("paused");
                }}
                onSeeked={async (event) => {
                  // The one-time catch-up above also fires a native
                  // 'seeked' event (setting .currentTime always does,
                  // even programmatically) — without this check, loading
                  // the page would wrongly trigger the full lock/mirror/
                  // auto-resume flow below, as if the player had dragged
                  // the scrub bar themselves.
                  if (suppressNextSeekRef.current) {
                    suppressNextSeekRef.current = false;
                    return;
                  }
                  // A seek always freezes here too, matching game.ts's own
                  // SEEK handling: pause immediately, mirror the seek, then
                  // hold the pause for one full poll interval — long
                  // enough that every other player's own poll is
                  // guaranteed to have picked up the frozen position —
                  // before resuming (only if it had actually been
                  // playing) so everyone's clock starts moving together
                  // from the exact same instant.
                  const audio = event.currentTarget;
                  const wasPlaying = !audio.paused;
                  audio.pause();
                  setLocked(true);
                  await mirror({ type: "SEEK", positionSec: audio.currentTime });
                  resumeTimerRef.current = window.setTimeout(() => {
                    setLocked(false);
                    if (wasPlaying) {
                      void audio.play().catch((error: unknown) => {
                        console.error("audio.play() failed:", error);
                      });
                    }
                  }, POLL_INTERVAL_MS);
                }}
              />
              {locked ? (
                <span className="playback-status" role="status" aria-live="polite" aria-atomic="true">Paused — waiting for everyone to catch up…</span>
              ) : syncing ? (
                <span className="playback-status" role="status" aria-live="polite" aria-atomic="true">Syncing with server…</span>
              ) : (
                // Only the loading/buffering states get a label here — the
                // native controls above already show play/pause visually,
                // so a "Playing"/"Paused" label would just be redundant for
                // the one player who can see and touch them directly.
                (audioStatus === "loading" || audioStatus === "buffering") && (
                  <span className="playback-status" role="status" aria-live="polite" aria-atomic="true">{audioStatus === "loading" ? "Loading song…" : "Buffering…"}</span>
                )
              )}
            </>
          ) : (
            // Everyone else: the real, invisible, "dumb follower" element
            // (unchanged — actual sound, per-device "Mute for me", the
            // Loading/Buffering/Playing/Paused text), plus a second,
            // purely decorative native widget so the same timestamp/
            // paused-or-playing state is visible, not just described in
            // text. Always `muted` (hardcoded, never toggleable — it can
            // never itself make sound) and click/keyboard-through, so
            // there's no way to interact with it at all.
            <>
              <audio
                ref={audioRef}
                src={audioSrc(state.playback.songId)}
                muted={muted}
                // "auto": ask the browser to start fetching immediately
                // once a src is set, rather than waiting for an explicit
                // play() (the default "metadata" preload would otherwise
                // delay the very request that kicks off a slow yt-dlp
                // download server-side, which is exactly the case worth
                // surfacing early).
                preload="auto"
                // These fire on this phone's own <audio> element
                // regardless of GameState — they're the only source of
                // truth for "what is *my* fetch/playback actually doing
                // right now." A source change (new song) naturally fires
                // onLoadStart again on its own, so audioStatus resets
                // itself without any extra effect.
                onLoadStart={() => setAudioStatus("loading")}
                onWaiting={() => setAudioStatus("buffering")}
                onPlaying={() => setAudioStatus("playing")}
                onPause={() => setAudioStatus("paused")}
                onCanPlay={() =>
                  // Only meaningful coming from "loading": data's ready,
                  // but nothing's asked to play yet, so it's sitting
                  // paused — not "loading" anymore. Leave
                  // "buffering"/"playing" alone here; their own events
                  // (onPlaying) already cover resuming.
                  setAudioStatus((current) =>
                    current === "loading" ? "paused" : current,
                  )
                }
              />
              <audio
                ref={visualAudioRef}
                controls
                muted
                src={audioSrc(state.playback.songId)}
                preload="auto"
                style={{ pointerEvents: "none" }}
                tabIndex={-1}
                aria-hidden="true"
              />
              <span
                className="playback-status"
                role={audioStatus === "loading" || audioStatus === "buffering" ? "status" : undefined}
                aria-live={audioStatus === "loading" || audioStatus === "buffering" ? "polite" : undefined}
                aria-atomic={audioStatus === "loading" || audioStatus === "buffering" ? "true" : undefined}
              >
                {audioStatus === "loading" && "Loading song…"}
                {audioStatus === "buffering" && "Buffering…"}
                {audioStatus === "playing" && "Playing"}
                {audioStatus === "paused" && "Paused"}
              </span>
              <button className="btn btn-outline" onClick={() => setMuted((prev) => !prev)}>
                {muted ? "Unmute for me" : "Mute for me"}
              </button>
            </>
          )}
            </div>
          )}

          {state.phase.type === "playingSong" && isActive && me && (
            // key={songId}: a fresh PlacementPanel (and thus a fresh, empty
            // selection) each round — see the component's own comment.
            <PlacementPanel
              key={state.phase.songId}
              timeline={me.timeline}
              songsById={songsById}
              onConfirm={(position) => act({ type: "CONFIRM_PLACEMENT", position })}
              pending={pendingAction === "CONFIRM_PLACEMENT"}
            />
          )}

          {/* The active player's own timeline (not `me.timeline`) is what
              every voter's guess is judged against — see StealPanel's
              comment. Rendered only until *this* player has voted; once
              `myVote` exists, there is nothing left for them to click
              (their scoreboard badge already shows their status instead). */}
          {state.phase.type === "stealWindow" &&
            !isActive &&
            me &&
            activePlayer &&
            myVote === undefined && (
              <StealPanel
                key={state.phase.songId}
                timeline={activePlayer.timeline}
                songsById={songsById}
                activePlayerName={activeName}
                tokens={me.tokens}
                claimedSlots={claimedSlots}
                onAttempt={(position) => act({ type: "STEAL_ATTEMPT", position })}
                onPass={() => act({ type: "PASS" })}
                pendingAction={pendingAction === "STEAL_ATTEMPT" || pendingAction === "PASS" ? pendingAction : null}
              />
            )}

          {/* Non-active players get a read-only view of the active
              player's timeline as soon as a song is loaded — visible, but
              nothing to click, since PlacementPanel (their own interactive
              copy) only ever renders for the active player. While voting's
              still open, the active player has no vote of their own but
              shouldn't lose sight of the board either — that's the
              "stealWindow && isActive" half. Once voting closes
              ("pendingReveal"), every slot is now final, so the board
              becomes read-only for *everyone*. Same SongTimeline, same
              live claimedSlots throughout, just with no `onSelect` at
              all: every gap renders disabled, so this is purely something
              to watch, not touch. */}
          {((state.phase.type === "playingSong" && !isActive) ||
            (state.phase.type === "stealWindow" && isActive) ||
            state.phase.type === "pendingReveal") &&
            activePlayer && (
              <div className="card">
                <h3>
                  {state.phase.type === "playingSong"
                    ? `${activeName}'s timeline`
                    : state.phase.type === "pendingReveal"
                      ? "Final placements"
                      : "Watching the steal window"}
                </h3>
                <SongTimeline
                  timeline={activePlayer.timeline}
                  songsById={songsById}
                  claimedSlots={claimedSlots}
                />
              </div>
            )}

          {actionError && <p className="blob blob-danger blob-sm" role="alert">{actionError}</p>}
        </div>

        <div className="side-column">
          <PlayerSummary
            state={state}
            songsById={songsById}
            highlightId={activeId}
            viewerId={playerId}
            voteStatusByPlayerId={voteStatusByPlayerId}
          />
          <EventLog entries={state.log} />
        </div>
      </div>
    </div>
  );
}
