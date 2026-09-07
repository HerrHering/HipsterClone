# Phase 4 — UX polish and an event log

A few things changed from Phase 3.1 (see `PHASE-3.1-SUMMARY.md` and
`PHASE-3-SUMMARY.md` for everything still true and unchanged — the
room/turn/steal loop, the protocol shape, the polling architecture, none
of that moved):

1. **A real visual design**, replacing almost-unstyled HTML with a
   card-based look that works on a phone (the primary device for a party
   game) and expands to a two-column layout on a laptop.
2. **An event log** ("Activity" panel) — a running list of what's
   happened in the room, Catan-style: "Alice joined the room," "Bob
   attempted to steal at slot 1," and so on.
3. **A round of polish follow-ups** after playing with it for real —
   contrast fixes, more detail in the log, and a real bug fix in the
   playback status text. Covered in its own section (§4) at the end.

Since you're still learning TS/JS/HTML, this summary leans on real code
snippets and explains the language/browser features they use, not just
the game logic.

---

## 1. The event log — a plain array of strings

### The data model (`packages/shared/src/types/protocol.ts`)

The simplest possible design: `GameState` just gets one more field, an
array of strings, oldest first.

```ts
export interface GameState {
  // ...everything that was already here...
  log: string[];
}
```

No `id`, no `timestamp`, no fancy object per entry — just text. Nothing
in the UI needs to click on, animate, or sort an individual log line, so
a plain string is all the structure this needs. (This is a common TS
lesson: don't reach for an object/interface until something actually
needs more than one field.)

### Writing to the log (`apps/api/src/game.ts`)

The server is the only thing allowed to change `GameState` (see Phase
3's design), so it's the only thing that pushes to the log too. One
small helper, used everywhere something log-worthy happens:

```ts
const MAX_LOG_ENTRIES = 50;

function pushLog(state: GameState, message: string): void {
  state.log.push(message);
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
  }
}
```

- `.push(message)` adds to the end of the array (the newest entry).
- `.splice(0, N)` removes `N` items starting at index `0` — i.e. deletes
  the *oldest* entries once there are more than 50. This matters because
  rooms are never deleted from server memory (see Phase 3.1) — without a
  cap, a room left open for hours would grow its log forever.

Then, at every interesting moment, one line calls it — for example, in
`applyAction`'s `CONFIRM_PLACEMENT` case:

```ts
pushLog(
  state,
  `${requirePlayer(state, playerId).name} placed a card at slot ${action.position} in their timeline.`,
);
```

The slot number was added after playing a round for real — "Alice placed
a card in their timeline" turned out to be too vague to follow along
with. It's safe to include: every player can already see which slot is
which live on the board (`SlotPicker`), so a number in the log reveals
nothing new about the *song* — it only reveals where an action happened,
never what the card actually is.

That `` `${...}` `` syntax is a **template literal** — backticks instead
of quotes let you drop a real expression (`requirePlayer(...).name`)
straight into the middle of a string, instead of gluing pieces together
with `+`.

One rule threads through every message: **never name the song before its
`reveal` phase.** `CONFIRM_PLACEMENT`/`STEAL_ATTEMPT`/`PASS` only ever
say *who did something*, never *what song it was* — the title/artist
only gets logged once inside `finishRound`, at the exact moment it's
safe to say out loud:

```ts
pushLog(state, `The song was "${song.title}" by ${song.artist} (${song.year}).`);
```

### Reading it on the client (`apps/web/src/game/EventLog.tsx`, new file)

The whole component:

```tsx
import { useEffect, useRef } from "react";

interface Props {
  entries: string[];
}

export function EventLog({ entries }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries.length]);

  return (
    <details className="card event-log">
      <summary>Activity</summary>
      <ul ref={listRef}>
        {entries.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </details>
  );
}
```

A few things worth calling out if these patterns are new to you:

- **`useRef`** gives you a mutable box (`{ current: ... }`) that survives
  between renders without causing a re-render itself. Here it's used to
  get a direct handle on the real `<ul>` DOM element, so plain
  JavaScript (`list.scrollTop = list.scrollHeight`) can scroll it —
  something React's own props/state can't do for you.
- **`useEffect(fn, [entries.length])`** re-runs `fn` only when
  `entries.length` changes (a new log line arrived) — that's what makes
  it auto-scroll to the bottom exactly when something new shows up, not
  on every unrelated re-render.
- **`<details>`/`<summary>`** is a real HTML element, not something
  built with JavaScript — the browser natively knows how to
  collapse/expand it when you click the `<summary>`, no state, no
  `onClick` handler needed at all. `index.css` then does one small trick
  to make it *always* open on a wide screen (more on that below).
- **`key={index}`** — React wants a stable `key` for every item in a
  list so it can tell which item is which across re-renders. Using the
  array index is fine here because entries are never reordered or
  edited in place, only appended (and occasionally trimmed from the
  front, which is a totally harmless edge case for a plain text list).

`EventLog` is used in both `LobbyScreen.tsx` (so joins show up while
waiting for the game to start) and `GameBoard.tsx` (including the
"Game over!" screen).

---

## 2. The design system (`apps/web/src/index.css`)

Before this phase, there was almost no CSS — one file styling `h1`,
`h2`, `p`, and two little classes. Everything else (buttons, lists,
panels) looked like raw, unstyled HTML. This phase adds a small design
system on top of the *same* file, using **CSS custom properties**
(a.k.a. CSS variables) that already existed for light/dark mode.

### CSS variables, in plain terms

```css
:root {
  --space-4: 20px;
  --radius-md: 12px;
  --accent: #aa3bff;
}

.card {
  padding: var(--space-4);
  border-radius: var(--radius-md);
}
```

`--space-4` isn't special syntax — it's just a variable name (any name
starting with `--` is a custom property). `var(--space-4)` reads it back.
The payoff: change `--space-4` in one place, and every `.card` (and
everything else using it) updates together. This project already used
this trick for colors (`--accent`, `--text`, `--bg`, ...) so the app can
support light and dark mode — Phase 4 just adds more variables for
spacing, corner-rounding, and a couple of new semantic colors
(`--danger`, `--warning`) on top of the same pattern.

### One reusable "card" look

Instead of writing custom CSS for the home screen, the lobby, the
placement panel, the scoreboard, etc., they all just get `className="card"`:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: var(--space-4);
}
```

```tsx
<div className="card stack">
  <h2>Play</h2>
  {/* ... */}
