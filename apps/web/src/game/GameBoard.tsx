import { useEffect, useRef, useState } from "react";
import type {
  GameAction,
  GamePhase,
  GameState,
  SongManifestEntry,
  TimelineCard,
} from "@hipster-clone/shared";
import {
  currentPlaybackPositionSec,
  currentPlayerId,
  errorMessage,
} from "@hipster-clone/shared";
import { safeLocalStorageGet, safeLocalStorageSet } from "../localStorage";

type SongLookup = Record<string, SongManifestEntry>;

interface Props {
  roomCode: string;
  playerId: string;
  state: GameState;
  songsById: SongLookup;
  onAction: (action: GameAction) => Promise<void>;
}

// SERVER API REQUEST — same as App.tsx's own audioSrc: apps/api downloads
// (if needed) and serves this transparently, the browser can't tell it
// apart from a plain static file.
function audioSrc(songId: string): string {
  return `/api/audio/${songId}`;
}

// GameState only ever stores a songId + year (see TimelineCard in
// protocol.ts) — this is the one place that turns an id back into
// something readable, using the manifest App.tsx already loaded.
function describeSong(songsById: SongLookup, songId: string): string {
  const song = songsById[songId];
  return song ? `${song.title} — ${song.artist} (${song.year})` : songId;
}

// The label for "insertion slot" number `position` in `timeline` (there are
// timeline.length + 1 of these: before the first card, between each pair,
// and after the last).
function describeSlot(
  songsById: SongLookup,
  timeline: TimelineCard[],
  position: number,
): string {
  const before = timeline[position - 1];
  const after = timeline[position];
  if (!before && !after) {
    return "this will start your timeline";
  }
  if (!before) {
    // `after` must exist here: the only way both `before` and `after` can
    // be missing is the empty-timeline case just handled above.
    return `before ${describeSong(songsById, after!.songId)}`;
  }
  if (!after) {
    return `after ${describeSong(songsById, before.songId)}`;
  }
  return `between ${describeSong(songsById, before.songId)} and ${describeSong(songsById, after.songId)}`;
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

// The one place that answers "what should *I* (whoever's looking at this
// phone) do right now" — always rendered in the same spot on the board, so
// a player never has to infer their own status from which panel happens to
// be showing.
function myStatusLine(state: GameState, playerId: string): string {
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
      return "Waiting for the game to start.";
    case "playingSong":
      return isActive
        ? "Your turn — listen, then place the card."
        : `Waiting for ${activeName} to place their card.`;
    case "stealWindow": {
      if (isActive) {
        return "Waiting for everyone else to vote.";
      }
      const myVote = state.phase.votes.find((vote) => vote.playerId === playerId);
      if (!myVote) {
        return "Your turn to vote — attempt a steal or pass.";
      }
      return myVote.position === null
        ? "You voted: passed."
        : `You voted: attempted a steal at slot ${myVote.position}.`;
    }
    case "reveal":
      return isActive
        ? 'Click "Next turn" when you\'re ready.'
        : `Waiting for ${activeName} to click "Next turn."`;
    case "gameOver":
      // `!`: winnerId always comes from either activeId or stolenBy in
      // game.ts's finishRound/loadNextSong — both always real players.
      return `${state.players[state.phase.winnerId]!.name} won the game!`;
  }
}

