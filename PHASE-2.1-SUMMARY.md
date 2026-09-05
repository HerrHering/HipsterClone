# Phase 2.1 — Walkthrough

This phase is a deliberate simplification, not a new feature. Three things changed from Phase 2 (see `PHASE-2-SUMMARY.md` for everything that's still true and unchanged):

1. **Dynamic year lookup was tried and reverted.** A MusicBrainz-backed `resolveYear.ts` briefly let `year` be left blank in `songs.csv` and resolved automatically. Live testing surfaced a real correctness problem: for a-ha's "Take On Me," MusicBrainz has two genuine release-groups — an October 1984 original that didn't chart, and the May 1985 re-recording paired with the iconic video, which is the version anyone would actually recognize. "Take the earliest release" (the simplest, and by then only, selection rule) picked 1984 — technically real, but wrong for a game about guessing a song's *well-known* year. Fixing that properly would need a signal this API doesn't cleanly offer (chart position, popularity), which is real work and premature at this stage. So: `resolveYear.ts` is deleted, and `year` is a required hand-typed field again, exactly like `artist` and `title` — see git history (around the "Phase 2.1" commits, now superseded) if picking this back up later.
2. **The manual mp3 override is gone, and so is the type-level idea of it.** Phase 2 let you drop a corrected mp3 at `apps/web/public/audio/<id>.mp3` and the scraper would use it instead of resolving a link, tracked via an `AudioKind = "local-file" | "embedded-link"` field. Since essentially every song now gets a link automatically, this went in two steps: first the auto-discovery mechanism was removed (see "the reuse step" below), then — on reflection — `AudioKind`/`kind` itself was removed too, rather than kept "just in case." A type field that names a capability the app no longer has isn't a harmless unused option, it's a standing claim that misleads whoever reads it later into thinking that capability still needs maintaining. `SongAudioRef` is now YouTube-only; the manual path for a one-off song is hand-editing that entry's `videoId` directly in `manifest.json`.
3. **`ResolvedSource`/`SongAudioRef` grew instead of shrinking, on the same trip.** While auditing the types, `resolveSource.ts`'s matched-video `title`, `channel`, and `confidence` turned out to be computed but never read by anything outside the file — the initial instinct was to trim them as dead fields. That's the wrong test, though: they're *free* (already computed, zero extra cost) and they genuinely describe the resolved audio source, exactly like `durationSec` already did. So instead of removing them, they're now kept and persisted all the way into `manifest.json`, not just used transiently inside `resolveSource()`. Nothing displays them yet — same as `durationSec` before this — but re-deriving them later would mean re-running the scraper, and they cost nothing to keep now.

On top of that, two more rounds of work: a scoring fix that makes `resolveSource.ts` actually prefer an "Official Video" upload instead of merely tying with one (and a real, longer-standing bug it uncovered along the way), and a debug flag (`HIPSTER_DEBUG=1`) that grew from "show low-confidence picks" into full visibility across the scraper, the download pipeline, and the api server — see below for both.

---

## `SongAudioRef`: YouTube-only, and fully populated

```ts
export interface SongAudioRef {
  videoId: string;
  videoTitle: string; // the matched video's own title — not the song's title
  channel: string;
  durationSec: number;
  confidence: number; // resolveSource's own match confidence, 0..1
}
```

Two things worth noticing:

- **No `kind` field, no optionals.** Every entry is now built through exactly one path (`resolveSource` → `index.ts`), so every field is always present — there's nothing left that's sometimes-a-path, sometimes-a-video-id, or sometimes-missing. A type with fewer possible shapes is easier to reason about at every call site that reads it.
- **`videoTitle`, not `title`.** `resolveSource.ts` originally called this field `title` — the matched video's own title (e.g. "Queen – Bohemian Rhapsody (Official Video Remastered)"). Nested inside `SongAudioRef`, that would sit right next to `SongManifestEntry.title` (the actual song title, e.g. "Bohemian Rhapsody") — two different things with the same name one level apart. Renaming it avoids that trap.

## The reuse step: one job now, not two

Phase 2's `index.ts` originally had two separate ways an id could avoid a fresh YouTube search — a disk-scan for a hand-placed mp3, and a check for a previously auto-resolved link:

```ts
// Phase 2 (removed)
if (existsSync(localAudioPath)) { /* local-file wins, always */ }
if (previous && previous.audio.kind === "embedded-link") { /* reuse */ }
```

Both the disk-scan and the `kind` check are gone now. What's left is simpler than either version:

```ts
// Phase 2.1
const previous = previousEntriesById.get(id);
if (previous) {
  entries.push(previous);
  continue;
}
```

This one check does everything the reuse step needs to do: skip a redundant search when a previous run already resolved this id, *and* make a hand-edit to an entry's `videoId` in `manifest.json` stick across future scrapes instead of being silently overwritten. It doesn't need to know or care what's in the entry — just that it's already there.

One consequence worth knowing: this makes *any* previous entry permanent until the id changes (i.e. until `title`/`artist`/`year` changes) or `manifest.json` is deleted outright. That was already true for auto-resolved links before this phase — it's just now also the documented way to fix a wrong pick by hand.

---

## Scoring: preferring the official upload

`resolveSource.ts`'s matching originally scored three signals (title overlap, artist mention, plausible duration) plus a flat penalty for cover/live/remix-style keywords. A real search result exposed a gap: for BTS's "Dynamite," the true official upload tied *exactly* with two live-performance clips that don't happen to contain the word "live" anywhere in their titles:

```
resolveSource debug: "Dynamite" by "BTS" — 5 candidate(s):
  gdZLi9oWNZg "BTS ... 'Dynamite' Official MV" ... total=1.00
  jWRMXiHhDjc "BTS ... 'Dynamite' @ 63rd GRAMMY Awards Show" ... total=1.00
  e81ad5MpfQ0 "BTS ... 'Dynamite' @ America's Got Talent 2020" ... total=1.00
```

The correct video only won because it happened to sort first among ties — not because anything about the scoring actually preferred it. Two fixes:

1. **A new `officialMarkerSignal`** — 1 if the title contains the word "official" (as in "Official Video"/"Official Music Video"), else 0. Added as a proper 4th weighted signal, not a bolted-on bonus, so the weights still sum to exactly 1.0 (`titleOverlap=0.5, artistMentioned=0.2, durationPlausible=0.15, officialMarker=0.15`) and the `confidence` value persisted to `manifest.json` stays honestly in the 0..1 range it's documented to be. `"concert"` was also added to the existing cover/live/remix penalty keyword list, since it wasn't there before.
2. **A real bug this uncovered, unrelated to the new signal itself:** the official-marker check initially returned 0 even for titles that obviously said "(Official Video)." The cause was `normalize()` — it was stripping *all* bracketed content (`(...)`/`[...]`) to reduce noise in word-overlap matching, but that's exactly where markers like "(Official Video)" and "(Live 8 2005)" almost always live. This had been silently blinding the *existing* `nonOriginalPenalty` check to most real cover/live titles too, the whole time — not something this round introduced, just something it exposed by actually testing the new signal against live data. Fixed by no longer stripping brackets in `normalize()`: it's safe for word-overlap matching (the generic filler words inside brackets — "official," "video," "audio" — are already dropped by `STOPWORDS`, and an extra unmatched word never lowers `wordOverlapFraction`), and it's what makes the keyword-scanning signals actually see the text they're supposed to.

After the fix, the same search resolves cleanly — the official video scores `1.00`, both live clips drop to `0.85`:

```
resolveSource debug: "Dynamite" by "BTS" — 5 candidate(s):
  gdZLi9oWNZg "BTS ... 'Dynamite' Official MV" ... officialMarker=1 ... total=1.00
  jWRMXiHhDjc "BTS ... 'Dynamite' @ 63rd GRAMMY Awards Show" ... officialMarker=0 ... total=0.85
  e81ad5MpfQ0 "BTS ... 'Dynamite' @ America's Got Talent 2020" ... officialMarker=0 ... total=0.85
```

Verified this didn't change any existing pick: every song in the catalog resolved to the exact same video id before and after — a pure correctness improvement to *how confidently* the right answer was reached, not a change to which answer it was.

---

## `HIPSTER_DEBUG=1` — the app's one debug flag, and everything it now covers

One env var, checked independently in every file that needs it — no shared helper, no library, just a `const DEBUG = process.env.HIPSTER_DEBUG === "1"` and `console.log`/`console.warn`/`console.error` calls at points that already had the relevant data on hand. It's grown to cover four things:

**1. `tools/scraper/src/resolveSource.ts` — every search candidate, not just the winner.** Normally only a *low-confidence* pick logs anything. With the flag on, every candidate the `yt-dlp` search returned gets printed, full breakdown included (now with `officialMarker`, see above):

```
resolveSource debug: "Bohemian Rhapsody" by "Queen" — 5 candidate(s):
  fJ9rUzIMcZQ "Queen – Bohemian Rhapsody (Official Video Remastered)" titleOverlap=1.00 artistMentioned=1.00 durationPlausible=1 officialMarker=1 nonOriginalPenalty=0 total=1.00
  vbvyNnw8Qjg "Queen - Bohemian Rhapsody (Live Aid 1985)" titleOverlap=1.00 artistMentioned=1.00 durationPlausible=1 officialMarker=0 nonOriginalPenalty=0.3 total=0.55
  ...
resolveSource debug: picked fJ9rUzIMcZQ — highest score.
```

**2. `apps/api/src/cache.ts` and `downloadClip.ts` — the runtime download path.** A cache hit/miss line from `ensureCached`, then (on a miss) the exact `yt-dlp` command `downloadClip` runs, then the outcome:

```
ensureCached debug: cache miss for "dynamite-bts-2020", downloading...
downloadClip debug: /path/to/.venv/bin/yt-dlp -x --audio-format mp3 ... https://www.youtube.com/watch?v=gdZLi9oWNZg
downloadClip debug: wrote /path/to/cache/dynamite-bts-2020.mp3
```

**3. `apps/api/src/server.ts` — every HTTP request, not just the ones the other logging happens to explain.** Routes like `/api/cached-ids` or the `DELETE` endpoint had no visibility at all before this; now every request logs its method, path, status, and timing when it finishes:

```
server debug: GET /api/cached-ids -> 200 (10ms)
server debug: GET /api/audio/dynamite-bts-2020 -> 200 (19928ms)
server debug: DELETE /api/audio/dynamite-bts-2020 -> 204 (3ms)
```

**4. Error-reporting policy — quiet by default, honest under debug.** Two catches that used to fail completely silently now report under the flag: `loadPreviousManifest` (a `manifest.json` that exists but fails to parse) and `App.tsx`'s `refreshCachedIds` (the api server not reachable — this one always logs via `console.debug` in the browser console, since DevTools is already an opt-in, low-noise surface unlike a terminal). The two catches that were already always-on (`resolveSource`'s yt-dlp search, `downloadClip`'s yt-dlp download) stay always-on — a real infrastructure failure shouldn't need a flag to be visible — but now also dump the *full* error object under `HIPSTER_DEBUG`, not just its one-line message.

**Turning it on:** `HIPSTER_DEBUG=1 npm run scrape` or `HIPSTER_DEBUG=1 npm run dev`, or the shortcuts added for exactly this — `npm run scrape:debug` and `npm run dev:debug` (root `package.json`) — so you don't have to remember or retype the env var. Nothing changes for anyone who just runs the plain `npm run dev`/`npm run scrape` — all of this is opt-in.

---

## How to use the app

**First time setup.** `npm install` at the repo root (installs all workspaces). You'll also need a working `yt-dlp` new enough to handle YouTube's signature challenge — this project's own `.venv/bin/pip install -U yt-dlp` into a `python3 -m venv .venv` at the repo root is what it uses itself — and, only on the machine that runs `apps/api`, a logged-in browser for `--cookies-from-browser` to borrow from (`firefox` by default; override with `YTDLP_COOKIES_BROWSER=<browser>`, or `=none` if downloads work without it).

**Day to day — adding a song.**
1. Add a row to `tools/scraper/data/songs.csv`: `<artist>,<title>,<year>` — all three fields, always. A blank `year` is skipped with a warning, not resolved automatically (see "Dynamic year lookup was tried and reverted" above for why).
2. `npm run scrape` — resolves any new rows' YouTube links and regenerates `manifest.json`. Rows that already resolved on a previous run aren't searched again.
3. If a resolved video is wrong, hand-edit that song's `audio.videoId` directly in `manifest.json` — it sticks across future scrapes (see "The reuse step" above).

**Running the app.** `npm run dev` from the repo root starts both the web app and the api server together. Open the printed `localhost` URL; a song downloads and caches automatically the first time you select it, and plays instantly from cache after that. `npm run build` + `npm run start -w apps/api` (which sets `NODE_ENV=production` itself) serves the built app and the api from one process on one port, for sharing with a friend.

**Debugging.** Use `npm run scrape:debug` instead of `npm run scrape` to see every YouTube candidate considered and why one won. Use `npm run dev:debug` instead of `npm run dev` to additionally see cache hits/misses, the exact `yt-dlp` download command, every HTTP request the api receives, and any otherwise-silent recoverable error. See "`HIPSTER_DEBUG=1`" above for exactly what each piece looks like.

Everything else — the id-derivation rule, `resolveSource.ts`'s five-signal scoring pipeline, `apps/api`'s on-demand cache — is unchanged from Phase 2.
