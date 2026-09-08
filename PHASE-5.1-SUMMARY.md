# Phase 5.1 — Prefetching the next song, and reshuffling when the catalog runs out

Two independent, small changes to the game loop itself — nothing here
touches Docker or Tailscale (Phase 5's own topic). Both build on Phase 3's
game logic (`PHASE-3-SUMMARY.md`) and protocol shape; everything else there
is unchanged.

1. **The next song's audio now starts downloading while the current song is
   still playing**, instead of only once the round actually ends. A cache
   miss means `apps/api` has to run `yt-dlp` for a few seconds before a
   song can play (see `apps/api/src/downloadClip.ts`) — that used to be
   dead time players sat through right when a new turn started. Now it
   happens in the background, one song ahead, while there's still music
   playing to fill the wait.
2. **The song catalog reshuffles once every song has been used**, instead
   of ending the game. The only rule: a song currently sitting in
   someone's timeline can never come back up — replaying it would either
   spoil it for whoever's holding it (they already know its exact year) or
   hand them a free correct guess.

---

## 1. Knowing the next song ahead of time (`protocol.ts`, `game.ts`)

Songs were always picked lazily — `pickRandomUnusedSong` gets called fresh,
right when a song is needed, from `loadNextSong`. That's a real obstacle to
prefetching: there was no such thing as "the next song" anywhere in
`GameState` until the round it belonged to had already started. A new field
fixes that:

```ts
// protocol.ts
// The song reserved to load at the next NEXT_TURN/START_GAME call — already
// pushed into usedSongIds so it can never be picked twice, and already known
// one turn ahead so the client can prefetch its audio while the current song
// is still playing (see game.ts's loadNextSong/pickNextSong). null only in
// the degenerate case where every song in the whole catalog is currently
// held in some player's timeline — the next loadNextSong call is what
// actually ends the game then, same as an ordinary empty catalog always has.
nextSongId: string | null;
```

`loadNextSong` now works in two halves — consume, then peek:

```ts
function loadNextSong(state: GameState, catalog: SongManifestEntry[]): void {
  const songId = state.nextSongId ?? pickNextSong(state, catalog)?.id ?? null;
  if (!songId) {
    // ...game-over fallback, unchanged in shape (see §2 for when this
    // actually triggers now)
  }

  if (!state.usedSongIds.includes(songId)) {
    state.usedSongIds.push(songId);
  }
  state.phase = { type: "playingSong", songId };
  state.playback = { songId, isPlaying: false, positionSec: 0, updatedAt: Date.now() };
  // ...

  // Peek one turn further ahead so the client can start prefetching this
  // song's audio while the one that just loaded above is still playing —
  // reserved in usedSongIds immediately (inside pickNextSong) so the next
  // loadNextSong call above is guaranteed to consume exactly this song,
  // never a different random pick.
  state.nextSongId = pickNextSong(state, catalog)?.id ?? null;
}
```

`state.nextSongId ?? pickNextSong(...)?.id ?? null` reads as "whatever was
already peeked, or — if nothing has ever been peeked yet — pick fresh." That
second case only ever happens on the very first call this game
(`START_GAME`, before anything has had a chance to peek ahead); every call
after that consumes exactly what the *previous* call already reserved.

**Why reserve ahead of time instead of just peeking?** `pickRandomUnusedSong`
rolls a fresh random pick every time it's called — two calls with the same
`usedSongIds` won't generally agree. If the peek didn't immediately push its
result into `usedSongIds`, the real pick at the next `NEXT_TURN` would almost
certainly land on a *different* song than the one just prefetched, making
the whole feature pointless. Reserving it — via `pickNextSong`, same as the
current song — is what guarantees "the song we prefetched" and "the song
that actually loads next" are always the same one.

## 2. The server side of prefetching was already built (`server.ts`, `cache.ts`)

This is the pleasant surprise of this change: no server route needed to be
added. `POST /api/audio/:id/prefetch` and `ensureCached`'s
concurrent-caller dedupe were both already sitting in the codebase,
explicitly commented as built for exactly this:

```ts
// server.ts — already existed, unused until now
app.post("/api/audio/:id/prefetch", async (req, res) => {
  const filePath = await ensureCached(req.params.id);
  res.json({ cached: filePath !== null });
});
```

`ensureCached` (`cache.ts`) tracks in-flight downloads in a `Map` keyed by
song id, so calling it twice for the same id — say, a prefetch racing the
`<audio>` element's own eventual request for that same song — just makes
the second caller await the first caller's already-running download instead
of starting a redundant second one. That safety net is what makes it fine
for *every* player's phone to independently fire the same prefetch call
(see below) rather than needing to elect just one of them to do it.

## 3. Firing the prefetch from the client (`api.ts`, `GameBoard.tsx`)

A thin wrapper, matching the shape of every other function in `api.ts`:

```ts
// api.ts
export function prefetchAudio(songId: string): Promise<{ cached: boolean }> {
  return requestJson<{ cached: boolean }>(`/api/audio/${songId}/prefetch`, {
    method: "POST",
  });
}
```

`GameBoard.tsx` already polls `GameState` once a second (`useGameState.ts`),
so it already sees `nextSongId` the moment the server sets it — a new
`useEffect` just watches for that value changing:

```tsx
const prefetchedSongIdRef = useRef<string | null>(null);
useEffect(() => {
  const nextSongId = state.nextSongId;
  if (!nextSongId || prefetchedSongIdRef.current === nextSongId) {
    return;
  }
  prefetchedSongIdRef.current = nextSongId;
  void prefetchAudio(nextSongId).catch((error: unknown) => {
    console.error("prefetchAudio() failed:", error);
  });
}, [state.nextSongId]);
```

Two things worth calling out, since both are small but easy to get wrong:

- **The `useRef`, not `useState`, is what stops this from firing every
  poll tick.** `state.nextSongId` stays the same value for the whole
  duration of a turn (roughly a second's worth of poll ticks, times
  however long the round takes) — without tracking "have I already fired
  for this id," the effect would re-run and re-POST every single tick it's
  unchanged... except it wouldn't, actually, because the effect's
  dependency array (`[state.nextSongId]`) already means React only re-runs
  it when that value *changes*. The ref is there for a subtler reason:
  React's Strict Mode (and certain reconnect/remount scenarios) can
  legitimately re-run an effect for the same dependency value more than
  once. A ref surviving across those re-runs — unlike a fresh local
  variable, which wouldn't remember anything — is what makes "fire once
  per distinct song id" actually hold, not just "fire once per dependency
  change most of the time."
- **This fires on every player's phone, not just the active player's.**
  That's a deliberate simplification rather than an oversight — electing
  "only the active player prefetches" would need extra state and a reason
  to trust that one specific phone stays connected. Letting every phone
  independently (and redundantly) call the same idempotent, deduped
  endpoint gets the same result with no coordination logic at all.

## 4. Reshuffling instead of ending the game (`game.ts`)

Before this, running out of unused songs was permanent — `loadNextSong`
would immediately end the game and crown whoever had the most timeline
cards. A new helper sits in front of the plain random pick and gives the
catalog a second life once it's been fully used:

```ts
// Picks the next song to play, reshuffling the discard pile back in once
// every song has been used at least once. "Reshuffle" means resetting
// usedSongIds down to just the songs currently held in a player's
// timeline — never a song that was played and then discarded (nobody
// guessed it) or has changed hands since, only ones a player would
// instantly recognize a second play of. Returns null only if literally
// every song in the catalog is currently held by someone — loadNextSong's
// existing "no song available" branch still ends the game gracefully then.
function pickNextSong(
  state: GameState,
  catalog: SongManifestEntry[],
): SongManifestEntry | null {
  const song = pickRandomUnusedSong(catalog, state.usedSongIds);
  if (song) {
    return song;
  }
  state.usedSongIds = Object.values(state.players).flatMap((player) =>
    player.timeline.map((card) => card.songId),
  );
  const reshuffled = pickRandomUnusedSong(catalog, state.usedSongIds);
  if (reshuffled) {
    pushLog(state, "Every song has been played — reshuffling the deck.");
  }
  return reshuffled;
}
```

**Why player timelines, and not just "leave `usedSongIds` alone"?** A song
that was played and *discarded* (nobody guessed the right slot — see
`finishRound`'s `else` branch) never ends up in anyone's timeline at all;
there's nothing wrong with drawing it again. A song that *is* in someone's
timeline, though, is permanently theirs — `insertCard` is the only place a
song ever gets added to a timeline, and there's no code path anywhere that
ever removes one. So "every songId currently in some player's timeline" is
always the exact, complete set of songs that must stay excluded, and — since
every `PlayerState` already carries its own `timeline: TimelineCard[]` —
that set never needs its own tracked field; it can just be computed on the
spot with `Object.values(state.players).flatMap(...)`.

**`flatMap` is doing two jobs in one call here**: `Object.values(state.players)`
turns the `players` dictionary into a plain array of `PlayerState`s, and for
*each* player, `.timeline.map((card) => card.songId)` produces its own
little array of song ids. A plain `.map` here would leave you with an array
of arrays (one per player) — `.flatMap` is exactly `.map` followed by
flattening one level, so the end result is a single flat `string[]` of every
held song id across every player, ready to assign straight to
`state.usedSongIds`.

**Does reserving a song one turn ahead of when it's actually played change
when the catalog runs dry?** No — traced by hand: reserving-and-then-playing
consumes the catalog at exactly the same rate as picking-fresh-each-turn did
before, because the "current" song for turn *N* was already reserved during
turn *N-1*'s peek, so only the *new* peek at the end of each `loadNextSong`
call is ever a genuinely new reservation. If a peek ever finds nothing (even
after a reshuffle attempt), `nextSongId` simply becomes `null` — not a bad
reservation — and the next `loadNextSong` call retries the exact same way
before finally giving up. The old "crown the leader" ending still exists;
it's just a true last resort now (every catalog song held by someone)
instead of the moment any small catalog would eventually hit.

---

## What you'll notice while playing

Nothing to configure or turn on — both changes are silent by design, the
same way the audio cache already was:

- Turns should feel snappier once the game's been running for a minute or
  two — the next song is usually already downloaded by the time you get to
  it.
- If a game runs long enough to use every song in the catalog, you'll see
  **"Every song has been played — reshuffling the deck."** in the Activity
  log, and songs can start repeating from there — except any song someone's
  already holding a card for, which never comes back.
