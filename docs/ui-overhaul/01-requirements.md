# Tabletop UI overhaul: implementation requirements

## 1. Objective and scope

Replace the in-game page's dashboard/panel presentation with one shared tabletop board presentation. Every seated client must see the same complete game information: a central draw-card area and all players arranged around it, each with a fixed timeline lane, name/status, and a physical-looking pile of tokens. The viewer's own seat may be rotated to the bottom of their screen for orientation, but player order and game facts must remain identical.

This is a client-side experience and presentation change. It must not change game rules, server authorization, action ordering, protocol shapes, song selection, scoring, room behavior, audio synchronization, persistence, or network endpoints. Home, lobby, error, loading, and game-over screens may be visually restyled to match, but their fields and actions remain the same.

Supported game-board population is 2 through 6 players. This requirement means the layout must be visually sound for each count; it does **not** authorize adding a six-player room limit, because the API currently accepts any number of lobby joins. If an existing or hand-crafted room has more than six players, render a usable compact/scroll fallback instead of hiding players or changing the server.

No bitmap or generated image asset is required. Cards, table felt, shadows, token piles, markers, and the draw pile must be made from semantic HTML and CSS (including pseudo-elements and gradients). Existing SVG icon components may be reused.

## 2. Existing contract that must be preserved

The following behavior is server-authoritative or otherwise existing functionality, and is non-negotiable for this UI-only work.

- `GameState` continues to arrive by one-second polling and immediately after actions. Do not introduce client-to-client state, WebSockets, optimistic game-rule mutation, or alternate action payloads.
- `players` is keyed by `PlayerId`; the stable clockwise seat order after game start is `turnOrder`. The active player remains `turnOrder[currentTurnIndex]` as returned by `currentPlayerId`.
- A room starts with at least two players. Starting shuffles turn order, deals one known timeline card and two tokens to each player, loads the active song paused at 0, and reserves/prefetches the next song.
- A timeline is sorted by ascending year. A legal insertion gap is an integer from `0` through `timeline.length`, inclusive.
- `playingSong`: only the active player may send `PLAY`, `PAUSE`, `SEEK`, and `CONFIRM_PLACEMENT`.
- `stealWindow`: every non-active player independently submits exactly one `STEAL_ATTEMPT` or `PASS`. Votes are not sequential turns and can arrive in any order. The active player cannot vote. A steal attempt spends one token immediately whether correct or wrong. The active placement and previously claimed steal positions are unavailable to later voters. A rejected race must show the existing action error and must not appear confirmed.
- `pendingReveal`: all non-active players have voted; only the active player sends `REVEAL`. Their optional title/artist guess remains private client state and must stay available through the pending-reveal-to-reveal transition.
- `reveal`: use `correctPositionRange` inclusively, including all valid positions around equal-year ties. Preserve `activePlacementCorrect`, the first correct steal in submission order as `stolenBy`, discard when nobody wins, and the active player's one optional `CLAIM_GUESS_TOKEN`. Only the active player can send `NEXT_TURN`.
- `gameOver`: the server-provided winner is shown and playback is absent. No rematch/restart action is to be invented.
- `PlaybackState` stays shared/server-authoritative: only the active player controls playback; other devices follow `isPlaying`, `positionSec`, and `updatedAt`, correcting meaningful drift. A seek still freezes, waits one poll interval, and resumes only if playback was running. The next track starts paused and silent until its active player presses play. The current track continues playing through placement, voting, pending reveal, and reveal, and stops/changes only under existing actions (not merely because the card flips).
- Audio prefetch, local loading/buffering status, autoplay failure handling, action error handling, stale-seat fallback, connection-hiccup warning, manifest error, room/name storage, and leave-room behavior must remain.
- The current mute preference is deliberately local (`hipster-muted` in local storage) and is not represented by `GameState` or `GameAction`. Therefore the new prominent mute control must mute **this device's output** for any player without pausing or seeking shared playback. Label it unambiguously (for example, `Mute this device`). A truly room-wide mute would require a protocol/server feature and is out of scope. The active player's audio element must also honor the local mute preference, fixing the present asymmetry without changing shared game state.
- Timeline card metadata is resolved from `manifest.json`; missing entries must retain a readable song-id/unknown fallback rather than crash.
- Preserve room code, host, “you,” turn/vote status, token counts, win target progress, event log content, and all existing actions, even when their presentation moves into the board or a secondary disclosure.

