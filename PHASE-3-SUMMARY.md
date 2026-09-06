# Phase 3 — The Game

Phase 1/2 built the song catalog and the on-demand audio cache. Phase 3 is
the actual game: rooms you create and join with friends, a turn-based
card-placement loop played on everyone's own phone, and a token-based
"steal" mechanic — server-authoritative, HTTP-polling based, no new
dependencies (no WebSocket library, no state-management library).

New/changed files:
- `packages/shared/src/types/protocol.ts` — the shared types both sides agree on.
- `apps/api/src/game.ts` + the room routes in `apps/api/src/server.ts` — the server side.
- `apps/web/src/game/*` + `App.tsx` — the client side.

---

## The game loop, in one paragraph

`lobby` (players joining) → `START_GAME` shuffles turn order, deals each
player one starter card + 2 tokens → `playingSong` (a song is loaded; the
active player listens and picks a slot in *their own* timeline) →
`CONFIRM_PLACEMENT` locks that in → `stealWindow` (every *other* player must
now either `STEAL_ATTEMPT` — spend a token, claim a still-open slot **in
the active player's timeline** — or `PASS`; the card only turns over once
all of them have done one or the other, automatically, no one can force it
early) → `reveal` (shows the real year, who was right, who — if anyone —
stole it) → `NEXT_TURN`, **active-player-only**, loads the next song for
the next player, or `gameOver` once someone hits the win target (10 cards).

Every phone polls the server's state every ~1.5s and renders whatever it
gets back; nothing ever talks phone-to-phone directly. Two players' screens
only ever agree because they're both looking at the same server state.

A slot, once claimed by anyone (the active player's own placement
included), is off-limits to everyone else for the rest of that round — a
slow network connection can cost you the slot, but never the token you'd
have spent on it (§8). The active player doesn't wait through the steal
window blind, either — they watch the same board, live, that everyone else
is racing over (§9).

---

## 1. Architecture: two processes, one HTTP link

