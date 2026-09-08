// Thin fetch wrappers around apps/api's room routes (see server.ts). Every
// function here is a SERVER API REQUEST — none of these touch a local file.

import type { GameAction, GameState } from "@hipster-clone/shared";

export interface CreatedRoom {
  roomCode: string;
  playerId: string;
  state: GameState;
}

export interface JoinedRoom {
  playerId: string;
  state: GameState;
}

// The server reports a rejected request as a non-2xx response with a JSON
// `{ error: "..." }` body (see server.ts's catch blocks) — this turns that
// into a thrown Error, so every caller below can just try/catch instead of
// re-checking `res.ok` by hand each time.
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createRoom(name: string): Promise<CreatedRoom> {
  return postJson<CreatedRoom>("/api/rooms", { name });
}

export function joinRoom(roomCode: string, name: string): Promise<JoinedRoom> {
  return postJson<JoinedRoom>(`/api/rooms/${roomCode}/join`, { name });
}

// The poll target — called on an interval by useGameState.ts.
export function fetchState(roomCode: string): Promise<GameState> {
  return requestJson<GameState>(`/api/rooms/${roomCode}/state`);
}

export function sendAction(
  roomCode: string,
  playerId: string,
  action: GameAction,
): Promise<GameState> {
  return postJson<GameState>(`/api/rooms/${roomCode}/action`, {
    playerId,
    action,
  });
}

// Warms apps/api's audio cache for a song ahead of playback — see
// server.ts's /prefetch route. No body to send, unlike the POSTs above.
export function prefetchAudio(songId: string): Promise<{ cached: boolean }> {
  return requestJson<{ cached: boolean }>(`/api/audio/${songId}/prefetch`, {
    method: "POST",
  });
}