</div>
```

That's the whole idea behind a small design system: define the look
*once* as a class, then reuse the class everywhere instead of repeating
styles.

### Responsive layout with `@media`

The main game screen splits into two columns on a laptop, but stacks
into one column on a phone — the important part for a phone-first game.
This is done with **CSS Grid** plus a **media query**:

```css
.game-layout {
  display: grid;
  grid-template-columns: 1fr; /* one column by default (phones) */
  gap: var(--space-4);
}

@media (min-width: 860px) {
  .game-layout {
    /* main content + a fixed 320px sidebar, once there's room */
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
```

`@media (min-width: 860px) { ... }` means "only apply these rules once
the browser window is at least 860 pixels wide." Below that width, the
first rule (a single `1fr` column) wins. This is the standard
"mobile-first" pattern: write the small-screen layout as the default,
then add rules that only kick in on bigger screens.

The same idea makes the event log behave differently by screen size —
collapsed by default (so it doesn't push the game board off a phone
screen), but forced open on a laptop:

```css
@media (min-width: 860px) {
  .event-log:not([open]) > *:not(summary) {
    display: block !important;
  }
}
```

`[open]` is an **attribute selector** — it matches a `<details>` element
that currently has the `open` attribute (i.e. the user expanded it).
`:not([open])` matches the opposite: a closed one. Normally a closed
`<details>` hides everything except its `<summary>`; this rule
overrides that, but *only* on wide screens — so the panel behaves like
an always-open sidebar on a laptop, and a tap-to-expand drawer on a
phone, with zero JavaScript involved.

### Color-coded buttons and badges

Every button used to look the same. Now the color tells you something
about the action before you even read the label:

```css
.btn-primary {   /* the one "main," safe, forward-progress action */
  background: var(--accent);
  color: #fff;
}
.btn-warning {    /* costs something and might fail (a steal attempt) */
  background: var(--warning-bg);
  color: var(--warning);
}
.btn-danger-outline {  /* leaving/exiting */
  border-color: var(--danger);
  color: var(--danger);
}
```

```tsx
<button className="btn btn-warning" ...>
  Attempt steal (1 token, win or lose)
</button>
```

Two classes on one element (`className="btn btn-warning"`) is a normal
HTML/CSS pattern — `.btn` supplies the shared shape (padding, rounded
corners, min tap size), `.btn-warning` layers the color on top. Token
counts on the scoreboard get the same warning color (`.badge-token`),
so the resource steals actually cost is visually consistent wherever it
shows up.

`.btn`'s own *plain* (no modifier) style had a real contrast bug, found
after actually using the app: its border used the same faint `--border`
token as a `.card`'s outline, so a plain button (like "Join room") sat
on a white card and nearly disappeared — border and background were
both close to white. The fix was a second, more visible border token
just for things you're meant to tap:

```css
--border-strong: #b9b7bf; /* light mode */
--border-strong: #454854; /* dark mode override */
```

used by `.btn` and `.field input` instead of `--border`. This is the
general lesson: one border color is fine for a static outline (a card),
but an *interactive* element needs enough contrast to visibly invite a
tap — worth its own token rather than reusing the subtle one.

---

## 3. Vote status moved onto the scoreboard (`GameBoard.tsx`)

Previously, "who has voted, and how" lived in its own separate list
below the board. It's now folded into each player's existing scoreboard
card instead — same information, one less panel on the page.

```ts
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
```

A few TypeScript/JS pieces worth unpacking:

- **`Record<string, string>`** is a TypeScript type meaning "an object
  whose keys are strings and whose values are strings" — here, a lookup
  table from a player's id to their vote-status text.
- **`Object.values(state.players)`** turns the `players` object (keyed
  by id) into a plain array, so array methods like `.filter`/`.map`
  work on it.
- **`.map((player) => [player.id, status])`** builds an array of
  `[key, value]` pairs.
- **`Object.fromEntries(...)`** turns that array of pairs *back* into an
  object — `{ "player-id-1": "Passed", "player-id-2": "Still deciding" }`.
  It's the standard way to build a lookup table out of a `.map()` result.

That lookup table gets passed into the scoreboard component as a new,
optional prop, and shown as a small badge next to whichever player it
applies to:

```tsx
{voteStatus && <span className="badge badge-muted">{voteStatus}</span>}
```

`voteStatus && <span>...</span>` is a common React idiom: if
`voteStatus` is falsy (here, `undefined` — nobody's voting right now, or
this is the active player who never votes), the `&&` short-circuits and
renders nothing at all; if it's a real string, the `<span>` renders.

---

## 4. Polish follow-ups (found by actually playing the game)

A design system on paper always misses a few things until you actually
use it on a real phone/laptop. Three worth explaining:

**Muted text was too muted in dark mode.** `--muted-text` (used for
things like "— or —" and vote-status badges) was `#6b7280` in dark
mode — a gray close enough to the card backgrounds (`~#1c1d25`) that it
read as blended-in rather than de-emphasized. Lightened to `#8b93a1`.
Same root cause as the `--border-strong` fix above: a token that's fine
for one *purpose* (subtle) was reused somewhere it needed more contrast.

**The timeline's slot buttons looked disabled even when they weren't.**
The same `--border`/plain `--text` combo that made "Join room" hard to
see was also used for `.slot` (the pills you tap to place a card) — so
even a genuinely clickable slot looked flat, like a claimed/disabled
one. Fixed the same way (`--border-strong`, `--text-h`), and — since
disabled slots now needed their *own* distinct look to still make
sense — added `opacity: 0.6` to `.slot:disabled`.

**A real bug: the "Buffering…" label under the active player's music
player could get stuck forever, even once the song was clearly
playing.** This is a good one to understand if you're learning
`<audio>` events, because it's a classic "forgot to handle the
symmetric case" bug:

```tsx
onLoadStart={() => setAudioStatus("loading")}
onWaiting={() => setAudioStatus("buffering")}   // enters "buffering"
onPlaying={() => setAudioStatus("playing")}     // ...but nothing left it!
```

`onWaiting` fires when the browser pauses playback to buffer more data —
that's what *sets* `audioStatus` to `"buffering"`. But when I added this
status tracking to the active player's `<audio>` element, I copied
`onLoadStart`/`onWaiting`/`onCanPlay` from the non-active player's
element and missed `onPlaying` — the event that fires once real playback
actually resumes. Without it, nothing ever moved `audioStatus` back out
of `"buffering"`, so the label just sat there being wrong. The fix was
one line: add `onPlaying={() => setAudioStatus("playing")}`. The
takeaway: whenever you track a "state machine" across several DOM
events, it's worth listing every state next to the event that's
supposed to *exit* it, not just the one that enters it — a copy-pasted
handler list is an easy place to drop one by accident.

Also folded in from playing the game: slot labels now bracket their
connector words — `describeSlot` (in `GameBoard.tsx`) returns things
like `` `[before] ${song}` `` and `` `[between] ${a} [and] ${b}` `` — so
"before"/"and" can't be misread as part of the song's own title sitting
right next to it. And the poll interval (`useGameState.ts`'s
`POLL_INTERVAL_MS`) went from 1500ms to 1000ms, for slightly snappier
sync between phones — a one-line constant change, not worth its own
code walkthrough.

---

## How to use the app

Everything from Phase 3.1's "How to use the app" still applies — the
game itself didn't change, just how it looks. Two additions:

**The board now fits your phone.** Everything stacks into one column on
a narrow screen, with big, easy-to-tap buttons; on a laptop, the
scoreboard and activity log move into a sidebar next to the board.

**An "Activity" panel** at the bottom of the board (or in the sidebar on
a wide screen) shows a running history of what's happened in the room —
tap it to expand on a phone, always open on a laptop. It never gives
away a song's title before that round's reveal.