The browser tab (running the React app) and the Express server
(`apps/api/src/server.ts`) are two completely separate programs, on two
different ports in dev (Vite's dev server, and Express). **Nothing in
`apps/web` ever imports or calls a function from `apps/api`.** The only
thing connecting them is plain HTTP requests — the same mechanism any
website uses to talk to any server, just running on `localhost` instead of
across the internet.

```
┌─────────────────────┐        HTTP request         ┌──────────────────────┐
│   Browser (React)    │  ─────────────────────────▶ │  Express (Node)      │
│   apps/web           │                              │  apps/api            │
│                       │  ◀───────────────────────── │                       │
│  fetch(url, options)  │        HTTP response        │  app.post(path, fn)  │
└─────────────────────┘                              └──────────────────────┘
```

- `app.get(path, handler)` / `app.post(path, handler)` don't call `handler`
  themselves — they *register* it with Express, associating it with an
  HTTP method and a URL pattern. Express is what calls `handler(req, res)`,
  and only later, only when a real request arrives whose method and path
  match.
- `req` (built fresh by Express from the incoming request) and `res` (an
  object with `.json()`/`.status()`/etc. for building the reply) are new
  objects for every single request — a handler never constructs them.
- On the browser side, every server call goes through `fetch(...)`, which
  sends a real HTTP request and returns a `Promise` that resolves once a
  response comes back.

Two different parts of a URL become two different things server-side, and
it's worth being precise about which is which, since the code reads
differently depending on where a value comes from:

- **Route params** — the `:code` in `app.post("/api/rooms/:code/action", ...)`
  — show up as `req.params.code`, always a string, always present if the
  route matched at all.
- **The JSON body** — anything the client put in `fetch`'s `body` option —
  shows up as `req.body`, but only because of the next section.

## 2. `express.json()` — why `req.body` exists at all

By default, Express does **not** parse a request's body — `req.body` would
just be `undefined`, even if the client sent a JSON payload. This one line,
registered before any route:

```ts
app.use(express.json());
```

...adds **middleware**: a function that runs on every incoming request,
before any `app.get`/`app.post` handler gets a turn. `express.json()`'s
middleware reads the raw request body, and — if the `Content-Type` header
says `application/json` — parses it and assigns the result to `req.body`,
so every handler after it can just read `req.body.name` (or whatever it
needs) as a plain JS object.

The original audio routes (`GET /api/cached-ids`, `GET /api/audio/:id`)
never needed this — they take no body, everything they need is already in
the URL. The room routes do (`{ "name": "Alice" }`,
`{ "playerId": "...", "action": {...} }`), which is exactly why this line
exists.

## 3. The data model (`protocol.ts`)

Both sides import the same TypeScript types from `packages/shared` — this
is what makes "the client understands what the server sends" true without
either side guessing. A concrete `GameState` mid-round, three players
(ids shortened for readability — real ones are `randomUUID()` strings):

```json
{
  "phase": {
    "type": "stealWindow",
    "songId": "song_042",
    "activePlacementPosition": 2,
    "votes": [
      { "playerId": "bob", "position": null }
    ]
  },
  "players": {
    "alice": { "id": "alice", "name": "Alice", "timeline": [ { "songId": "song_010", "year": 1994 } ], "tokens": 2 },
    "bob":   { "id": "bob",   "name": "Bob",   "timeline": [ { "songId": "song_017", "year": 2003 } ], "tokens": 2 },
    "cara":  { "id": "cara",  "name": "Cara",  "timeline": [ { "songId": "song_005", "year": 1988 } ], "tokens": 1 }
  },
  "turnOrder": ["alice", "bob", "cara"],
  "currentTurnIndex": 0,
  "usedSongIds": ["song_010", "song_017", "song_005", "song_042"],
  "settings": { "winTarget": 10, "libraryVersion": "1" },
  "playback": { "songId": "song_042", "isPlaying": true, "positionSec": 12.4, "updatedAt": 1757123456789 }
}
```

Reading this back against `protocol.ts`:

- `phase` is a **discriminated union** (`GamePhase`) — its `type` field
  tells you which of five shapes the rest of the object has. `"stealWindow"`
  only, at this moment, has `activePlacementPosition`/`votes`; a `"reveal"`
  phase would instead have `correctYear`/`stolenBy`/etc. TypeScript uses
  `type` to narrow which fields you're allowed to read — `if (state.phase.type === "reveal")`
  is what makes `state.phase.stolenBy` compile inside that branch, and a
  compile error outside it.
- `players` is a `Record<PlayerId, PlayerState>` — a plain object used as a
  lookup table, keyed by id, not an array. Looking up a specific player is
  `state.players["alice"]`, not a `.find()` over a list.
- `currentTurnIndex` (`0` here) is an index *into* `turnOrder`, not a
  player id itself — `turnOrder[currentTurnIndex]` (`"alice"`) is the
  actual active player. `currentPlayerId(state)`, a small shared function,
  does exactly that lookup so nobody has to repeat it.
- `votes` is an **array**, not another `Record` — order matters here (the
  *first* correct guess wins a contested card), and a `Record` would throw
  that order away.
- `playback.positionSec`/`updatedAt` is a snapshot, not a live clock —
  `currentPlaybackPositionSec(playback)` (shared code, used by both server
  and every client) is what turns "12.4 seconds, as of this timestamp"
  into "actually, right now, it's at 14.1 seconds," by adding on however
  much real time has passed since `updatedAt`.

The one thing a client ever *sends* to change any of this is a
`GameAction` — a much smaller discriminated union:

```ts
export type GameAction =
  | { type: "START_GAME" }
  | { type: "CONFIRM_PLACEMENT"; position: number }
  | { type: "STEAL_ATTEMPT"; position: number }
  | { type: "PASS" }
  | { type: "NEXT_TURN" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK"; positionSec: number };
```

Notably absent: a `REVEAL` action. Nobody ever asks for the card to turn
over — `game.ts` flips it automatically, the instant every non-active
player has cast a `STEAL_ATTEMPT` or `PASS` vote (§7).

## 4. A full request, traced end to end: confirming a placement

This is the "click a button" case, followed through every hop, with exact
variable names at each one. Setup: Alice is the active player, she's picked
slot `1` in her own timeline, and presses "Confirm placement."

**1. Inside `PlacementPanel` (`GameBoard.tsx`)** — its own local
`position` state is `1`. The button's `onClick` calls the `onConfirm` prop
it was given:

```tsx
onClick={() => position !== null && onConfirm(position)}
```

**2. `GameBoard` supplied that prop** as an inline arrow function:

```tsx
onConfirm={(position) => act({ type: "CONFIRM_PLACEMENT", position })}
```

So this calls `GameBoard`'s own `act` function with the object
`{ type: "CONFIRM_PLACEMENT", position: 1 }` — this is a real `GameAction`
value, built entirely client-side, nothing sent yet.

**3. `act`** (also in `GameBoard.tsx`) is a thin wrapper that clears any
old error and calls the `onAction` prop:

```ts
async function act(action: GameAction) {
  setActionError(null);
  try {
    await onAction(action);
  } catch (error) {
    setActionError(errorMessage(error));
  }
}
```

**4. `onAction` was passed down from `App.tsx`** as `handleAction`:

```ts
async function handleAction(action: GameAction): Promise<void> {
  if (!seat) return;
  const next = await sendAction(seat.roomCode, seat.playerId, action);
  applyState(next);
}
```

`seat` is `App`'s own state — `{ roomCode: "WXYZ", playerId: "alice-uuid" }`
— so this calls `sendAction("WXYZ", "alice-uuid", { type: "CONFIRM_PLACEMENT", position: 1 })`.

**5. `sendAction`** (`apps/web/src/game/api.ts`) builds the actual request:

```ts
export function sendAction(roomCode: string, playerId: string, action: GameAction) {
  return postJson<GameState>(`/api/rooms/${roomCode}/action`, { playerId, action });
}
```

The URL is now a real string, `"/api/rooms/WXYZ/action"`. The body is a
plain JS object, `{ playerId: "alice-uuid", action: { type: "CONFIRM_PLACEMENT", position: 1 } }`.

**6. `postJson`** turns that object into an actual HTTP request:

```ts
function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

`JSON.stringify(body)` turns the JS object into a literal string of text —
this is the actual bytes that go over the network:

```
{"playerId":"alice-uuid","action":{"type":"CONFIRM_PLACEMENT","position":1}}
```

**7. `fetch` sends it.** On the server, `express.json()`'s middleware (§2)
sees `Content-Type: application/json`, reads that string, and calls
`JSON.parse` on it internally — turning the text back into a JS object,
now assigned to `req.body`. Express also matches the URL against the
registered route `POST /api/rooms/:code/action`, capturing `"WXYZ"` into
`req.params.code`.

**8. The route handler** (`server.ts`) runs:

```ts
app.post("/api/rooms/:code/action", async (req, res) => {
  const { playerId, action } = req.body as { playerId?: string; action?: GameAction };
  if (!playerId || !action) {
    res.status(400).json({ error: "playerId and action are required" });
    return;
  }
  try {
    const state = await applyAction(req.params.code.toUpperCase(), playerId, action);
    res.json(state);
  } catch (error) {
    rejectAction(res, `action ${action.type}`, error);
  }
});
```

`req.body` is destructured back into `playerId` (`"alice-uuid"`) and
`action` (`{ type: "CONFIRM_PLACEMENT", position: 1 }`) — the exact same
values that started this whole chain, now living in a completely different
process.

**9. `applyAction`** (`game.ts`) does the actual work — looks the room up
by code, validates the player exists, checks the phase is `"playingSong"`
and that `playerId` matches the active player, then mutates the room's
`GameState` in place:

```ts
case "CONFIRM_PLACEMENT": {
  if (phase.type !== "playingSong") {
    throw new Error(`can't confirm a placement during "${phase.type}"`);
  }
  if (playerId !== activeId) {
    throw new Error("only the active player can confirm a placement");
  }
  state.phase = {
    type: "stealWindow",
    songId: phase.songId,
    activePlacementPosition: action.position,
    votes: [],
  };
  break;
}
```

`action.position` (`1`) becomes `activePlacementPosition` in the new
`stealWindow` phase object. `applyAction` returns the same `state` object,
now mutated.

**10. Back in the route handler**, `res.json(state)` serializes that whole
object to JSON text and sends it as the HTTP response body.

**11. Back in the browser**, `requestJson` (`api.ts`) parses the response:

```ts
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = /* ... pull data.error, or fall back to status text ... */;
    throw new Error(message);
  }
  return data as T;
}
```

`res.json()` parses the response text back into a plain object — this is
the *new* `GameState`, now sitting in the browser as a JS value, typed as
`GameState` even though nothing was checked at runtime (TypeScript types
don't exist anymore once the code is actually running — `as T` is a
promise to the compiler, not a check).

**12. That object flows back up** through `sendAction`'s return value, to
`App.tsx`'s `handleAction`, which calls `applyState(next)` — this is
`useGameState.ts`'s `setState`, so React re-renders `App`, which passes the
new `state` prop down into `GameBoard`. `state.phase.type` is now
`"stealWindow"`, so the JSX branch that renders `PlacementPanel` no longer
matches, and the one for `StealPanel` (for Bob and Cara) or the read-only
observer view (for Alice, §9) does instead.

That's the whole loop: **thirteen hops, and at every single one, the value
is either "a JS object" or "a string of JSON text"** — nothing more exotic
than that, and nothing skips a step (there's no direct function call
anywhere between step 6 and step 11; every one of those has to happen for
the click to have any effect at all).

## 5. A second trace: a rejected request, and why nobody loses a token

The interesting case isn't the happy path — it's what happens when two
requests collide. Say Bob and Cara are both looking at `stealWindow`, and
both tap the same open slot (`2`) within a few milliseconds of each other.

**Bob's request wins the race.** It reaches the server first. Inside
`STEAL_ATTEMPT`'s handler:

```ts
const slotTaken =
  action.position === phase.activePlacementPosition ||
  phase.votes.some((vote) => vote.position === action.position);