// One button per gap in `timeline`. Shared by "confirm your own placement,"
// "attempt a steal," and now also a read-only "just watching" view — all
// three are really the same board, just with different people allowed to
// touch it.
//
// `claimedSlots` (never passed for the active player's own placement — see
// PlacementPanel below, nothing's claimed yet at that point) maps a
// position to who already claimed it. A claimed slot can't be picked by
// anyone: it renders disabled, grayed out, and labeled with the claimant —
// still visible (this stays an open-card game), just not clickable.
//
// `onSelect` is optional: omit it entirely (as GameBoard does for the
// active player's own read-only view during the steal window) and every
// slot renders disabled regardless of whether it's claimed — a plain
// "look, don't touch" board, no separate readOnly flag needed.
function SlotPicker({
  timeline,
  songsById,
  selected = null,
  onSelect,
  claimedSlots,
}: {
  timeline: TimelineCard[];
  songsById: SongLookup;
  selected?: number | null;
  onSelect?: (position: number) => void;
  claimedSlots?: Map<number, string>;
}) {
  const slotCount = timeline.length + 1;
  return (
    <div className="slot-picker">
      {/* Array.from with no real source array, just a length — the usual
          way to build "N things" in React when there's nothing to map over yet. */}
      {Array.from({ length: slotCount }, (_, position) => {
        const claimedBy = claimedSlots?.get(position);
        const className = claimedBy
          ? "slot slot-claimed"
          : position === selected
            ? "slot slot-selected"
            : "slot";
        return (
          <button
            key={position}
            className={className}
            disabled={!onSelect || claimedBy !== undefined}
            onClick={() => onSelect?.(position)}
          >
            {describeSlot(songsById, timeline, position)}
            {claimedBy && ` — claimed by ${claimedBy}`}
          </button>
        );
      })}
    </div>
  );
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
}: {
  timeline: TimelineCard[];
  songsById: SongLookup;
  onConfirm: (position: number) => void;
}) {
  const [position, setPosition] = useState<number | null>(null);
  return (
    <div>
      <h3>Where does this go in your timeline?</h3>
      <SlotPicker
        timeline={timeline}
        songsById={songsById}
        selected={position}
        onSelect={setPosition}
      />
      <button
        disabled={position === null}
        onClick={() => position !== null && onConfirm(position)}
      >
        Confirm placement
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
}: {
  timeline: TimelineCard[];
  songsById: SongLookup;
  activePlayerName: string | undefined;
  tokens: number;
  claimedSlots: Map<number, string>;
  onAttempt: (position: number) => void;
  onPass: () => void;
}) {
  const [position, setPosition] = useState<number | null>(null);
  // A slot picked before this poll tick can become claimed by someone else
  // between then and now — SlotPicker already disables the button for it,
  // but the stale selection could still be sitting in `position`. Checked
  // here too so "Attempt steal" can't submit a slot that's since been
  // claimed out from under it (the server would reject it anyway, this
  // just avoids sending a request already known to fail).
  const positionStillOpen = position !== null && !claimedSlots.has(position);
  return (
    <div>
      <h3>Where does this go in {activePlayerName}'s timeline?</h3>
      {tokens < 1 ? (
        <p>No tokens left to attempt a steal — you can still pass.</p>
      ) : (
        <SlotPicker
          timeline={timeline}
          songsById={songsById}
          selected={position}
          onSelect={setPosition}
          claimedSlots={claimedSlots}
        />
      )}
      <button
        disabled={tokens < 1 || !positionStillOpen}
        onClick={() => positionStillOpen && position !== null && onAttempt(position)}
      >
        Attempt steal (1 token, win or lose)
      </button>
      <button onClick={onPass}>Pass</button>
    </div>
  );
}