## 3. Board model and seating

### 3.1 Coordinate system

Use one `.tabletop` element with `position: relative`, a bounded aspect ratio, and a CSS grid/absolute seat map. It contains a centered `.draw-stack` and one `.player-zone` per player. A player zone owns its whole fixed rectangle; timelines never participate in page-wide intrinsic sizing.

Rotate the ordered player list client-side so the viewer is index zero. Place index zero in the bottom seat and continue clockwise. This makes each phone feel like that player's physical side of the table while retaining the same clockwise `turnOrder`. Spectator/stale viewer fallback starts with `turnOrder[0]`. Do not rotate or mutate the actual state array.

Seat anchors, expressed as percentages of the tabletop box, are:

| Count | Viewer/bottom | Remaining seats clockwise |
| --- | --- | --- |
| 2 | `(50, 86)` | `(50, 14)` |
| 3 | `(50, 86)` | `(85, 30)`, `(15, 30)` |
| 4 | `(50, 86)` | `(86, 50)`, `(50, 14)`, `(14, 50)` |
| 5 | `(50, 87)` | `(85, 69)`, `(75, 18)`, `(25, 18)`, `(15, 69)` |
| 6 | `(50, 88)` | `(84, 72)`, `(84, 28)`, `(50, 12)`, `(16, 28)`, `(16, 72)` |

Implementation may use equivalent named CSS grid areas rather than literal coordinates. The invariant is symmetry, no overlap between zones and the center, and consistent clockwise order. Top and bottom timelines use a horizontal lane. Left/right and strongly lateral seats use a vertical lane, with card text kept upright. Diagonal seats may use whichever lane orientation fits their reserved box, but never rotate readable text upside down.

The draw stack owns roughly the central 24% width and 32% height. Each seat owns a non-overlapping lane no wider than roughly 34% of the table and no taller than 24%. Use `z-index` only for intentional token/card stacking, not to conceal collisions.

### 3.2 Timeline capacity and scaling

Every player timeline must remain inside its player zone at all times. Do not solve growth with overlap or by allowing one lane to push another seat. The normal 2–6 player board must support at least the server win target of 10 visible cards.

Render compact, year-forward timeline cards in the board: year is the primary face, with title/artist available via accessible name/title or a detail affordance rather than consuming lane space. Compute a per-timeline scale from the reserved lane's measured inline size and the number of cards/gaps. A valid approach is a `ResizeObserver` that sets `--timeline-scale = min(1, availableInlineSize / naturalInlineSize)`, with natural card width, gap width, and count included. Transform from the lane center and reserve the unscaled geometry so visual scaling cannot alter surrounding layout. Clamp card scale to a readable floor of approximately `0.42`; below it, use tighter card/gap constants, then a contained lane scroller as the final fallback. Do not silently omit, wrap, or overlap cards.

All gap targets remain at least 44 by 44 CSS pixels even when the visible cards shrink. The hit targets may overlay the lane without changing its visual spacing. First and last gaps must be fully reachable. Vertical timelines remain chronological from the start/end labels defined by their arrows; horizontal timelines read earliest-to-latest left-to-right on bottom/top seats for screen readability.

## 4. Visual language (HTML/CSS)

The scene should resemble a warm physical music game rather than an application dashboard:

