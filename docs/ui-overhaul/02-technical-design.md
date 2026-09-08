# Tabletop UI overhaul: technical design

## 1. Design constraints and implementation boundary

This plan implements `01-requirements.md` entirely in `apps/web`. Do not edit
`apps/api`, `packages/shared`, the HTTP routes, `GameState`, `GamePhase`, or
`GameAction`. Continue to render the latest polled server snapshot and send the
existing actions only. Selection, drag state, focus state, the optional song
guess, local mute, audio-element status, and request-pending flags are the only
new client state.

No new runtime dependency is needed. React 19, Pointer Events, native range
inputs, `ResizeObserver`, CSS transforms, and the existing inline SVG approach
cover the design. In particular, do not add a drag/drop or animation library.

The current non-game screens and persistent behavior remain owned by their
existing files:

- `App.tsx`: manifest loading, seat/name persistence, polling, immediate action
  responses, loading/error states, and the lobby/game switch.
- `AppHeader.tsx`: persistent room/turn/leave HUD. Extend it with the local mute
  control by lifting the `hipster-muted` state to `App`, so it is reachable on
  every seated screen and can be passed into `GameBoard`.
- `HomeScreen.tsx` and `LobbyScreen.tsx`: preserve fields, validation, start
  behavior, error handling, and activity log; only class names/CSS may change.
- `EventLog.tsx`: keep its `<details>` disclosure and auto-scroll behavior.
- `useGameState.ts` and `api.ts`: no behavioral changes.

## 2. Proposed file/component map

Keep `GameBoard.tsx` as the orchestration boundary, but break its current large
render path into board-specific components. Suggested files and exact duties:

| File | Component/helper | Responsibility |
| --- | --- | --- |
| `game/boardModel.ts` | pure exported helpers | Viewer-relative seat rotation, seat descriptors, phase permissions, claimed-gap maps, vote labels, emphasis, gap availability, reveal display timeline, and selection reducer. Contains no React or DOM code. |
| `game/TabletopBoard.tsx` | `TabletopBoard` | Table surface, center stack, all player zones, fallback list, DOM ordering, and phase action tray. Receives derived data and callbacks; sends no requests itself. |
| `game/PlayerZone.tsx` | `PlayerZone` | One fixed seat rectangle: upright name plate, timeline, tokens, progress, host/you/turn/vote/outcome text. |
| `game/TokenPile.tsx` | `TokenPile` | Exact accessible count and deterministic CSS token discs; optionally exposes one draggable source token. |
| `game/MysteryCard.tsx` | `MysteryCard` | Draw-stack top card, audio front, state-driven flip, answer back, pointer/keyboard placement source. It must not receive `song` until reveal. |
| `game/AudioControls.tsx` | `AudioControls` | The single real `<audio>` element, custom play/pause button, range, time/status text, active controls, follower reconciliation, seek lock, local mute, and event callbacks. |
| `game/SongTimeline.tsx` | expanded existing component | Horizontal/vertical fixed lane, measured scaling, legal 44px gap buttons, selected ghost/coin, claimed/result markers, focus movement, and readable labels. |
| `game/SongCard.tsx` | expanded existing component | Compact timeline `yearOnly` variant and answer-card variant; safe missing-manifest fallback. |
| `game/usePointerPlacement.ts` | hook | Pointer capture, drag threshold, hit testing, preview, drop/cancel, and live announcements shared by card and token drags. |
| `game/useTimelineScale.ts` | hook | `ResizeObserver` calculation and compact/scroller mode for a timeline lane. |
| `game/GameBoard.tsx` | orchestrator | Existing audio prefetch and action-error boundary, local round state, pending requests, state derivation, reveal-guess lifecycle, and composition of HUD/table/actions/log. |
| `icons.tsx` | small inline icons | Add play, pause, volume/mute, star, and directional/drag icons as needed. |
| `index.css` | visual system | Replace in-game dashboard rules with tabletop variables, seat geometry, physical cards/tokens, responsive modes, focus, contrast, and reduced motion. Preserve generic form/lobby/error classes still in use. |

If implementation cost favors fewer files, `TokenPile`, `PlayerZone`, or the two
hooks may remain in `TabletopBoard.tsx`, but the pure helpers must stay isolated
and exported so the required behavior can be tested in the root Node Vitest
environment without adding a DOM test dependency.

## 3. Pure board model

### 3.1 Stable viewer-relative order