if (slotTaken) {
  throw new Error(`slot ${action.position} is already claimed`);
}
player.tokens -= 1;
phase.votes.push({ playerId, position: action.position });
```

`slotTaken` is `false` (nobody's claimed slot `2` yet) — Bob's token count
drops from `2` to `1`, and `{ playerId: "bob", position: 2 }` gets pushed
onto `phase.votes`. The response is a normal `200` with the updated state.

**Cara's request arrives moments later.** Node.js runs one request
handler's synchronous code to completion before starting the next one's —
there's no `await` between reading `phase.votes` and pushing to it in the
snippet above, so Bob's push has already fully happened by the time Cara's
handler starts running this same code. Now `phase.votes.some((vote) => vote.position === 2)`
is `true` — Bob's own vote satisfies it. `slotTaken` is `true`, and the
function throws **before line `player.tokens -= 1` ever runs.** Cara's
token count is never touched.

That thrown `Error` propagates out of `applyAction`, is caught by the route
handler's `catch`, and reaches `rejectAction` (`server.ts`):

```ts
function rejectAction(res, context, error) {
  const message = errorMessage(error); // "slot 2 is already claimed"
  if (DEBUG) console.log(`game debug: ${context} rejected: ${message}`);
  res.status(400).json({ error: message });
}
```

The HTTP response is now a `400` with the body `{"error":"slot 2 is already claimed"}`.
Back in Cara's browser, `requestJson` sees `res.ok` is `false`, reads
`data.error`, and throws `new Error("slot 2 is already claimed")` — which
propagates all the way up to `GameBoard`'s `act`, lands in its `catch`, and
`setActionError("slot 2 is already claimed")` puts that exact string on
Cara's screen.

**The point of tracing this:** the validation-and-reject happens *before*
any token is spent, in every rejection case in this function (no tokens
left, already voted, wrong phase, and this one). So there's no
"spend-then-refund" step to get subtly wrong — a rejected request simply
never reaches the line that would have cost Cara anything. She keeps her
token and can immediately try a different, still-open slot. This is also
exactly why no lock or mutex is needed anywhere in this file: JavaScript's
single-threaded event loop already guarantees "first synchronous block to
run, wins," for free.

## 6. Polling: how two phones' screens end up agreeing

There's no code anywhere that pushes a change from one phone to another.
Instead, `apps/web/src/game/useGameState.ts` asks, repeatedly:

```ts
const poll = () => {
  fetchState(roomCode)
    .then((next) => { setState(next); setError(null); })
    .catch((err) => setError(errorMessage(err)));
};
poll();
const timer = setInterval(poll, 1500);
```

Every 1.5 seconds, every phone in the room sends a plain `GET
/api/rooms/:code/state` and re-renders with whatever comes back — no
`playerId` needed on this route at all, since the game is played with open
cards and nothing in `GameState` is hidden from anyone. If Alice confirms a
placement, her own screen updates immediately (§4, step 12, via
`applyState`) — Bob and Cara's screens catch up on their *own* next poll
tick, up to ~1.5s later.

Deliberately not a WebSocket: that would mean a persistent connection per
phone, reconnect logic, and a whole different mental model, for a party
game where "up to 1.5 seconds behind" is imperceptible. `useGameState` also
never calls `setState(null)` to clear stale state — instead it *masks* the
return value (`state: roomCode ? state : null`), because a `setState` call
made synchronously inside the effect would trigger an extra, unnecessary
re-render.

## 7. Server-side game logic (`game.ts`)

Everything a room can do lives in one file, structured like this:

- **`rooms`** — `const rooms = new Map<string, GameState>()`, the entire
  server-side "database" (see §12 for more on this).
- **`requirePlayer(state, playerId)`** — every single lookup of a player by
  id goes through this, instead of a raw `state.players[playerId]`. The
  repo enables `noUncheckedIndexedAccess`, so indexing a `Record` always
  types as possibly-`undefined` — `requirePlayer` throws a clear message
  ("no player in this room") instead of letting `undefined` leak through
  silently.
- **`applyAction(roomCode, playerId, action)`** — the one function that
  ever mutates a `GameState`. A `switch` over `action.type`, one case per
  `GameAction` variant, each one: (1) checks the current phase allows this
  action, (2) checks `playerId` is allowed to send it, (3) mutates `state`
  in place, (4) `break`s. Every rejection is a plain `throw new Error(...)`
  — `server.ts`'s route handler is what turns that into an HTTP `400`.
- **The `default` case** is a compile-time trip wire, not a runtime check:

  ```ts
  default: {
    const _exhaustive: never = action;
    throw new Error(`unrecognized action "${JSON.stringify(_exhaustive)}"`);
  }
  ```

  `never` is TypeScript's type for "a value that cannot exist." Assigning
  `action` to a `const` typed `never` only compiles if every earlier `case`
  has already ruled out every real possibility. The moment `GameAction`
  (in `protocol.ts`) grows a new variant without a matching `case` above,
  *this line* stops compiling — catching the gap at build time, before a
  player could ever discover it as a button that mysteriously does nothing.

## 8. Exclusive steal slots

Nothing stops two players from wanting the same slot, or a spectator from
guessing the exact slot the active player already placed at — so the game
makes slots a scarce, first-come resource. `STEAL_ATTEMPT`'s handler
rejects a position that's already claimed, either by the active player's
own placement or by an earlier vote:

```ts
const slotTaken =
  action.position === phase.activePlacementPosition ||
  phase.votes.some((vote) => vote.position === action.position);