- `.tabletop`: deep green/teal felt made with layered radial/linear gradients, subtle inset edge shadow, rounded outer rail, and a warm off-white page surround. Dark mode may deepen these values but must retain contrast.
- `.draw-stack`: a stack of three rounded rectangles. Two CSS pseudo-element backs are offset 4–8px and slightly rotated. The live card sits above them. Use paper cream, ink navy/charcoal, warm coral/orange accent, and restrained gold for turn/token highlights.
- `.mystery-card`: unrevealed front contains no title, artist, year, manifest identifier, image, or tooltip that could spoil the song. It shows a musical mark, a large play/pause button, an elapsed/duration rail, and buffering/sync state. The native audio element may remain the engine but the visible controls should be an accessible custom face backed by existing actions.
- `.flip-card`: a perspective wrapper with front/back faces and `backface-visibility: hidden`. During `reveal`, transition the live center card around the Y axis to its answer face containing title, artist, and prominent year. The revealed card remains centered while existing placement/correctness overlays explain its destination. Use state-driven classes, not an animation timer, as truth.
- `.timeline-card`: small cream paper cards with rounded corners, dark border, slight randomized-looking rotation via deterministic CSS variants (`nth-child` only), and year centered in tabular numerals. No random JS values, to avoid layout churn between polls.
- `.token-pile`: one visible HTML token per actual token when counts are modest, positioned behind the player's timeline/name plate with deterministic offsets and rotations. For large counts, cap decorative discs (for example at six) and add a numeric badge that exposes the exact count. Each token is a circular button/div with a gold/amber radial gradient, double-ring border, coin shadow, and star/music glyph via text or existing SVG. Never represent a positive balance with count text alone.
- Player identity is a small name plate integrated with the zone, containing name, `You`, host crown, timeline progress (`n / winTarget`), and vote state when relevant. Truncate very long names visually and expose the full name in the accessible label/title.
- The event log and less-frequent diagnostics should live in a collapsible/drawer-like secondary area outside the physical play surface so they remain available without competing with the board. Room code, leave, connection status, local mute, and concise instruction stay in a slim persistent HUD.
- Correctness uses icon/text plus color: green/check for correct, red/cross for incorrect, and distinct neutral/claimed markers. Never rely on color alone.

Avoid stock dashboard grids inside the game board, photorealistic assets, excessive glass effects, or decorative motion unrelated to state.

## 5. Turn emphasis and phase presentation

Base rule: the active player's full zone (name, timeline, tokens) and center draw card render at normal opacity with an accent ring/glow. Other player zones use approximately `opacity: 0.42–0.58`, reduced saturation, and no shadow emphasis. Do not dim the global mute, leave control, current instruction, errors, or dialogs.

Exception for actionable voting: the existing protocol has no sequential “current voter.” During `stealWindow`, on a non-active viewer who has not voted, keep both that viewer's token pile and the active target timeline at full emphasis; dim other non-active zones. After that viewer votes, return them to spectator dimming. This accurately indicates who can act without inventing an order. On the active player's client, keep the active zone highlighted while votes arrive.

Phase requirements:

- `playingSong`: center card shows its mystery/audio face. Active viewer sees their draggable card and active timeline gaps; other viewers see the same board read-only and a waiting instruction.
- `stealWindow`: the active placement marker remains on the active player's timeline. Eligible non-active viewers see one draggable token from their own pile and open gaps on the active timeline. Submitted placements show a labeled claim marker; passes show on that player's plate. The active player watches all status changes.
- `pendingReveal`: placements are locked and read-only. The active viewer gets the optional title/artist field plus a prominent Reveal action; others see that reveal is awaited.
- `reveal`: flip the center card to the answer face without pausing audio. Animate the valid gap range and actual claims, showing correct/incorrect icons and the textual outcome. Retain the bonus-token self-judgment flow and Next turn gating exactly.
- `gameOver`: keep the tabletop with all final timelines visible where practical, elevate the winner zone, show the winner announcement, and retain event log/leave. No new game action.

## 6. Drag-and-drop interaction

Drag/drop is the primary pointer interaction, but selection and server commitment remain separate.

### Active placement

1. In `playingSong`, the active player presses/drags the top mystery card from the center stack. A lifted shadow and slight scale indicate pickup; legal gaps in their own timeline expand/highlight.
2. While crossing a gap, show a ghost-card preview at that exact insertion index. Do not expose answer metadata.
3. Dropping selects the gap locally and returns/parks a mystery-card ghost there. It does **not** send an action yet.
4. A persistent `Confirm placement` button sends the existing `{ type: "CONFIRM_PLACEMENT", position }`. The card can be re-dragged before confirmation. Pending state prevents duplicate submits. Rejection restores an editable selected state and shows the action error.

### Steal placement

