import { existsSync, readdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

// Tracks a download already in progress per id, so two near-simultaneous
// callers (e.g. the UI's explicit prefetch call and the <audio> element's own
// request, both firing right after a song is selected) share one yt-dlp run
// instead of racing to write the same output file twice. Keyed by id,
// valued by the in-flight Promise itself — a second caller just awaits the
// same Promise instead of starting a second download.
const inFlightDownloads = new Map<string, Promise<string | null>>();

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

  const inFlight = inFlightDownloads.get(id);
  if (inFlight) {
    return inFlight;
  }

  if (DEBUG) {
    console.log(`ensureCached debug: cache miss for "${id}", downloading...`);
  }

  // Wrapped in an immediately-invoked async function so the Promise it
  // produces can be stored in `inFlightDownloads` *before* anything inside
  // it actually finishes — that's what lets a second caller find and await
  // it below instead of racing to start their own download.
  const download = (async () => {
    const song = await findSong(id);
    if (!song) {
      return null;
    }
    const result = await downloadClip(id, song.audio.videoId, cacheDir);
    return result?.filePath ?? null;
  })();

  inFlightDownloads.set(id, download);
  try {
    return await download;
  } finally {
    // Runs whether the download succeeded or failed — either way, the next
    // caller for this id should start fresh rather than await a Promise
    // that's already settled.
    inFlightDownloads.delete(id);
  }
}

export async function evictCached(id: string): Promise<boolean> {
  const path = cachedFilePath(id);
  if (!existsSync(path)) {
    return false;
  }
  await unlink(path);
  return true;
}