if (slotTaken) {
  throw new Error(`slot ${action.position} is already claimed`);
}
```

Walked through in full, with the race-condition case, in §5. On the
client, `GameBoard.tsx` builds a `claimedSlots: Map<number, string>`
(position → claimant's name) from the same two sources
(`activePlacementPosition` + `votes`), and `SlotPicker` renders a claimed
slot disabled, grayed out (the `.slot-claimed` CSS class), and labeled with
who's there — still visible (this stays an open-card game), just not
clickable.

## 9. The active player's read-only view

Before this, the moment the active player confirmed their placement, the
slot board disappeared from their screen entirely — everyone else could
watch the board fill in live, but they couldn't. The fix needed no new
component: `SlotPicker`'s `onSelect` prop is optional, and a slot is
disabled whenever there's no `onSelect` to call *or* it's already claimed:

```tsx
disabled={!onSelect || claimedBy !== undefined}
onClick={() => onSelect?.(position)}
```

`GameBoard` renders the exact same `SlotPicker`, with the exact same live
`claimedSlots`, for the active player during `stealWindow` — just without
passing `onSelect` at all. Every button ends up disabled regardless of
whether it's claimed. "Read-only" isn't a separate mode or a boolean flag
anywhere in the code — it falls out for free from a picker that simply has
nothing to call when clicked.

## 10. The audio status indicator

The first phone to ask for a given song can trigger a real `yt-dlp`
download server-side (`apps/api/src/cache.ts`'s `ensureCached`), which can
take far longer than ordinary buffering. `GameBoard.tsx` tracks this with
one more piece of state, driven entirely by the `<audio>` element's own
browser events — not by `GameState`, since this is about *this phone's own*
fetch, which the server has no visibility into at all:

```tsx
onLoadStart={() => setAudioStatus("loading")}
onWaiting={() => setAudioStatus("buffering")}
onPlaying={() => setAudioStatus("playing")}
onPause={() => setAudioStatus("paused")}
```

Rendered as "Loading song…" / "Buffering…" / "Playing" / "Paused" next to
the mute button, visible to every player (every phone fetches
`/api/audio/:id` independently — the server-side download itself is still
shared/deduped across phones via `cache.ts`'s `inFlightDownloads` map, only
the first request per song actually waits on `yt-dlp`). The `<audio>`
element also has `preload="auto"`, so the browser starts fetching the
moment a new song loads, rather than waiting for an explicit Play press.

## 11. React/JSX, for someone new to it

Files ending in `.tsx` look like HTML but aren't — that's **JSX**, which
compiles down to plain JavaScript function calls building a description of
what should be on screen. A component is just a function that returns that
description:

```tsx
function LobbyScreen({ roomCode }: Props) {
  return (
    <div>
      <h2>Room {roomCode}</h2>
    </div>
  );
}
```

`{roomCode}` isn't special HTML syntax — it's a normal JS expression
spliced into the output, the same idea as a template string. Calling this
function doesn't touch the real page; it produces an in-memory description
("a div containing an h2 containing the text 'Room' plus whatever
`roomCode` currently is"). **React** is the library that takes that
description, compares it to what's currently on the real page, and makes
the minimum changes needed to match — nothing in this codebase ever calls
`document.createElement` or touches the DOM by hand.

**State and re-rendering.** `useState` gives a component memory that
survives between renders, plus a setter that tells React "re-run this
component, something it depends on changed":

```tsx
const [muted, setMuted] = useState(false);
// ...
<button onClick={() => setMuted((prev) => !prev)}>
  {muted ? "Unmute for me" : "Mute for me"}
