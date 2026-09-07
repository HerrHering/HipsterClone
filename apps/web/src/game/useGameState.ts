import { useEffect, useState } from "react";
import type { GameState } from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import { fetchState } from "./api";

// How often every phone re-asks the server "what's the state now?" No
// WebSocket, no push — just the same plain-fetch-on-a-timer approach
// App.tsx already used for cache-status badges, applied to the whole game.
// Exported so GameBoard.tsx can size its own "wait for everyone to catch
// up" delay (after a seek) off the same number, instead of a second,
// easily-drifting magic constant.
export const POLL_INTERVAL_MS = 1500;

/**
 * Polls a room's state on an interval while `roomCode` is set, and stops
 * (clearing `state`) when it's null — e.g. while still on the home screen,
 * before a room even exists yet.
 *
 * Also returns `applyState`, a manual setter: after successfully sending an
 * action (see game/api.ts's sendAction), the server's response is the new
 * state already — calling `applyState` with it updates the UI immediately
 * instead of leaving it to look unresponsive until the next poll tick.
 */
export function useGameState(roomCode: string | null): {
  state: GameState | null;
  error: string | null;
  applyState: (state: GameState) => void;
} {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Nothing to poll without a room — the `state: roomCode ? state : null`
    // below is what actually hides any leftover state from a previous room,
    // rather than this effect calling setState(null) itself (a synchronous
    // setState inside an effect triggers an extra render for no reason when
    // simply masking the return value does the same job for free).
    if (!roomCode) {
      return;
    }

    // Guards against a slow, now-stale fetch resolving *after* the effect
    // has already been cleaned up (e.g. roomCode changed, or the component
    // unmounted) — without this, that late response could overwrite newer
    // state with an outdated snapshot.
    let cancelled = false;

    const poll = () => {
      fetchState(roomCode)
        .then((next) => {
          if (!cancelled) {
            setState(next);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(errorMessage(err));
          }
        });
    };

    poll(); // don't wait a full interval for the first render's data
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomCode]);

  return {
    state: roomCode ? state : null,
    error: roomCode ? error : null,
    applyState: setState,
  };
}
