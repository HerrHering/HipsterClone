# Phase 3.1 — A better reveal, a bonus token, and a real audio player

Four things changed from Phase 3 (see `PHASE-3-SUMMARY.md` for everything
that's still true and unchanged — the room/turn/steal loop, the protocol
shape, the polling architecture, none of that moved):

1. **A player's name is remembered.** Typing it again every time you
   create or join a room on the same phone was pure friction.
2. **The card no longer flips itself.** Voting finishing used to jump
   straight to the outcome in the same request; now the active player
   presses "Reveal" themselves, on purpose, for the suspense.
3. **A bonus-token mechanic.** The active player gets one shot per round
   to guess the song's real title + artist — not just its year — and
   self-judges whether they got it right.
4. **The playback controls became a real, native audio player**, instead
   of custom Play/-5s/+5s buttons, while staying server-authoritative
   (only the active player can actually change what's playing) and
   deterministic (a seek always lands everyone on the exact same instant,
   never a "wherever the network delay happened to leave you" position).

Also asked and answered, no code involved: a room is **never** removed
from server memory, whether a player clicks "Leave room" or just closes
the tab — `leaveRoom()` (`App.tsx`) only clears this browser's own local
seat; the server's `rooms` Map (`game.ts`) only ever grows. Still true,
still fine for a live party game meant to be played in one sitting (see
Phase 3's §14) — flagged here in case it matters for a future session.

---

## 1. Remembering a name (`App.tsx`, `HomeScreen.tsx`)

Same pattern as the existing `hipster-seat` key, one level simpler (a
plain string needs no `JSON.stringify`/`parse`):

```ts
const NAME_STORAGE_KEY = "hipster-name";

function loadStoredName(): string {
  return safeLocalStorageGet(NAME_STORAGE_KEY) ?? "";
}
function storeName(name: string): void {
  if (name) {
    safeLocalStorageSet(NAME_STORAGE_KEY, name);
  }
}
```

`App` seeds `storedName` once (`useState(() => loadStoredName())`) and
passes it down as `HomeScreen`'s new `initialName` prop — `HomeScreen`'s
own `useState("")` becomes `useState(initialName)`, so the field opens
pre-filled but is still perfectly editable. `storeName(name)` is called
right at the top of `handleCreateRoom`/`handleJoinRoom`, so the name
sticks the moment it's submitted — win or lose. Unlike the seat, a stored
name is never removed; there's no "forget me," it should just keep
showing up.

## 2. A manual "Reveal" (`protocol.ts`, `game.ts`, `GameBoard.tsx`)

Before this, `STEAL_ATTEMPT`/`PASS` both called one function that — the
instant every non-active player had voted — immediately computed the
outcome and jumped `stealWindow` straight to `reveal`, all in that same
request. There was no gap to hang a button on. The fix splits that one
automatic jump into two steps, with a new phase in between:

```ts
// protocol.ts — same fields as stealWindow, just a distinct tag
| {
    type: "pendingReveal";
    songId: string;
    activePlacementPosition: number;
    votes: { playerId: PlayerId; position: number | null }[];
  }
```

`maybeCompleteVoting` (renamed from `maybeFinishRound`, and no longer
`async` — it no longer needs the song catalog) now just flips the phase
to `pendingReveal` once everyone's voted, instead of resolving anything:

```ts
function maybeCompleteVoting(
  state: GameState,
  phase: Extract<GamePhase, { type: "stealWindow" }>,
): void {
  if (!everyoneHasVoted(state, phase.votes)) return;
  state.phase = {
    type: "pendingReveal",
    songId: phase.songId,
    activePlacementPosition: phase.activePlacementPosition,
    votes: phase.votes,
  };
}
```

A new `GameAction`, `REVEAL`, is the only thing that can move a
`pendingReveal` phase forward — active-player-only, exactly like every
other turn-taking action:

```ts
case "REVEAL": {
  if (phase.type !== "pendingReveal") {
    throw new Error(`can't reveal during "${phase.type}"`);
  }
  if (playerId !== activeId) {
    throw new Error("only the active player can reveal the card");
  }
  await finishRound(state, activeId, phase);
  break;
}
```

`finishRound` itself — the actual "who was right, who stole it, did
someone win" logic — is unchanged in substance, just relocated from being
called automatically to being called from here. On the client, a new
`RevealPanel` component (`GameBoard.tsx`) owns this whole moment: a
"Reveal" button (only for the active player, only once `pendingReveal`),
and — once the phase is `reveal` — the outcome text.

## 3. Guess-for-a-token (`protocol.ts`, `game.ts`, `GameBoard.tsx`)

No new currency — a correct guess awards one ordinary token, the same
`tokens` field already spent on steal attempts. The guess text itself
**never reaches the server** — comparing "Bohemian Rhapsody" to "bohemian
rhapsody - queen" is exactly the kind of fuzzy judgment call a human
should make, not a string-equality check — so only the player's own
yes/no verdict is sent, as a new `CLAIM_GUESS_TOKEN` action:

```ts
case "CLAIM_GUESS_TOKEN": {
  if (phase.type !== "reveal") {
    throw new Error(`can't claim a guess token during "${phase.type}"`);
  }
  if (playerId !== activeId) {
    throw new Error("only the active player can claim a guess token");
  }
  if (phase.guessTokenClaimed) {
    throw new Error("a guess token was already claimed this round");
  }
  phase.guessTokenClaimed = true;
  requirePlayer(state, activeId).tokens += 1;
  break;
}
```

`guessTokenClaimed` (a new field on the `reveal` phase, starting `false`
every time one is created) is what makes this safe against a
retried/duplicated request minting a second token — the exact same
"reject before mutating anything" pattern every other action in this file
already uses.

`RevealPanel` owns the whole flow: an optional text input while
`pendingReveal` ("Guess the title + artist"), locked into local state
(`lockedGuess`) the instant Reveal is clicked — *before* the real answer
is shown, so it's a genuine blind guess — and, once revealed, a
confirmation prompt built straight from that locked guess and the real
answer:

```tsx
{isActive && lockedGuess && !phase.guessTokenClaimed && (
  <div>
    <p>
      The song was {describeSong(songsById, phase.songId)}, you
      guessed "{lockedGuess}". Are they the same?
    </p>
    <button onClick={() => { onClaimToken(); setLockedGuess(null); }}>
      Yes, they are the same, I deserve a token!
    </button>
    <button onClick={() => setLockedGuess(null)}>
      No, the songs are not the same, I don't deserve a token!
    </button>
  </div>
)}
```

Left blank, `lockedGuess` stays `null` and this prompt never appears at
all — nobody is ever asked to judge a guess they didn't make.

**A bug caught during review, worth documenting:** "Next turn" originally
lived in `GameBoard`'s own JSX, gated only on `phase.type === "reveal" &&
isActive` — completely independent of whether the prompt above was still
waiting on an answer. An active player could click straight past it,
forfeiting the token with no warning, since `NEXT_TURN` discards the
`reveal` phase object for good. Fixed by moving "Next turn" *into*
`RevealPanel` itself, gated on `isActive && lockedGuess === null` — a
condition that already covers "never guessed" and "guessed and answered
either way," since both the Yes and No buttons reset `lockedGuess` to
`null` the instant one is clicked.

**A second thing this refactor fixed for free:** `RevealPanel` is
rendered with `key={songId}` (`GameBoard.tsx`), so `guessDraft`/
`lockedGuess` reset to fresh, empty values every new round by being
*remounted* — the same trick `PlacementPanel`/`StealPanel` already used —
rather than needing a `useEffect` to notice "a new round started" and
reset them by hand. Because `songId` stays the same across the
`pendingReveal` → `reveal` transition *within* one round, the component
isn't remounted there, so `lockedGuess` correctly survives from "Reveal
was clicked" through to the confirmation prompt.

## 4. A real audio player (`GameBoard.tsx`, `useGameState.ts`)

Phase 1 used the browser's own `<audio controls>` — a real scrub bar,
duration, play/pause, all free. Phase 3 replaced it with custom
Play/-5s/+5s buttons, because playback became server-authoritative and
multiplayer (`GameState.playback`, only the active player may change it,
every phone's `<audio>` is a "dumb follower" of server state) — a native
widget's own play/pause/scrub bar can't be gated to one player or routed
through an HTTP action. This phase gets the native widget back, without
giving up any of that.

**One real, interactive element for the active player — no invisible
twin.** Nothing but the active player's own actions can ever change
playback during their turn (the server already rejects anyone else's
`PLAY`/`PAUSE`/`SEEK`), so there's no second "truth" for their own device
to follow. A single `<audio controls>`, unmuted by default (its own
native mute button is the only volume control — no separate "Mute for
me," so there's nothing left to double up against), mirrors its own
`onPlay`/`onPause`/`onSeeked` to the server via the same actions the old
buttons used to send:

```tsx
<audio
  controls
  src={audioSrc(state.playback.songId)}
  onPlay={() => mirror({ type: "PLAY" })}
  onPause={() => mirror({ type: "PAUSE" })}
  onSeeked={(event) => /* see below */}