Implement:

```ts
export interface SeatedPlayer {
  playerId: string;
  seatIndex: number;
  seat: SeatName;
  orientation: "horizontal" | "vertical";
}

export function rotateTurnOrder(
  turnOrder: string[],
  viewerId: string,
): string[];
export function seatPlayers(
  turnOrder: string[],
  viewerId: string,
): SeatedPlayer[];
```

Find `viewerId` in `turnOrder`; use index `0` when it is absent. Return a new
array `order.slice(start).concat(order.slice(0, start))`; never mutate state.
The returned element at index zero is always the bottom seat, and following
elements occupy increasing clockwise seat indices. Player rendering must use
`turnOrder`, not `Object.values(players)`, after game start. If an id is absent
from `players`, skip that zone defensively but do not renumber other seats.

Exact seat descriptors for two through six players:

| Count/index | `SeatName` | anchor x/y (%) | zone width/height (%) | orientation |
| --- | --- | --- | --- | --- |
| 2/0 | bottom | 50/86 | 34/23 | horizontal |
| 2/1 | top | 50/14 | 34/23 | horizontal |
| 3/0 | bottom | 50/86 | 34/23 | horizontal |
| 3/1 | lower-right | 85/30 | 27/42 | vertical |
| 3/2 | lower-left | 15/30 | 27/42 | vertical |
| 4/0 | bottom | 50/86 | 34/23 | horizontal |
| 4/1 | right | 86/50 | 25/49 | vertical |
| 4/2 | top | 50/14 | 34/23 | horizontal |
| 4/3 | left | 14/50 | 25/49 | vertical |
| 5/0 | bottom | 50/87 | 34/21 | horizontal |
| 5/1 | lower-right | 85/69 | 16/26 | vertical |
| 5/2 | upper-right | 75/18 | 32/20 | horizontal |
| 5/3 | upper-left | 25/18 | 32/20 | horizontal |
| 5/4 | lower-left | 15/69 | 16/26 | vertical |
| 6/0 | bottom | 50/88 | 34/20 | horizontal |
| 6/1 | lower-right | 84/72 | 18/31 | vertical |
| 6/2 | upper-right | 84/28 | 18/31 | vertical |
| 6/3 | top | 50/12 | 34/20 | horizontal |
| 6/4 | upper-left | 16/28 | 18/31 | vertical |
| 6/5 | lower-left | 16/72 | 18/31 | vertical |

Set these as inline CSS custom properties (`--seat-x`, `--seat-y`,
`--seat-w`, `--seat-h`) or classes from a static table. A zone uses
`position:absolute; left:calc(var(--seat-x)*1%); top:...; width:...;
height:...; transform:translate(-50%,-50%)`. The tabletop is a 16:10 box with
`min-height: 620px`, `aspect-ratio: 16 / 10`, and a maximum width of 1440px.
The draw stack is `left:50%; top:50%; width:24%; height:32%`, translated around
its center. These rectangles are deliberately non-overlapping; do not enlarge
zones based on their content.

Keep card text upright. `orientation` changes only the timeline flex axis and
chronological arrow; never rotate a whole player zone. Horizontal lanes display
earliest to latest left-to-right even at the top. Vertical lanes display
earliest at the named `Start` end and latest at `End`, top-to-bottom for all
lateral seats, so DOM and keyboard order stay chronological.

CSS visual placement and accessible DOM order are separate. Render children in
this DOM order: center card/action region; viewer zone; active zone if different;
then remaining zones in viewer-relative clockwise order. Give each child its
original `seatIndex` variables so absolute visual positioning does not change.
Avoid rendering the same zone twice by building an ordered unique id list.

For a player count outside 2–6, return `layoutMode: "list"`. `.tabletop-list`
uses normal-flow rows in `turnOrder`, a sticky center card/actions block, and a
contained horizontal timeline scroller. This fallback must also handle empty
or one-player malformed states without non-null assertions.

### 3.2 Permissions and emphasis

Centralize phase rules in a pure `deriveBoardInteraction(state, viewerId)` that
returns:

```ts
interface BoardInteraction {
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
```

Rules must mirror the protocol exactly: place/audio only for active viewer in
`playingSong`; vote/pass only for a non-active, recognized player without an
existing vote in `stealWindow`; steal additionally needs `tokens > 0`; reveal
only active in `pendingReveal`; claim only active in reveal when not already
claimed and the client-side guess judgment is being shown; next only active in
reveal after that judgment is dismissed/completed. The last two client UI gates
may be combined with local guess state in `GameBoard`, while the protocol phase
gate remains pure.