// The "open cards" summary this game is meant to have: every player's name,
// card/token counts, and full timeline, always visible to everyone.
function PlayerSummary({
  state,
  songsById,
  highlightId,
}: {
  state: GameState;
  songsById: SongLookup;
  highlightId?: string | null;
}) {
  return (
    <div>
      <h3>Players</h3>
      <ul>
        {Object.values(state.players).map((player) => (
          <li key={player.id}>
            <strong>{player.name}</strong>
            {player.id === highlightId && " (on turn)"} —{" "}
            {player.timeline.length} card{player.timeline.length === 1 ? "" : "s"},{" "}
            {player.tokens} token{player.tokens === 1 ? "" : "s"}
            <ul>
              {player.timeline.map((card) => (
                <li key={card.songId}>{describeSong(songsById, card.songId)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GameBoard({ roomCode, playerId, state, songsById, onAction }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);

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

  // Wraps every button's action: clears any previous error, sends it, and
  // surfaces a new one if the server rejects it (e.g. a stale poll made a
  // button clickable for a moment after it stopped being valid).
  async function act(action: GameAction) {
    setActionError(null);
    try {
      await onAction(action);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  // Runs on every poll tick (state is a brand-new object each time
  // useGameState.ts's interval fires, whether or not anything actually
  // changed) — nudges this phone's own <audio> element to match the
  // server's authoritative PlaybackState. This is the "dumb follower":
  // it never decides to play/pause/seek on its own, only reacts.
  useEffect(() => {
    const audio = audioRef.current;
    const playback = state.playback;
    if (!audio || !playback) {
      return;
    }
    const target = currentPlaybackPositionSec(playback);
    // Only correct real drift, not the small gap that naturally builds up
    // between poll ticks — otherwise this fights the browser's own,
    // perfectly fine playback clock every 1.5 seconds for no reason.
    if (Math.abs(audio.currentTime - target) > 1) {
      audio.currentTime = target;
    }
    if (playback.isPlaying && audio.paused) {
      // Usually just a browser autoplay policy (fixed by clicking anywhere
      // on the page first, nothing actually broken) rather than a real
      // failure — logged to the console rather than shown on screen so a
      // routine "hasn't interacted with the page yet" moment doesn't read
      // as an alarming error banner.
      void audio.play().catch((error: unknown) => {
        console.error("audio.play() failed:", error);
      });
    } else if (!playback.isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [state]);

  if (state.phase.type === "gameOver") {
    // `!`: same invariant as myStatusLine's own gameOver case below —
    // winnerId always comes from either activeId or stolenBy, both always
    // real players (see game.ts's finishRound/loadNextSong).
    return (
      <div>
        <h2>Game over!</h2>
        <p>{state.players[state.phase.winnerId]!.name} wins!</p>
        <PlayerSummary state={state} songsById={songsById} />
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
  const votes = state.phase.type === "stealWindow" ? state.phase.votes : null;
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
  if (state.phase.type === "stealWindow") {
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
  // A plain number, not a nullable PlaybackState — computed once so the
  // SEEK buttons below can just do arithmetic on it instead of each
  // re-deriving it from `state.playback` (which would need a `!` in every
  // closure, since narrowing `state.playback` above doesn't reach inside them).
  const currentPositionSec = state.playback
    ? currentPlaybackPositionSec(state.playback)
    : 0;

  return (
    <div>
      <h2>Room {roomCode}</h2>
      <p>You are <strong>{me?.name ?? playerId}</strong>.</p>
      <p>
        <strong>{myStatusLine(state, playerId)}</strong>
      </p>

      {state.phase.type === "reveal" && (
        <p>
          The song was from {state.phase.correctYear} (slot{" "}
          {state.phase.correctPosition} in {activeName}'s timeline).{" "}
          {describeOutcome(state.phase, state.players, activeName)}
        </p>
      )}

      {state.playback && (
        <div>
          <audio
            ref={audioRef}
            src={audioSrc(state.playback.songId)}
            muted={muted}
            // "auto": ask the browser to start fetching immediately once a
            // src is set, rather than waiting for an explicit play() (the
            // default "metadata" preload would otherwise delay the very
            // request that kicks off a slow yt-dlp download server-side,
            // which is exactly the case worth surfacing early).
            preload="auto"
            // These fire on this phone's own <audio> element regardless of
            // GameState — they're the only source of truth for "what is
            // *my* fetch/playback actually doing right now." A source
            // change (new song) naturally fires onLoadStart again on its
            // own, so audioStatus resets itself without any extra effect.
            onLoadStart={() => setAudioStatus("loading")}
            onWaiting={() => setAudioStatus("buffering")}
            onPlaying={() => setAudioStatus("playing")}
            onPause={() => setAudioStatus("paused")}
            onCanPlay={() =>
              // Only meaningful coming from "loading": data's ready, but
              // nothing's asked to play yet, so it's sitting paused — not
              // "loading" anymore. Leave "buffering"/"playing" alone here;
              // their own events (onPlaying) already cover resuming.
              setAudioStatus((current) => (current === "loading" ? "paused" : current))
            }
          />
          <span>
            {audioStatus === "loading" && "Loading song…"}
            {audioStatus === "buffering" && "Buffering…"}
            {audioStatus === "playing" && "Playing"}
            {audioStatus === "paused" && "Paused"}
          </span>
          <button onClick={() => setMuted((prev) => !prev)}>
            {muted ? "Unmute for me" : "Mute for me"}
          </button>
          {/* Only the active player gets transport controls at all — the
              server enforces this too (see game.ts's PLAY/PAUSE/SEEK
              handling), this is just so nobody else even sees a button
              that would be rejected anyway. */}
          {isActive && (
            <>
              <button
                onClick={() =>
                  act(state.playback?.isPlaying ? { type: "PAUSE" } : { type: "PLAY" })
                }
              >
                {state.playback.isPlaying ? "Pause" : "Play"}
              </button>
              <button
                onClick={() =>
                  act({ type: "SEEK", positionSec: Math.max(0, currentPositionSec - 5) })
                }
              >
                -5s
              </button>
              <button
                onClick={() => act({ type: "SEEK", positionSec: currentPositionSec + 5 })}
              >
                +5s
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
        />
      )}

      {/* The active player's own timeline (not `me.timeline`) is what every
          voter's guess is judged against — see StealPanel's comment.
          Rendered only until *this* player has voted; once `myVote` exists,
          there is nothing left for them to click (the vote list below
          already shows their status instead). */}
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
          />
        )}

      {/* The active player already locked in their own placement and
          doesn't vote — but they shouldn't lose sight of the board while
          everyone else does. Same SlotPicker, same live claimedSlots, just
          with no `onSelect` at all: every button renders disabled, so this
          is purely something to watch, not touch. */}
      {state.phase.type === "stealWindow" && isActive && activePlayer && (
        <div>
          <h3>Watching the steal window</h3>
          <SlotPicker
            timeline={activePlayer.timeline}
            songsById={songsById}
            claimedSlots={claimedSlots}
          />
        </div>
      )}

      {/* No REVEAL action/button exists at all — game.ts flips the card on
          its own the instant every non-active player below has voted. This
          is just a fully-open readout of where that stands, since there's
          no reason to hide it in an open-card game. */}
      {votes && (
        <div>
          <h3>Waiting on votes</h3>
          <ul>
            {Object.values(state.players)
              .filter((player) => player.id !== activeId)
              .map((player) => {
                const vote = votes.find((v) => v.playerId === player.id);
                const status =
                  vote === undefined
                    ? "still deciding"
                    : vote.position === null
                      ? "passed"
                      : `attempted a steal at slot ${vote.position}`;
                return (
                  <li key={player.id}>
                    {player.name}
                    {player.id === playerId && " (you)"}: {status}
                  </li>
                );
              })}
          </ul>
        </div>
      )}
      {/* Only the active player may advance the turn — enforced server-side
          too (see game.ts's NEXT_TURN case), this just keeps the button
          from appearing at all for anyone it would be rejected for. */}
      {state.phase.type === "reveal" && isActive && (
        <button onClick={() => act({ type: "NEXT_TURN" })}>Next turn</button>
      )}

      {actionError && <p>{actionError}</p>}

      <PlayerSummary state={state} songsById={songsById} highlightId={activeId} />
    </div>
  );
}
