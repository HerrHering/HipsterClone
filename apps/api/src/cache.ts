import { existsSync, readdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SongManifest, SongManifestEntry } from "@hipster-clone/shared";
import { downloadClip } from "./downloadClip.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "../../web/public/manifest.json");
export const cacheDir = resolve(here, "../data/cache");

const MP3_SUFFIX = ".mp3";

export async function loadManifest(): Promise<SongManifest> {
  const text = await readFile(manifestPath, "utf-8");
  return JSON.parse(text) as SongManifest;
}

export async function findSong(
  id: string,
): Promise<SongManifestEntry | null> {
  const manifest = await loadManifest();
  return manifest.songs.find((song) => song.id === id) ?? null;
}

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
    .map((name) => name.slice(0, -MP3_SUFFIX.length));
}

// Tracks a download already in progress per id, so two near-simultaneous
// callers (e.g. the UI's explicit prefetch call and the <audio> element's own
// request, both firing right after a song is selected) share one yt-dlp run
// instead of racing to write the same output file twice.
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
    return cachedFilePath(id);
  }

  const inFlight = inFlightDownloads.get(id);
  if (inFlight) {
    return inFlight;
  }

  const download = (async () => {
    const song = await findSong(id);
    if (!song || song.audio.kind !== "embedded-link") {
      return null;
    }
    const result = await downloadClip(id, song.audio.ref, cacheDir);
    return result?.filePath ?? null;
  })();

  inFlightDownloads.set(id, download);
  try {
    return await download;
  } finally {
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