Derive `ZoneEmphasis = "active" | "actionable" | "spectator" | "winner"`:

- normally active player is `active`, everyone else `spectator`;
- during `stealWindow`, an eligible viewer who has not voted gets
  `actionable` on their own zone and `active` on the active target;
- after voting, only the active zone is `active`;
- game over marks the server winner `winner` and others `spectator`.

Use full-contrast text in all zones. Implement de-emphasis with a translucent
felt-colored `::after` veil, lower card/token shadow strength, and
`filter:saturate(.7)`, not opacity on the whole zone. Plates retain status text:
`On turn`, `Your action`, `Passed`, `Vote submitted`, or `Winner`.

## 4. Timeline geometry and scaling

`SongTimeline` must own a fixed `.timeline-viewport` that fills only its zone.
Inside it, `.timeline-stage` reserves natural layout geometry, and
`.timeline-visual` is transformed from its center. Do not let transformed visual
bounds participate in table layout.

Use these constants in `useTimelineScale.ts` (export them for tests):

```ts
const NORMAL_CARD_INLINE = 64;
const NORMAL_CARD_BLOCK = 86;
const COMPACT_CARD_INLINE = 48;
const COMPACT_CARD_BLOCK = 68;
const GAP_VISUAL_INLINE = 14;
const EDGE_PADDING = 8;
const MIN_SCALE = 0.42;
```

For `n` cards, natural inline size is:

`2 * EDGE_PADDING + n * cardInline + (n + 1) * GAP_VISUAL_INLINE`.

Measure the viewport's inline size (`contentRect.width` horizontal,
`contentRect.height` vertical) with one `ResizeObserver`. Compute normal scale
`min(1, available / naturalNormal)`. If it is at least `MIN_SCALE`, use normal
constants. Otherwise recompute using compact constants. If compact scale is at
least `MIN_SCALE`, use compact constants and that scale. Otherwise clamp visual
scale to `MIN_SCALE` and set mode `scroll`, with overflow only inside the
timeline viewport. This guarantees ten cards remain contained where geometry
allows and gives a deliberate contained fallback instead of overlap/omission.

Set stage inline size to `natural * scale` and stage block size to
`cardBlock * scale`; set the visual's unscaled inline/block size to the natural
values and `transform: scale(scale)` with `transform-origin:center`. This
reservation is important: an unscaled stage combined with a transform would
leave excess layout space, while a transformed child without a scaled wrapper
could escape its zone.

Gap buttons are absolutely layered over each logical gap. Each has a minimum
44x44 hit box in screen CSS pixels; do **not** scale the hit layer. Compute each
gap's visual center from the scaled geometry and position the 44px button there.
Clamp its center to `[22, viewportInline - 22]`, ensuring the first and last gap
are reachable. In scroll mode the hit layer shares the scrollable content width,
so all gaps can be reached by scrolling. Vertical mode swaps inline/block axes;
card contents remain upright. A selected mystery ghost or token marker appears
inside the relevant gap but uses `pointer-events:none`.

Timeline cards use `TimelineCard.year` as the authoritative visible year, not
the manifest's year. `SongCard` receives explicit `year`. Add an accessible
label/title from `describeSong`; if the manifest entry is missing, show the year
and label it with the song id plus `unknown song details`. Board cards must not
render title/artist visibly because those fields consume the fixed lane.

`describeSlot` should gain a compact/year-based mode or a separate
`describeTimelineGap(timeline, position)` that returns `Start timeline`,
`Before 1977`, `Between 1990 and 2006`, or `After 2019`. Claimed labels append
`Claimed by Alice; unavailable`. This avoids exposing more metadata than needed
and keeps names understandable.

## 5. Selection, drag, touch, and keyboard model

### 5.1 Local state and reducer

Use one discriminated local selection in `GameBoard`, reset by the round song id
as the existing keyed panels are today:

```ts
type PlacementSelection =
  | { kind: "idle" }
  | { kind: "picked"; source: "card" | "token"; over: number | null }
  | { kind: "selected"; source: "card" | "token"; position: number };

type SelectionEvent =
  | { type: "PICK_UP"; source: "card" | "token" }
  | { type: "MOVE_OVER"; position: number | null }
  | { type: "DROP"; position: number }
  | { type: "SELECT"; source: "card" | "token"; position: number }
  | { type: "CANCEL" };
```