1. During `stealWindow`, an eligible viewer with at least one token drags the top token from their own pile to an unclaimed gap in the active player's timeline.
2. A dropped token selects locally and shows the viewer's coin marker. It does not decrement the decorative pile or send an action yet.
3. `Confirm steal · costs 1 token` sends existing `STEAL_ATTEMPT`. The adjacent `Pass` sends existing `PASS` and never requires dragging.
4. Claimed gaps, the active placement, no-token states, active player, already-voted player, and non-voting phases are non-droppable. If polling claims a selected gap before confirmation, cancel the selection, announce why, and require a new choice/pass.

Use Pointer Events (or an established lightweight accessible drag utility already compatible with the project), not desktop-only native HTML Drag and Drop. It must support mouse, pen, and one-finger touch, pointer capture/cancel, scrolling outside draggable regions, and no accidental action while scrubbing audio. Do not add a large dependency merely for animation.

### Equivalent non-drag paths

- Every gap is a real focusable button while legal. Clicking/tapping the source then a gap, or directly activating a gap, selects the same position through the same state reducer/handler as dragging.
- Keyboard: focus source, press Space/Enter to pick up, arrow/tab between legal gaps, Space/Enter to drop/select, Escape to cancel, then focus Confirm. Announce pickup, current gap description, drop, cancellation, remote claim, and confirmation through an `aria-live="polite"` region.
- Gap accessible names use human descriptions such as “before 1977,” “between 1990 and 2006,” and “after 2019,” not only slot numbers. Claimed labels include claimant and availability.
- Dragging is never the only path to `CONFIRM_PLACEMENT` or `STEAL_ATTEMPT`; Pass, Reveal, token claim judgment, Next turn, playback, mute, and leave remain ordinary buttons.

## 7. Audio face, reveal face, and mute

Expose one visually consistent audio face to every viewer. The active viewer can play/pause and scrub; followers see the same progress and state but the transport is disabled/read-only except for local mute. Reuse the existing server actions and follower reconciliation logic.

The custom progress rail must expose `role="slider"` semantics (or use an actual range input) with elapsed/duration text. Only the active viewer can change it. A seek must preserve the existing freeze/synchronize behavior. Loading, buffering, syncing, and catch-up lock must be visible near the control. Autoplay refusal must not make the board crash; retain the current best-effort follower behavior.

On `pendingReveal`, the front stays mystery-side. On receipt of `reveal`, it flips once to information-side. It must already be on the correct side when mounted/refreshed directly in reveal state; animation is enhancement, state is truth. Song audio continues according to `PlaybackState`. On `NEXT_TURN`, the next song card returns to front, progress resets according to state, and remains paused until Play.

The mute control is always reachable in the HUD and applies to the local audible element for active and follower clients. It must expose pressed state (`aria-pressed`) and distinguish `Muted on this device` from shared `Paused`. Muting never sends `PAUSE` and never modifies the progress shown to other clients.

## 8. Responsive behavior

Desktop/tablet landscape (recommended shared-table view, roughly 900px and wider): show the full oval/circular board with all 2–6 zones and center stack at once.

Portrait tablet/phone: preserve the tabletop mental model, but prioritize operability. Use a square/minimum-size table inside a two-axis contained viewport with a clearly visible “drag/scroll the table” affordance, or a compact radial seat map with the active target and viewer lanes expanded. The center card, current instruction, mute, own token source, target timeline, and confirm/pass action must be simultaneously reachable without page-wide horizontal overflow. Non-target player zones may collapse to name/token/progress plates that expand on activation; no player or game fact may disappear entirely.

For fewer than two or more than six players in malformed/legacy state, fall back to an ordered vertical board list with the center controls sticky. Do not overlap, throw, or silently truncate.

Test at minimum: 320×568, 390×844, 768×1024 (both orientations), 1024×768, 1280×720, and 1440×900, at 100% and 200% browser zoom. At 200%, reflow is allowed; functionality and reading order must remain.

## 9. Accessibility and motion

