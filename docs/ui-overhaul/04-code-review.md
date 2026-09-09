# Tabletop UI overhaul: code review handoff

## Review verdict

Approved for browser QA after remediation. The implementation conforms to the
requirements and technical design at the static/code level: it is confined to
the web client and root tests, uses only existing `GameAction` variants, keeps
polling/server snapshots authoritative, preserves simultaneous stealing, and
does not modify API or shared game rules. The board derives seats from
`turnOrder`, rotates only the view, retains a list fallback outside two through
six players, and keeps selection local until an explicit confirmation.

No unresolved critical or high-severity code finding remains. Browser QA is
still required for native media behavior, Pointer Events, CSS geometry, zoom,
and real multi-client polling races.

## Findings and remediation

### High severity — none remaining

No protocol mutation, premature game action, pre-reveal manifest lookup, hidden
player, or incorrect reveal-target reconstruction was found. `apps/api` and
`packages/shared` have no UI-overhaul diff.

### Medium severity — resolved

1. **A rejected seek could still auto-resume shared playback.**
   `AudioControls.commitSeek` scheduled `PLAY` after one poll interval even when
   the `SEEK` request failed. It now schedules resumption only after a successful
   seek and immediately unlocks the local transport on failure. The timer ref is
   also cleared when it fires.

2. **A rejected bonus-token claim discarded the local judgment.**
   The Yes handler cleared `lockedGuess` regardless of the action result, which
   could expose Next turn after a failed claim. It now dismisses the judgment
   only after `CLAIM_GUESS_TOKEN` succeeds; the existing action error remains
   visible and retryable after rejection.

3. **Normal phase changes could announce a false steal race.**
   Selection reconciliation used the remote-claim announcement whenever any
   selection became illegal, including a successful placement/phase transition.
   It now announces/refocuses only when a token selection is invalidated while
   the viewer is still eligible to vote. Other phase-driven cleanup is silent.

4. **Legacy timeline CSS interfered with new gap geometry.**
   An older `.timeline-gap::before` rule enlarged every new 44px absolute hit
   target by another 32px, causing excessive overlap and ambiguous pointer hit
   testing. The tabletop scope now disables that pseudo-element while retaining
   the unscaled 44px button itself.

5. **Narrow viewports initially opened at the table's top-left.**
   The contained 760px board could make both the viewer's bottom seat and center
   card initially off-screen. `GameBoard` now centers the scrollport horizontally
   and aligns it to the bottom on initial mount, exposing the viewer seat and the
   lower portion of the center without changing later user scrolling.

6. **Natural track completion could be replayed by reconciliation.**
   The unified audio element no longer emitted the active client's former
   end-of-track pause, while a later poll could call `play()` on an ended media
   element. The control now reports `Song ended`, bounds drift targets by known
   duration, never auto-plays an ended element, and mirrors `PAUSE` when the
   track ends while the viewer still has playback authority.

### Low severity — resolved

1. Reveal claim labels showed only a check/cross glyph. They now include the
   words `Correct` or `Incorrect`, so result meaning does not rely on color or a
   potentially unfamiliar symbol.
2. The custom audio range did not reserve a 44px touch height, and the new game
   controls lacked the requested explicit high-contrast focus ring. Both are now
   covered by scoped CSS.
3. Pure-model tests did not directly cover exact six-seat descriptors, zero-seat
   fallback, stolen-card target reconstruction, reveal/claim/next authorization,
   all eleven ten-card boundary gaps, or scale bounds. These cases were added;
   the suite now has 28 tests total.

## Conformance checks

- **Functionality/protocol:** all requests remain `START_GAME`, placement,
  steal/pass, reveal/claim/next, and playback actions already defined by the
  shared protocol. Drag/drop performs reducer events only. No optimistic token
  spend or vote insertion exists.
- **Spoiler safety:** the front `MysteryCard` receives neither `songId` nor a
  manifest entry and mounts no answer face. Manifest title/artist is passed only
  in reveal. Timeline cards contain already-revealed information.
- **Audio continuity:** one keyed `AudioControls` instance sits outside the
  mystery-card branch and survives playing, stealing, pending reveal, and
  reveal. Local mute applies to its single real audio element. The next song
  remounts by song id and follows paused server state.
- **Layout:** the implementation uses the specified fixed seat descriptors for
  two through six, fixed player-zone rectangles, a fixed center stack, measured
  normal/compact/scroll timeline modes, authoritative timeline years, and a
  contained list fallback for other counts. No player is derived from unordered
  `Object.values(players)`.
- **Input/accessibility:** pointer capture and a movement threshold drive card
  and token dragging; direct gap buttons and keyboard activation use the same
  selection handler; gaps remain unscaled 44px targets; Escape, focus movement,
  human gap names, local live announcements, visible confirm/pass actions, and
  local mute remain available.
- **State races:** action submission is guarded by a synchronous ref and visible
  pending state. A remotely claimed selected gap is reconciled without sending a
  stale action. Rejected placement/steal selections remain editable.