</button>
```

`onClick={...}` wires a real browser click event to a plain JS function —
clicking calls `setMuted`, React re-runs `GameBoard`, and the button's
label changes because the function returned different JSX this time.
Nothing more magic than that. The actual network request (§4) only happens
because *some* `onClick` handlers, like `act`, go on to call `onAction` —
the click itself and the HTTP call are two separate steps glued together
by ordinary function calls, not one built-in mechanism.

## 12. `localStorage`, in detail

`useState` memory is *component* memory — it vanishes completely on a page
reload. Fine for "which slot did I just click" (losing it on refresh is
harmless), wrong for "which room and seat is this phone in" (losing that
mid-game would be genuinely annoying). `localStorage` is a different kind
of memory: a small, persistent key→string dictionary the browser keeps per
site (another website can't read it, and it can't read another website's),
surviving a reload, a closed tab, even a restarted browser:

```ts
localStorage.setItem("key", "some string");
localStorage.getItem("key"); // -> "some string", or null if never set
localStorage.removeItem("key");
```

Everything stored is a **string** — there's no built-in way to store an
object directly. That's why `App.tsx`'s `storeSeat` does
`JSON.stringify(seat)` going in, and `loadStoredSeat` does
`JSON.parse(raw)` coming back out; `localStorage` itself never sees
anything but text.

**Why it needs a try/catch at all.** Unlike a `useState` setter, which
never fails, `localStorage` is a real browser API that can throw
(historically, Safari's private browsing threw on `setItem` rather than
silently no-op'ing; storage can also be disabled or full). This codebase
handles that the same way everywhere: fall back quietly (nothing gets
remembered this session) rather than let a storage hiccup crash the app.
`apps/web/src/localStorage.ts` is three tiny functions, each one browser
call wrapped in a try/catch:

```ts
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
```

**Where it's actually used:** `App.tsx`'s `loadStoredSeat`/`storeSeat`
(remembers `{ roomCode, playerId }`, so refreshing your phone mid-game
doesn't bounce you back to the home screen), and `GameBoard.tsx`'s `muted`
state (remembers your own phone's mute preference across a reload). Both
are *per-device* — nothing about them is shared with, or visible to, any
other player's phone; that's a plain fact about `localStorage` (it's local
to one browser), not something this app enforces itself.

## 13. Two small shared helpers

**`errorMessage`** (`packages/shared/src/errorMessage.ts`) — every
`catch (error)` block in this codebase has `error` typed as `unknown`
(JavaScript's `throw` accepts any value, not just an `Error`), so turning
it into a readable string needs the same one-liner everywhere:

```ts
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