- Use semantic buttons, labels, headings, lists, and landmarks. The tabletop visual order may be absolute/grid positioned; DOM order must remain HUD, instruction, center card/actions, viewer/active target, remaining players, event log.
- All interactive targets are at least 44×44 CSS pixels with visible `:focus-visible` styling. Do not remove outlines without an equivalent.
- Meet WCAG 2.2 AA contrast for text and controls, including dimmed zones. If opacity would make text fail, dim a background overlay/de-emphasize shadow instead of lowering text contrast.
- Status is not encoded solely by dimming, position, motion, or color. Include `On turn`, `Your action`, `Passed`, `Vote submitted`, `Correct`, and `Incorrect` text/icons where applicable.
- Use `aria-live` for phase/action changes and errors without repeatedly announcing unchanged one-second poll snapshots.
- Honor `prefers-reduced-motion: reduce`: remove card rotations/lift travel, replace flip with an immediate crossfade or face switch, and eliminate pulsing glows. Drag preview may follow the pointer without easing.
- Honor `prefers-contrast: more` where practical and retain current light/dark adaptability. Decorative token/card backs are `aria-hidden`; exact token/card counts remain in accessible text.
- No answer-side title, artist, or year may exist in accessible DOM, tooltip, label, or inspectable visible attribute before reveal, except already-known years in existing timeline cards.

## 10. Acceptance criteria

1. For seeded states with 2, 3, 4, 5, and 6 players, all players, timelines, exact token counts, the center stack, and the active player are visible in a symmetrical tabletop layout without zone overlap at desktop/tablet-landscape sizes.
2. A ten-card timeline remains within its reserved zone; cards never cover another player's zone or the draw stack. All eleven insertion gaps remain reachable with 44px targets. Smaller screens use the specified contained fallback rather than clipping actions.
3. Every client renders the whole board using the same components and facts. Viewer-relative rotation places that viewer at the bottom while maintaining clockwise `turnOrder`.
4. In `playingSong`, only the active viewer can control playback and place. Dragging the mystery card or using click/keyboard fallback selects any legal gap; only Confirm emits `CONFIRM_PLACEMENT` with the same integer.
5. In `stealWindow`, each eligible non-active viewer can drag exactly one of their tokens, or use the fallback, to an unclaimed active-timeline gap and explicitly confirm; only confirmation emits `STEAL_ATTEMPT`. The token cost, exclusivity, unordered voting, and Pass behavior match the current server.
6. Poll-driven remote claims update within existing cadence. A race rejection displays an error and does not visually pretend the vote succeeded.
7. Active/eligible zones are plainly emphasized and spectators de-emphasized, with textual status. The design does not invent a sequential voter turn.
8. Before reveal, the center card exposes no answer metadata. `REVEAL` flips it to title, artist, and year; tie-valid gaps and all placement results are marked with color plus icon/text.
9. Playing audio remains playing through the flip. `NEXT_TURN` loads the next front face paused. Play/pause/seek synchronization and seek catch-up behavior remain covered by existing tests/manual verification.
10. A local mute button works for active and non-active viewers, persists through local storage, never sends a shared playback action, and is clearly described as device-local.
11. Optional title/artist guess, one-time bonus claim, reveal gating, win detection/presentation, room/lobby actions, event log, connection/error states, and leave behavior remain available and correct.
12. Mouse, touch, and keyboard can complete a placement and a steal. Screen-reader labels describe source, target gaps, state, and outcome. Reduced-motion mode does not perform the 3D flip.
13. No API/shared-protocol modifications, new game actions, rule changes, generated image assets, manifest output, audio/cache output, or secrets are committed.
14. Automated tests cover deterministic seat rotation/placement, layout class selection for 2–6, gap selection/cancellation/claimed-state behavior, and phase permissions. Existing root tests remain green; `make check` passes.
15. Browser QA completes at least two full multi-player rounds (one correct placement and one steal/pass path), including reveal while audio runs, next-turn paused state, local mute on active/follower views, resize/zoom, keyboard-only interaction, and console/network error inspection.

## 11. Out-of-scope follow-ups

These requests would require functionality changes and must not be smuggled into this overhaul: a server-enforced six-player cap, sequential steal turns, a room-wide mute flag/action, WebSocket synchronization, reconnect/host migration, rematch, timeline rule changes, or new media/artwork. They may be proposed separately after this UI ships.