/>
```

**A seek always lands everyone on the exact same instant.** `SEEK` used
to update `positionSec` without touching `isPlaying` — if the song was
already playing, every follower's own network/poll delay before it
applied the change got silently baked into where it landed, so whoever
found out last ended up furthest from the second the active player
actually pointed at. Now `SEEK` always freezes (`game.ts`):

```ts
// A seek always freezes the timestamp exactly where it points, rather
// than preserving isPlaying — every client, no matter when it catches
// up, computes exactly `positionSec` (no elapsed-time term applies
// while paused). A plain PLAY is what starts the clock again, together,
// for everyone, from this exact position.
state.playback.positionSec = action.positionSec;
state.playback.isPlaying = false;
state.playback.updatedAt = Date.now();
```

**The pause is enforced, not just a suggestion, and resuming is
automatic.** Seeking pauses the widget immediately, locks it
(`pointerEvents: "none"` + `tabIndex={-1}` — no native control left to
click, not a value that would get silently corrected back), waits one
full poll interval (`POLL_INTERVAL_MS`, now exported from
`useGameState.ts` so this doesn't duplicate the number), then — only if
it had actually been playing — resumes on its own:

```tsx
onSeeked={async (event) => {
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
```

Waiting one poll interval is an honest approximation, not a guarantee —
this is a polling architecture with no server-push and no
presence-tracking, so there's no way to know for certain every other
phone has already fetched the update. It's the simplest number that's
still meaningfully true: every client is guaranteed to poll at least that
often.

**Non-active players can watch, not touch.** A second, purely decorative
`<audio controls muted>` sits alongside their real (invisible, unchanged)
one — always muted (so it can never itself make sound) and
`pointerEvents: "none"` + `tabIndex={-1}` (so there's nothing to click or
tab to at all) — driven by the exact same "dumb follower" correction as
the real element, via a second ref. The follower `useEffect` generalized
from correcting one ref to looping over both:

```ts
for (const ref of [audioRef, visualAudioRef]) {
  const audio = ref.current;
  if (!audio) continue;
  // ...same currentTime/play/pause correction as before, per element
}
```

The active player's own single element is never in that list at all —
consistent with there being no second "truth" for them to follow.

**Two small fixes found during playtesting:**

- **The status text now sits on its own line.** The "Loading song…/
  Buffering…/Playing/Paused" text (non-active players) and the "Syncing
  with server…"/"Paused — waiting for everyone to catch up…" text (the
  active player) were both plain sibling elements right after an
  `<audio>` tag — `<audio>` and `<span>` are both inline by default, so
  they rendered squeezed onto the same visual line as the player. A
  `<br />` before each one is the whole fix.

- **A mid-turn page refresh left the active player's audio stuck at
  0:00, paused — regardless of what the server actually said.** This
  element deliberately has no `ref` and no periodic correction (that's
  what keeps the seek-lock free of feedback loops, above) — but that also
  means a *freshly created* element, which is exactly what a page refresh
  produces, has nothing to seed it from the server's real position/play
  state. Fixed with a one-time catch-up on `onLoadedMetadata`:

  ```tsx
  onLoadedMetadata={(event) => {
    const playback = state.playback;
    if (!playback) return;
    const audio = event.currentTarget;
    suppressNextSeekRef.current = true;
    audio.currentTime = currentPlaybackPositionSec(playback);
    if (playback.isPlaying) {
      void audio.play().catch((error: unknown) => {
        console.error("audio.play() failed:", error);
      });
    }
  }}
  ```

  This element only exists at all while `isActive`, so it's freshly
  created every time this player's turn starts — not just on a refresh.
  That's harmless: a fresh turn's server state is already `positionSec: 0`,
  paused (`game.ts`'s `loadNextSong`), exactly matching a freshly-loaded
  element's own default, so there's nothing to actually catch up to most
  of the time. It only does real work on the one case that matters: a
  refresh (or any other loss of this element) mid-turn, after the active
  player has already played, paused, or seeked partway through a song.

  One catch: setting `.currentTime` programmatically fires the exact same
  native `seeked` event a real drag does — without `suppressNextSeekRef`,
  loading the page would wrongly trigger the whole lock/mirror/
  auto-resume flow from §above, as if the player had just dragged the
  scrub bar themselves. The flag is set right before the one-time write
  and consumed (reset to `false`) the moment `onSeeked` sees it, so it
  only ever swallows that one synthetic event, never a real one.

---

## How to use the app

Everything from Phase 3's "How to use the app" still applies, with these
updates:

**Your name** is remembered on this phone after the first time you
create or join a room — edit it any time, it just saves again on submit.

**Your turn.** The audio player is now the browser's own native widget —
a real scrub bar, duration, and play/pause, unmuted by default (its own
mute button is the volume control). Dragging the scrub bar pauses
immediately and locks the widget for a moment while everyone else's phone
catches up, then resumes on its own if it had been playing.

**Once every vote is in**, you (the active player) get a "Reveal" button
instead of the card flipping itself — this is also your one chance to
type a guess at the song's title + artist before you see the answer, if
you want to try for a bonus token. Leave it blank to skip.

**At reveal**, if you typed a guess, you're shown it next to the real
answer and asked to judge for yourself whether they're the same — "Next
turn" doesn't appear until you've answered (or didn't guess at all).

**Winning** still means reaching 10 cards first — token counts you may
have picked up guessing don't count toward that, they're spent on steal
attempts.