Export a pure reducer plus `reconcileSelection(selection, legalPositions)`.
Polling invokes reconciliation during render derivation or an effect. If a
selected steal position becomes claimed remotely, dispatch cancel, put focus
back on the token source, and announce `That gap was claimed by another player;
choose another gap or pass.` Never decrement a token locally. A rejected server
request leaves the position selected/editable and displays the existing action
error. A successful request naturally changes phase/vote state and clears or
disables local selection.

Add `placementPending`/`votePending` (or one action-pending discriminator) around
the awaited `act` calls. Disable repeated confirm/pass while pending. Confirmation
is the only point that sends:

- card selection -> `{ type: "CONFIRM_PLACEMENT", position }`;
- token selection -> `{ type: "STEAL_ATTEMPT", position }`;
- pass button -> `{ type: "PASS" }`.

Direct gap click/tap dispatches the same `SELECT` event as a drop. It does not
send an action.

### 5.2 Pointer Events

`usePointerPlacement` receives `{ enabled, source, legalPositions, dispatch,
announce }` and returns source handlers plus drag-preview state. On primary
`pointerdown`, remember id/origin and call `setPointerCapture`; do not start a
drag until movement exceeds 6 CSS px. Once exceeded, dispatch `PICK_UP`, add the
lifted preview, and suppress the subsequent click. On `pointermove`, use
`document.elementFromPoint(clientX, clientY)?.closest('[data-gap-position]')`
to find a legal enabled gap and dispatch `MOVE_OVER`. On `pointerup`, dispatch
`DROP` only for a legal current target; otherwise cancel. Handle
`pointercancel`, lost capture, Escape, phase/song change, and component unmount.

Give only the draggable handle `touch-action:none`; timeline/table scrolling
keeps `touch-action:pan-x pan-y`. Do not register global `preventDefault` or
intercept events from the audio range. Source click/keyboard toggles picked state
without requiring pointer movement. Show one fixed-position, `aria-hidden`
drag preview; the timeline shows its exact insertion ghost.

### 5.3 Keyboard and announcements

Source buttons have names `Pick up mystery card` and `Pick up one of your N
tokens`. Space/Enter picks up. Legal gaps are real buttons with the human label.
While picked, Left/Right moves a roving gap focus for horizontal lanes and
Up/Down for vertical lanes, wrapping only among legal gaps; Home/End choose the
first/last legal gap. Space/Enter selects the focused gap. Escape cancels from
the source, gap, or board action tray. Tab order may also reach every legal gap.

Keep one visually-hidden `aria-live="polite"` node in `GameBoard`; update it
only for explicit interaction/phase transitions, not every poll object. Announce
pickup, focused gap, selected gap, cancel, remote invalidation, request failure,
and confirmation. The visible action tray repeats the selected gap description
beside `Confirm placement` or `Confirm steal · costs 1 token`.

## 6. Central card, reveal, and audio

### 6.1 No-spoiler data flow

`MysteryCard` props must make accidental leakage difficult:

```ts
type MysteryCardProps =
  | { side: "front"; songId: string; audio: AudioControlProps; draggable: boolean }
  | { side: "back"; songId: string; song: SongManifestEntry | undefined;
      correctYear: number; tone: "correct" | "incorrect" };
```

Do not look up or pass a manifest entry in the `front` branch. Its DOM, title,
ARIA label, and data attributes contain only `Mystery song card`; `songId` is
used only for the audio URL/key and should not be copied into visible attributes.
The answer uses `phase.correctYear` as authoritative and manifest title/artist;
if missing, show `Unknown title`, `Unknown artist`, the correct year, and a
readable id fallback.

`.flip-card` always renders only the allowed side's semantic content. A wrapper
can use `data-revealed` and `rotateY(180deg)` for state-driven presentation, but
do not keep answer text mounted behind the front before reveal. This deliberately
chooses spoiler safety over a literal two-face DOM. On direct mount in reveal it
immediately shows the answer. With reduced motion, remove transform transitions
and swap/crossfade immediately. On a normal `pendingReveal -> reveal` state
change, use the wrapper's class transition; no timer changes state.

