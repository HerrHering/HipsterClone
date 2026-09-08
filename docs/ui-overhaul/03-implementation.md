# Tabletop UI overhaul: implementation handoff

## Outcome

The in-game dashboard has been replaced by a single shared physical-tabletop view. It renders all players in stable viewer-relative clockwise order, places the viewer at the bottom, supports fixed non-overlapping seat rectangles for two through six players, and switches to an ordered list layout for malformed/legacy counts. The center draw stack, card faces, felt, rail, timelines, markers, and token piles are HTML/CSS only.

No API, shared protocol, server rule, route, song-selection, room, scoring, or synchronization file was changed. The client still polls and sends only existing `GameAction` variants.

## Files changed

- `apps/web/src/App.tsx`: owns the persistent `hipster-muted` preference, keys the game board by round song so round-local UI resets without poll effects, and passes mute state into the game.
- `apps/web/src/AppHeader.tsx`: adds an always-reachable device-local mute/unmute button with `aria-pressed`. It sends no game action.
- `apps/web/src/game/boardModel.ts`: pure seat maps, viewer rotation, layout fallback, interaction permissions, emphasis, claimed gaps, reveal-target reconstruction, selection reducer/reconciliation, and timeline scale calculation.
- `apps/web/src/game/GameBoard.tsx`: new tabletop orchestration, action-pending/error handling, local selection and announcement state, reveal guess lifecycle, prefetch, player-zone ordering, action tray, and phase presentation.
- `apps/web/src/game/AudioControls.tsx`: one real audio element for active and follower clients, custom transport/progress UI, follower drift reconciliation, autoplay/loading/buffering feedback, device mute, and one-poll seek lock/resume behavior.
- `apps/web/src/game/MysteryCard.tsx`: spoiler-safe mystery face and reveal-only answer face. Answer metadata is not mounted or passed before reveal.
- `apps/web/src/game/PlayerZone.tsx`: fixed seat zone with identity/status/progress plate, timeline, and tokens.
- `apps/web/src/game/TokenPile.tsx`: deterministic CSS coin pile, exact accessible count, six-disc decorative cap, overflow badge, zero state, and optional token drag source.
- `apps/web/src/game/SongTimeline.tsx`: horizontal/vertical measured timeline, compact/scroll modes, unscaled 44px gap targets, keyboard traversal, selection ghosts, claims, reveal tones, and inclusive correct-range display.
- `apps/web/src/game/SongCard.tsx`: authoritative timeline-year and year-only card variant with readable missing-manifest fallback.
- `apps/web/src/game/songText.ts`: compact chronological gap descriptions and explicit unknown-details fallback.
- `apps/web/src/game/usePointerPlacement.ts`: Pointer Events drag threshold/capture/hit testing/drop/cancel and preview state shared by cards/tokens.
- `apps/web/src/game/useTimelineScale.ts`: one `ResizeObserver` per lane and pure geometry integration.
- `apps/web/src/index.css`: tabletop color tokens, felt/rail/card/coin visual language, seat geometry, emphasis veil, timeline geometry, reveal/motion, narrow contained scroll surface, list fallback, contrast, dark, and reduced-motion rules.
- `tests/boardModel.test.ts`: deterministic seating/layout, phase permissions, unordered votes/claims, reveal reconstruction, reducer reconciliation, and scale-mode coverage.
- `tests/songText.test.ts`: compact boundary/tie gap labels and clearer missing-song text.

## Behavior-preservation decisions

- Drag/drop only selects local state. `CONFIRM_PLACEMENT` and `STEAL_ATTEMPT` are emitted only by explicit confirm buttons; `PASS` remains an ordinary action.
- Tokens are not visually decremented and votes are not shown as submitted before the server snapshot confirms them. Poll-driven claimed-gap changes cancel a stale local selection, refocus its source, and announce the race.
- `deriveBoardInteraction` is the sole permission source. It preserves simultaneous/unordered stealing; no sequential voter concept was added.
- The reveal target is always the active player's pre-insertion timeline. The newly won card is removed only when the active player actually received it; steal/discard timelines remain unchanged.
- Correct-position ranges are treated inclusively and every active/voter claim gets text/icon plus success/failure color.
- The optional title/artist guess remains browser-only and survives `pendingReveal` to `reveal`. Next turn remains gated until the local judgment is dismissed/completed.
- One audio component stays mounted for a song across playing, voting, pending reveal, and reveal. The card flip does not pause it. A new round key resets UI/audio to the server's next paused song.
- Active and follower output both honor local mute. The HUD explicitly labels it as this-device mute, and toggling never invokes `onAction`.
- Timeline cards display `TimelineCard.year` as authoritative; manifest metadata is description-only and missing entries remain readable.
- More than six players are not rejected or hidden; they enter the contained list fallback.

## Verification completed by implementation phase

- `npm run build -w apps/web` — passed after TypeScript fixes; Vite produced the expected ignored `dist` output.
- `npm test -- --run tests/boardModel.test.ts tests/songText.test.ts` — passed: 2 files, 15 tests.
- `npm run lint -w apps/web` — passed after final cleanup with no warnings.
- `npm run build -w apps/web && npm test` — passed: web build and all 5 test files / 24 tests.
- `make check` — passed: 5 test files / 24 tests, zero lint warnings, and successful shared/web/API builds.

## Browser-review focus for following phases

Automated Node tests intentionally do not simulate native audio, Pointer Events, `ResizeObserver`, or CSS layout. Code review and browser QA should inspect 2–6 player geometry, 10-card/11-gap lanes, portrait scrolling, 200% zoom, pointer capture on touch/mouse, keyboard focus order, autoplay refusal, seek/resume, audio continuity through reveal, and spoiler absence in the pre-reveal DOM. These are verification boundaries, not known implementation failures.