## Validation results

- `npm test -- --run tests/boardModel.test.ts tests/songText.test.ts` — passed
  before the final test expansion (15 tests).
- `npm run lint -w apps/web` — passed after remediation.
- `npm run build -w apps/web` — passed after remediation.
- `make check` — passed after all changes: 5 test files, 28 tests, zero lint
  warnings, and successful shared/web/API builds.
- `git diff --check` — passed before handoff.

Generated coverage was not modified. Vite's ignored `dist` output was refreshed
by the required build command only.

## Browser QA test charter

QA should use real browser interaction and record screenshots/results in
`05-qa.md`. Test at least two complete multi-client rounds, including one active
correct placement and one wrong placement with a contested steal.

1. **Seat geometry and capacity**
   - Inspect 2, 3, 4, 5, and 6-player rooms at a wide landscape viewport.
   - Confirm the current viewer is visually bottom, clockwise order is stable,
     text stays upright, center/seat rectangles do not overlap, and token piles
     remain behind their own plate/timeline.
   - Inject or reach ten cards and all eleven gaps on horizontal and vertical
     lanes; verify normal/compact/contained-scroll transitions, reachable first
     and last gaps, and no card omission/wrapping.
   - Exercise a 7-player synthetic/legacy snapshot and confirm all players appear
     in ordered list fallback.

2. **Responsive and visual modes**
   - Test 320x568, 390x844, tablet portrait, desktop landscape, and 200% browser
     zoom. Confirm the page itself has no horizontal overflow, the tabletop
     scrollport opens around the viewer/center, the hint is visible, and mute,
     room, leave, instruction, and action tray stay reachable.
   - Test long player names, zero tokens, one token, and more than six tokens.
   - Inspect light/dark, `prefers-contrast: more`, and reduced motion. Reduced
     motion must reveal immediately without a disorienting rotation.

3. **Placement interaction**
   - With mouse and touch emulation, drag the center card across several gaps,
     outside the board, and back to both boundary gaps. Verify the exact ghost,
     cancellation, re-dragging, and that dropping sends no request.
   - Select directly by click/tap and entirely by keyboard (source, Tab/arrows,
     Home/End, Enter/Space, Escape, Confirm). Confirm only the explicit Confirm
     action sends placement and duplicate submission is blocked.
   - Force a rejected confirmation and verify the selected gap and error remain.

4. **Simultaneous stealing and poll races**
   - Use at least three clients. Have two non-active players decide in either
     order; confirm there is no sequential-voter UI and each eligible viewer's
     own token plus the active timeline is emphasized.
   - Drag a token, confirm its decorative count does not change before response,
     then verify the server-confirmed one-token cost for correct and wrong steals.
   - Select the same gap on two clients, confirm one, then let the other poll.
     The loser must cancel, refocus its token source, announce the race, and still
     be able to choose another gap or Pass.
   - Verify active placement, claimed gaps, vote/pass badges, and no-token Pass
     behavior on every client.

5. **Reveal and spoiler audit**
   - Before reveal, inspect visible DOM/accessibility tree: no title, artist,
     year, manifest entry, answer face, or spoiler tooltip may be mounted in the
     mystery card.
   - Enter an optional guess, reveal, and verify the same center card flips to
     title/artist/authoritative year while playback continues.
   - Verify active and voter markers each show claimant plus Correct/Incorrect,
     every inclusive equal-year tie gap is highlighted, and the displayed target
     remains the active player's pre-insertion timeline even when a stealer wins.
   - Reject/fail a bonus claim once; verify the judgment remains retryable. Test
     Yes and No paths and confirm Next turn stays gated until judgment completes.

6. **Audio synchronization and local mute**
   - Verify only the active player in `playingSong` can use Play/Pause/Seek;
     followers show disabled controls and track shared state.
   - Seek while playing and paused. Confirm immediate local pause, follower
     catch-up, one-poll lock, resume only for the formerly-playing case, and no
     resume after a rejected seek.
   - Toggle `Mute this device` on active and follower clients; it must persist on
     refresh, affect only that device, and emit no shared game action.
   - Exercise autoplay refusal, slow load/buffering, refresh mid-song, and drift
     correction over one second. Confirm audio continues through placement,
     votes, pending reveal, and reveal, then the next track is silent/paused until
     its new active player presses Play.

7. **End state and retained utilities**
   - Reach game over and verify the winner zone/announcement, final timelines,
     room code, event log, mute, and leave remain; playback and invented rematch
     controls do not appear.
   - Confirm connection-hiccup, manifest error, action error, loading/buffering,
     stale-seat fallback, event-log disclosure/autoscroll, and leave-room flows
     still render and behave as before.

Any browser failure affecting rules, spoilers, action authorization, audio
continuity, lost players, or unreachable primary actions should block approval.
Purely cosmetic deviations should be recorded with viewport, player count,
phase, reproduction steps, and screenshot before deciding severity.