It lives in `packages/shared` because all three workspaces (`tools/scraper`,
`apps/api`, `apps/web`) already depend on that package for the game's
types — one more small export there reaches everywhere for free.

**`rejectAction`** (private to `server.ts`) — both room routes that can
fail (`join`, `action`) turn a caught error into a logged-and-400 response
the same way, so it's one small, unexported function in that file rather
than something promoted to `packages/shared` — it only needed to stop two
handlers *in the same file* from repeating themselves (§5 shows it in
use). The same "not every duplicate needs to leave the file it's in"
reasoning is why `game.ts`'s own `requirePlayer` is private too.

## 14. Where does `GameState` actually live? (server storage)

Entirely in memory — no database, no file on disk. `apps/api/src/game.ts`:

```ts
const rooms = new Map<string, GameState>();
```

One plain JS `Map`, keyed by room code, declared as a module-level
variable — it lives for as long as the Node process running `server.ts`
stays up, and nowhere else. `createRoom` builds a fresh `GameState` object
and does `rooms.set(roomCode, state)`; every other function (`joinRoom`,
`getState`, `applyAction`) looks it back up and *mutates that same object
in place* — `state.players[id] = player`, `phase.votes.push(...)`,
`state.phase = { type: "reveal", ... }`, and so on. There's no separate
"save" step anywhere — the Map entry already points at the one live object
every request for that room shares, so mutating it *is* saving it.
Multiple rooms run concurrently for free, simply by being different keys
in the same Map.

