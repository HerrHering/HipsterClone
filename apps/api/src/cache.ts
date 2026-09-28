import { existsSync, readdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { downloadClip } from "./downloadClip.js";

const here = dirname(fileURLToPath(import.meta.url));
// LOCAL FILESYSTEM PATH — reads the same manifest.json the scraper writes;
// never fetched over HTTP, this process just opens it straight off disk.
const manifestPath = resolve(here, "../../web/public/manifest.json");
// LOCAL FILESYSTEM PATH — where downloaded mp3s live on this machine.
export const cacheDir = resolve(here, "../data/cache");

// Off by default. Set HIPSTER_DEBUG=1 (e.g. `HIPSTER_DEBUG=1 npm run dev`) to
// see whether ensureCached served a cache hit or triggered a real download.
const DEBUG = process.env.HIPSTER_DEBUG === "1";

const MP3_SUFFIX = ".mp3";

// Filters out inactive songs (see SongManifestEntry.active) so every caller —
// game.ts's pickers, findSong/ensureCached below — transparently only ever
// sees playable songs, without needing to filter themselves. Safe under the
// assumption the manifest doesn't change mid-game: any id already in play was
// drawn from this same active-only view when it was first selected.
export async function loadManifest(): Promise<SongManifest> {
  const text = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(text) as SongManifest;
  return { ...manifest, songs: manifest.songs.filter((song) => song.active) };
}

export async function findSong(
  id: string,
): Promise<SongManifestEntry | null> {
  const manifest = await loadManifest();
  // `.find()` returns `undefined`, not `null`, when nothing matches — `?? null`
  // normalizes that so this function's own return type stays a clean
  // `SongManifestEntry | null` instead of leaking `undefined` too.
  return manifest.songs.find((song) => song.id === id) ?? null;
}

// LOCAL FILESYSTEM PATH builder — turns a song id into where its cached mp3
// would live, whether or not it's actually there yet.
function cachedFilePath(id: string): string {
  return resolve(cacheDir, `${id}${MP3_SUFFIX}`);
}

export function isCached(id: string): boolean {
  return existsSync(cachedFilePath(id));
}

export function listCachedIds(): string[] {
  if (!existsSync(cacheDir)) {
    return [];
  }
  return readdirSync(cacheDir)
    .filter((name) => name.endsWith(MP3_SUFFIX))
    .map((name) => name.slice(0, -MP3_SUFFIX.length)); // "id.mp3" -> "id"
}

// Real yt-dlp downloads (never cache hits — those return before any of this
// is touched) are globally serialized and rate-limited, across every song
// id, so this server can't accidentally hammer YouTube the way an unpaced
// burst of requests once did and tripped its bot-check. `downloadQueueTail`
// is a promise chain used purely as a FIFO lock: each new call `.then()`s
// onto whatever's already queued, so only one yt-dlp process ever runs at a
// time, in request order. `lastDownloadFinishedAt` is stamped only when a
// real download settles (success or failure), and the next one waits out
// however much of the cooldown window remains before it may start.
//
// This one chain also replaces what used to be a separate per-id
// "inFlightDownloads" Map for deduping two concurrent callers wanting the
// same song (a real case — GameBoard.tsx's non-active-player branch renders
// two <audio> elements pointing at the same song URL at once): `ensureCached`
// re-checks the disk cache right when its queued turn comes up, so a second
// caller for a song the first one just finished simply finds it already
// there and skips its own download — no per-id bookkeeping needed.
const DOWNLOAD_COOLDOWN_MS = 1_000;
let downloadQueueTail: Promise<void> = Promise.resolve();
let lastDownloadFinishedAt = 0;

// One candidate attempt: wait out whatever's left of the cooldown, then run
// the actual yt-dlp download for this specific videoId. No queue-chaining of
// its own — the caller (ensureCached's runTurn) already holds the queue's
// one slot for the whole multi-candidate sequence below, so a song needing
// several fallback attempts still resolves (success or total failure) as one
// uninterrupted block, not interleaved with other songs' requests.
async function attemptOneCandidate(
  id: string,
  videoId: string,
): Promise<string | null> {
  const waitMs = lastDownloadFinishedAt + DOWNLOAD_COOLDOWN_MS - Date.now();
  if (waitMs > 0) {
    if (DEBUG) {
      console.log(`ensureCached debug: cooling down for ${waitMs}ms before "${id}"`);
    }
    await delay(waitMs);
  }
  try {
    const result = await downloadClip(id, videoId, cacheDir);
    return result?.filePath ?? null;
  } finally {
    // Stamped after every real attempt, success or failure — the whole
    // point is spacing out actual yt-dlp/YouTube hits, regardless of why
    // the next one is happening.
    lastDownloadFinishedAt = Date.now();
  }
}

/**
 * Ensures a song's audio is on disk, downloading it first if necessary.
 * Idempotent — safe to call repeatedly, and safe to call speculatively ahead
 * of playback. That idempotency is deliberate: this is the one seam a future
 * "prefetch the next song while the current one plays" feature would call
 * into, unchanged (see the /prefetch route in server.ts, which already calls
 * this without streaming anything back).
 */
export async function ensureCached(id: string): Promise<string | null> {
  if (isCached(id)) {
    if (DEBUG) {
      console.log(`ensureCached debug: cache hit for "${id}"`);
    }
    return cachedFilePath(id);
  }

  const runTurn = async (): Promise<string | null> => {
    // Re-check now that it's actually this call's turn in the queue —
    // another queued call for the same id may have already downloaded it
    // while this one was waiting in line, in which case there's nothing
    // left to do (see the module comment above `DOWNLOAD_COOLDOWN_MS`).
    if (isCached(id)) {
      if (DEBUG) {
        console.log(`ensureCached debug: cache hit for "${id}" after waiting in queue`);
      }
      return cachedFilePath(id);
    }

    const song = await findSong(id);
    if (!song) {
      return null;
    }

    if (DEBUG) {
      console.log(`ensureCached debug: cache miss for "${id}", downloading...`);
    }

    for (const [i, candidate] of song.audio.entries()) {
      // Explicit short-path before every attempt, not just relied on
      // implicitly via "we already returned once one succeeded" — cheap,
      // and correct even if this ever stops being the only writer.
      if (isCached(id)) {
        return cachedFilePath(id);
      }
      const filePath = await attemptOneCandidate(id, candidate.videoId);
      if (filePath) {
        console.log(`ensureCached: url ${i + 1} loaded successfully for "${id}"`);
        return filePath;
      }
      if (i < song.audio.length - 1) {
        console.warn(
          `ensureCached: url ${i + 1} skipped for "${id}", trying url ${i + 2}...`,
        );
      }
    }
    console.warn(`ensureCached: all ${song.audio.length} candidate(s) failed for "${id}"`);
    return null;
  };

  // Chain this call onto the tail (waits for whatever's already queued),
  // then immediately advance the tail to this one's completion — the
  // `.then(() => {}, () => {})` form swallows any rejection so one failed
  // download never breaks the chain for whatever's queued after it. No
  // `await` sits between reading `downloadQueueTail` and reassigning it, so
  // two requests arriving "at once" can never both read the same stale
  // tail: JavaScript runs this synchronous stretch to completion before any
  // other async task gets a turn, so whichever call's turn comes first
  // always leaves the correct, updated tail for the next one to chain onto.
  const queued = downloadQueueTail.then(runTurn, runTurn);
  downloadQueueTail = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export async function evictCached(id: string): Promise<boolean> {
  const path = cachedFilePath(id);
  if (!existsSync(path)) {
    return false;
  }
  await unlink(path);
  return true;
}