In reveal, display the active player's pre-insertion target timeline. Derive it
as `players[activeId].timeline`, removing `phase.songId` only if the active player
won it; if a stealer won, the active timeline is already unchanged. Never use
the stealer's timeline as the target just because it now contains the card.
Build claim markers from active placement plus non-null votes and mark each with
check/`Correct` or cross/`Incorrect` using the inclusive
`correctPositionRange`. Highlight every gap from `low` through `high`, including
unclaimed valid tie positions.

Keep the optional guess draft/locked guess keyed by `songId`; preserve it across
`pendingReveal -> reveal`. Keep current self-judgment and Next-turn gating. Place
the form and result text in an action tray adjacent to/below the center card,
not in a separate duplicate timeline panel.

### 6.2 One audio element per client

Replace the current active native-control element plus follower real/visual
pair with one real `<audio ref={audioRef}>` for every non-game-over client and a
custom `AudioControls` face. Set `muted={muted}` for active and follower alike.
Lifting mute to `App` lets `AppHeader` render a persistent button with
`aria-pressed`, label `Mute this device`/`Unmute this device`, and status text
`Muted on this device`. Toggling it sends no game action.

Preserve the existing event and reconciliation semantics:

- `src=/api/audio/${playback.songId}`, `preload="auto"`;
- on metadata/song load, set `currentTime` to
  `currentPlaybackPositionSec(playback)` and play best-effort if server state is
  playing; suppress that programmatic seek event;
- on each state snapshot, followers correct drift only when over one second and
  mirror server play/pause, retaining caught autoplay failures as a non-crashing
  local status/console message;
- only the active player in `playingSong` can invoke PLAY/PAUSE/SEEK;
- custom Play/Pause reads server state while a request is pending, and uses the
  existing `mirror` request path;
- range is `type="range"`, min 0, max finite audio duration, step 0.1, with a
  label and elapsed/duration text. Followers receive `disabled` plus readable
  progress. Maintain a local displayed position from `timeupdate` (or a
  requestAnimationFrame only while playing), resetting by song id;
- seeking pauses the element, sends SEEK, locks the transport for exactly
  `POLL_INTERVAL_MS`, and resumes with PLAY only when playback was running before
  the seek. Clear the timer on song change/unmount. Avoid sending PAUSE from the
  programmatic pause used by seek/follower reconciliation;
- retain `loading`, `buffering`, `playing`, `paused`, `syncing`, and catch-up
  labels. Scrubbing is independent of card dragging.

The audio component remains mounted during playing, steal, pending reveal, and
reveal, keyed only by `playback.songId`, so the flip cannot stop playback.
`NEXT_TURN` supplies a new playback id/state; reset the front face/progress and
honor server paused-at-zero state. Render no audio at game over, matching the
current protocol requirement. Retain `GameBoard`'s `nextSongId` prefetch effect.

## 7. Player zones, tokens, and action presentation

`PlayerZone` suggested props:

```ts
interface PlayerZoneProps {
  player: PlayerState;
  host: boolean;
  viewer: boolean;
  active: boolean;
  winner: boolean;
  orientation: "horizontal" | "vertical";
  emphasis: ZoneEmphasis;
  voteStatus?: string;
  winTarget: number;
  timelineMode: TimelineMode;
  draggableToken: boolean;
  timelineInteraction?: TimelineInteraction;
}
```

The plate shows full name through `title`/accessible name while visually
ellipsizing it, Host/You/On turn/action/vote state, and
`${timeline.length} / ${winTarget}`. Exact token count is visually and
accessibly stated.

`TokenPile` renders `min(tokens, 6)` decorative discs, each with deterministic
index classes or `--token-index` offsets/rotation behind the plate/timeline.
When `tokens > 6`, add `+${tokens - 6}` on the top disc or an adjacent badge,
while accessible text says the exact count. Zero displays an empty outlined
token tray plus `0 tokens`. During eligible stealing, only the top disc is a
button/drag source; the others and pseudo-rings are `aria-hidden`. A selected
token remains visually in the pile until server confirmation, with a ghost at
the gap, because cost is server-authoritative.

The slim HUD order is brand, room code, concise turn badge, connection hiccup,
local mute, and leave. The current instruction is a sticky/readable strip just
above the tabletop and must not dim. Action errors sit beside the action tray
with `role="alert"`; do not clear them on unrelated polls.