**The consequence of "memory only":** restarting the server (a crash, a
redeploy, or in dev, a file-change reload) empties `rooms` completely.
Every in-progress game is gone instantly, with no way to recover it. Any
phone that still remembers a `{ roomCode, playerId }` seat in
`localStorage` (§12) will find `getState(roomCode)` returns `null`
afterward; `App.tsx` already treats that the same as "room doesn't exist."

**Why this is fine, on purpose.** This server does persist two other
things to real files: the song catalog (`apps/web/public/manifest.json`)
and downloaded audio clips (`apps/api/data/cache/*.mp3`) — both need to
survive a restart, since re-scraping or re-downloading would be pure
waste. `GameState` doesn't get the same treatment because it doesn't need
it: this is a live party game meant to be played start-to-finish in one
sitting, not a saved game meant to be resumed hours or days later. Adding
real persistence (a database, a file per room) would be solving a problem
this app doesn't actually have.

## 15. Component tour — who renders whom

```
App                       (top-level: which screen is showing right now)
├── HomeScreen            (no room yet — pick a name, create/join)
├── LobbyScreen           (phase === "lobby" — waiting to start)
└── GameBoard             (every other phase — the actual game)
    ├── PlacementPanel    (only for the active player, during playingSong)
    │   └── SlotPicker
    ├── StealPanel        (only for a non-active player who hasn't voted yet)
    │   └── SlotPicker
    ├── SlotPicker        (used directly — the active player's read-only
    │                      view of the same board during stealWindow, §9)
    └── PlayerSummary     (always — everyone's cards/tokens, open-card)
```

**Why some of these are their own file and some aren't.** `HomeScreen.tsx`,
`LobbyScreen.tsx`, and `GameBoard.tsx` are each a whole *screen* —
`App.tsx` swaps between them wholesale depending on game phase, the same
way you'd expect separate files for separate pages of a website.
`SlotPicker`, `PlacementPanel`, `StealPanel`, and `PlayerSummary` are only
ever used *inside* `GameBoard.tsx`, as fragments of that one screen — so
they're plain functions declared in that same file. The rule that matters
is "is this reused or reasoned about independently of its parent," not
"does every component get its own file."

**Data flows down, actions flow up.** A parent passes data *down* as props
(`GameBoard` hands `PlacementPanel` a `timeline` to render); a child
reports things happening back *up* by calling a function its parent gave
it (`PlacementPanel` doesn't know how to talk to the server — it just calls
the `onConfirm` function it was handed). §4 traces exactly this chain,
click to server and back, for `CONFIRM_PLACEMENT`.

---

## How to use the app

**Create or join a room.** Open the app, type a name, and either "Create a
new room" (you get a 4-letter code to hand to friends) or type a code
someone else gave you and "Join room." Everyone does this on their own
phone.

**The lobby.** Shows everyone who's joined so far. Once there are at least
2 players, anyone can hit "Start game" — this shuffles turn order and
deals every player one starter card and 2 tokens.

**Your turn.** Press Play to start the song (only you can hear it — that's
the point, same as holding up the physical card for the group; watch the
"Loading song…"/"Buffering…" indicator if a song's never been played
before — the first fetch can take a while), use -5s/+5s to replay part of
it, then pick a slot in your own timeline and confirm.

**Once you've confirmed, you don't go away.** You can't vote anymore and
your own slot picker stops taking clicks, but you keep watching the same
board everyone else is racing over — the same live view of claimed/open
slots, just read-only.

**Everyone else's turn.** While someone else is playing, once they confirm
their placement you'll be asked to either attempt a steal (spend 1 token,
claim a slot **in their timeline**, win it into your own if you're first to
guess right and they were wrong) or pass (free, no guess). Slots are
exclusive — once anyone claims one, it's grayed out and labeled with who's
there, and nobody else can pick it; if your tap loses a race for the same
slot, you keep your token and just pick a different, still-open one. Once
everyone else has voted, the card turns over on its own.

**Reveal, and the next turn.** Shows the real year and what happened. Only
the active player sees a "Next turn" button.

**Winning.** First player to 10 cards wins.

**Mute.** Each phone has its own "Mute for me" toggle — it only affects
that phone's own audio, never the shared game state.

**Debugging.** `HIPSTER_DEBUG=1 npm run dev` (or `npm run dev:debug`) shows
every room action the server accepts or rejects, in addition to everything
`PHASE-2.1-SUMMARY.md` already documents for the catalog/download side.