Move the event log below/outside the tabletop in its existing collapsible
component. On wide screens it may be a narrow drawer/side rail, but it must not
reduce the fixed table geometry enough to violate the seat map. Prefer a full
width table and a below-table disclosure to the current 320px scoreboard
sidebar. Remove `PlayerSummary`; every fact it contains now lives in zones.

## 8. CSS and responsive strategy

Replace the purple dashboard feel for the in-game subtree only. Add semantic
tokens such as `--felt`, `--felt-deep`, `--rail`, `--paper`, `--ink`, `--coral`,
and `--gold`, retaining existing success/danger and generic surface variables
for home/lobby/errors. The table uses layered radial/linear gradients, inset
rail shadow, and rounded corners. The draw stack uses `::before`/`::after` card
backs at fixed offsets and slight rotations. Timeline rotation variants use
deterministic `:nth-child(4n + k)` transforms and are disabled while scaled very
small, dragging, or reduced-motion. Use tabular numerals for years/times.

Wide mode applies when both `min-width:900px` and a usable landscape area are
available. The table is entirely visible and bounded by the app shell. For
portrait/narrow mode, use a `.tabletop-scrollport` no wider than the viewport,
with `overflow:auto`, a square internal `.tabletop` of `min-width:760px;
min-height:760px`, sticky instruction/action tray outside it, and visible text
`Drag or scroll the table to see every player`. On initial render, scroll the
viewer/bottom and center into view only if needed; do not fight later user
scrolling. The center/action tray, viewer token source, and active target must be
reachable without page-wide overflow because overflow belongs to the contained
scrollport. If practical, duplicate no controls; use sticky action tray outside
the scrollport.

At `320x568`, reduce HUD label text but keep room, mute, and leave as 44px
controls; allow HUD wrapping. At 200% zoom, media queries should naturally enter
contained/fallback mode. Use `max-inline-size:100%`, `min-width:0`, and
overflow containment on every lane. The page/body must never horizontally
scroll.

Global interactive rules: 44px minimum targets, a high-contrast 3px
`:focus-visible` ring with offset, and disabled styling that stays legible.
Under `prefers-reduced-motion:reduce`, set transition/animation duration to zero
for flip, glow, lift, card rotation, and event-log chevron; pointer preview
tracks without easing. Under `prefers-contrast:more`, strengthen rail/card/gap
borders, remove felt overlays behind text, and avoid translucency. Maintain the
current dark color-scheme behavior with explicit dark felt/paper/ink values.

## 9. Phase composition

- `playingSong`: front card/audio at center. Active viewer gets draggable card,
  legal own-timeline gaps, selected ghost, and confirm. Others get disabled
  controls/gaps and waiting text.
- `stealWindow`: center remains front/audio. Active placement marker is fixed on
  active timeline. Each eligible viewer independently gets a draggable own
  token, only unclaimed target gaps, confirm-cost and Pass. Active viewer watches
  vote status updates. No current-voter concept is rendered.
- `pendingReveal`: front/audio remains; all gaps locked. Active viewer sees the
  optional private guess field and Reveal. Others wait.
- `reveal`: answer face replaces front semantic content while the same audio
  element stays mounted. Active target timeline shows all claims, valid tie
  range, icons/text, outcome, guess judgment, and gated Next turn.
- `gameOver`: final table/list remains with winner emphasized, final timelines,
  room/leave/log. Center becomes the winner announcement and there is no audio
  or invented restart.

## 10. Automated tests

Add root tests, following the existing import-by-relative-path pattern:

- `tests/boardModel.test.ts`: rotation for each possible viewer, stale viewer
  fallback, stable clockwise order, no input mutation, exact seat name/anchor/
  orientation for counts 2–6, and list fallback outside that range.
- `tests/boardInteraction.test.ts` (or same file): phase-by-phase permission
  matrix for active/non-active/stale viewer, unordered voting, already-voted and
  no-token behavior, claimed set containing active placement and non-null votes,
  emphasis exception, inclusive reveal range, and active-target reveal timeline
  reconstruction for active win/steal/discard.
- `tests/placementSelection.test.ts`: reducer pickup/hover/drop/direct select/
  cancel, invalid drop, and `reconcileSelection` cancel when a remote claim
  removes legality. Verify no reducer event implies a `GameAction`; action
  mapping occurs only in confirm helper.
- extend `tests/songText.test.ts`: compact gap names, empty timeline, duplicate
  years, boundary gaps, missing manifest/id fallback.
- timeline-scale pure calculation tests: 0, 1, and 10 cards; normal, compact,
  and scroll modes; scale never over 1 or under 0.42; 11 gaps retained.

Do not make unit tests fetch media, require cookies, or depend on browser audio.
DOM Pointer Events, native audio autoplay, responsive geometry, CSS overlap, and
screen-reader flow belong to browser QA because the repository currently has no
DOM test environment. Do not add jsdom solely for this overhaul.

Run the narrow tests while iterating, then `make check`. The implementation
handoff must record commands/results and any browser-only gaps for review/QA.

## 11. Staged implementation checklist

1. Add and test `boardModel.ts`: viewer rotation, exact seat map, permission/
   emphasis derivations, claimed gaps, reveal target, selection reducer, and
   scale calculation.
2. Refactor mute ownership from `GameBoard` to `App`; add the always-reachable
   device-local HUD control. Confirm no mute click sends an action.
3. Build unified `AudioControls` around one real audio element while copying the
   current reconciliation, loading feedback, drift threshold, seek lock/timer,
   autoplay catch, and prefetch behavior. Verify active audio is now muted by
   the local preference.
4. Extend `SongCard`/`SongTimeline` with year-only cards, orientation, measured
   fixed scaling, unscaled 44px gap hit layer, ghosts/claims/results, and compact
   accessible names. Keep the existing read-only path.
5. Implement the selection reducer integration and `usePointerPlacement` for
   card and token sources, then keyboard focus movement/live announcements.
   Ensure drop selects only and explicit confirm sends the existing action.
6. Build `PlayerZone`, `TokenPile`, `MysteryCard`, and `TabletopBoard`; replace
   `PlayerSummary` and duplicate placement/steal/read-only panels in
   `GameBoard`. Preserve guess/claim/Next gating and error handling.
7. Add the state-driven reveal face/result overlays, including all tie-valid
   gaps and active-target pre-insertion timeline. Verify audio component identity
   survives the flip.
8. Add tabletop visual tokens, seat CSS, dimming veil, narrow contained
   scrollport, list fallback, dark/high-contrast/reduced-motion styles, and
   restyle home/lobby only where needed for coherence.
9. Run all new unit tests, `make lint`, `make build`, and `make check`. Address
   TypeScript exhaustive branches and lint warnings without changing rules.
10. Hand to review with a behavior-preservation checklist, then browser QA at
    all required viewports/zoom levels and at least two real multi-client rounds.

## 12. Risks and required safeguards

- **Audio regressions are highest risk.** Refactor by moving the current event
  logic nearly verbatim before restyling. Programmatic pause/seek must not emit
  server actions accidentally. Verify timers clear on song/turn changes.
- **Spoilers through hidden flip content.** Never mount/pass answer metadata on
  the front, even with CSS backface hiding. Audit DOM/accessibility attributes
  before reveal.
- **Poll race after local steal selection.** Reconcile against every new claimed
  set and retain server rejection errors. Never optimistically spend a token or
  mark a vote submitted.
- **React remount stopping audio.** Key the audio only by song id, not phase,
  selection, active status, or reveal side. Keep it outside conditional face
  subtrees.
- **Absolute-position reading order.** Maintain the explicit unique DOM order
  described above and test keyboard navigation manually; CSS seat position must
  not determine semantics.
- **Scaled visuals shrinking hit areas.** Gap buttons live in a separate
  unscaled hit layer and are clamped at edges. Inspect all eleven targets for a
  ten-card lane.
- **Touch drag fighting scroll.** Disable touch panning only on the current
  draggable source and use a movement threshold. The table and timeline remain
  normally scrollable elsewhere.
- **Long names/counts and malformed rooms.** Truncate only visually, expose full
  accessible text, cap only decorative discs, and enter list fallback outside
  2–6 rather than dropping data.
- **UI accidentally inventing authority.** Every enabled state must come from
  `deriveBoardInteraction`; the server still validates all actions. No visual
  selection is described as confirmed until it appears in server state.
- **Large CSS replacement breaking lobby/home.** Scope tabletop rules under
  `.game-board`/`.tabletop`; preserve generic `.card`, `.field`, `.btn`, badge,
  and error styles or update their existing consumers together.

Completion means all acceptance criteria in `01-requirements.md` are accounted
for by this component/state/CSS design, application behavior remains unchanged,
and the subsequent implementation agent can follow the checklist without making
new product or protocol decisions.
