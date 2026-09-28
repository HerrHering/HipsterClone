import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { errorMessage } from "@hipster-clone/shared";

// `promisify` turns execFile's callback-style API into one that returns a
// Promise, so it can be `await`ed below instead of nesting a callback.
const execFileAsync = promisify(execFile);

// `import.meta.url` is this file's own `file://...` location; converting it
// to a plain path is how this file finds the repo root relative to itself,
// regardless of which directory `npm run dev` happens to be invoked from.
const here = dirname(fileURLToPath(import.meta.url));
// LOCAL FILESYSTEM PATH — never sent anywhere, just used to locate .venv below.
const repoRoot = resolve(here, "../../..");

// yt-dlp needs a recent build to solve YouTube's JS signature challenges —
// prefer the project's own .venv (python3 -m venv .venv && .venv/bin/pip
// install -U yt-dlp) if one exists, falling back to PATH otherwise.
// LOCAL FILESYSTEM PATH — the on-disk location of an executable.
const venvYtDlp = resolve(repoRoot, ".venv/bin/yt-dlp");
const YTDLP_BIN = existsSync(venvYtDlp) ? venvYtDlp : "yt-dlp";

// Off by default. Set HIPSTER_DEBUG=1 (e.g. `HIPSTER_DEBUG=1 npm run dev`) to
// print the exact yt-dlp command run for each download and its outcome.
const DEBUG = process.env.HIPSTER_DEBUG === "1";

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

/**
 * Downloads audio for a resolved YouTube video id via `yt-dlp`, saving it to
 * <cacheDir>/<songId>.mp3. Besides the JS-challenge flags above, YouTube also
 * demands proof the request isn't a bot, which yt-dlp satisfies by borrowing
 * cookies from a real logged-in browser session (--cookies-from-browser).
 * Which browser is available varies per machine/friend, so it's configurable
 * via the YTDLP_COOKIES_BROWSER env var (defaults to "firefox"; set to "none"
 * to skip cookies entirely, e.g. on a machine where downloads work without them).
 *
 * A headless server/container has no real logged-in browser profile to read
 * from at all — for that case, YTDLP_COOKIES_FILE points at a `cookies.txt`
 * exported ahead of time (e.g. `yt-dlp --cookies-from-browser firefox
 * --cookies cookies.txt --skip-download <url>` run once on a machine that
 * already has a working browser), and takes priority over
 * YTDLP_COOKIES_BROWSER when set.
 */
export async function downloadClip(
  songId: string,
  videoId: string,
  cacheDir: string,
): Promise<{ filePath: string } | null> {
  // Defense in depth: videoId always comes from resolveSource's own output
  // today, never directly from user input, but checking its shape here
  // means this function is safe to call from anywhere in the future too,
  // without having to re-audit every caller.
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    console.warn(`downloadClip: refusing suspicious video id "${videoId}"`);
    return null;
  }

  // LOCAL FILESYSTEM PATH — cacheDir is a directory on this machine's disk
  // (apps/api/data/cache); create it if this is the very first download.
  await mkdir(cacheDir, { recursive: true });

  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  const cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER ?? "firefox";
  const cookieArgs = cookiesFile
    ? ["--cookies", cookiesFile]
    : cookiesBrowser && cookiesBrowser !== "none"
      ? ["--cookies-from-browser", cookiesBrowser]
      : [];

  const args = [
    // Without this, yt-dlp defaults to picking the single best overall
    // (video+audio) format, then -x below throws away the video it just
    // downloaded — wasteful, and for some videos that "best overall" pick is
    // itag 18, YouTube's legacy progressive 360p format, which is
    // specifically known to be throttled/dropped by YouTube's web client
    // partway through a download (confirmed: a real download reproducibly
    // failed at the exact same byte offset twice in a row). Requesting an
    // audio-only adaptive stream up front sidesteps that format entirely for
    // any video that has one, which is effectively all of them.
    "-f",
    "bestaudio/best",
    "-x",
    "--audio-format",
    "mp3",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    ...cookieArgs, // spread: splices the 0 or 2 cookie-flag elements in here
    "--download-sections",
    "*0:00-5:00",
    "-o",
    // LOCAL FILESYSTEM PATH — yt-dlp's own `%(ext)s` placeholder syntax; it
    // fills in the real extension (".mp3") itself once the download finishes,
    // this is just the output template we're asking it to write to.
    resolve(cacheDir, `${songId}.%(ext)s`),
    // REAL EXTERNAL URL — the only one in this file. This is what actually
    // gets requested over the network (by yt-dlp, not by this Node process
    // directly — execFileAsync just launches yt-dlp as a subprocess).
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  if (DEBUG) {
    console.log(`downloadClip debug: ${YTDLP_BIN} ${args.join(" ")}`);
  }

  try {
    await execFileAsync(YTDLP_BIN, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    // A failed download is a real, user-visible problem (that song won't
    // play), not a normal/expected outcome — always worth a warning. Under
    // debug, also show the full error object (e.g. stderr/stack), not just
    // the one-line message.
    console.warn(
      `downloadClip: yt-dlp failed for "${songId}" (${videoId}): ${errorMessage(error)}`,
    );
    if (DEBUG) {
      console.error(error);
    }
    return null;
  }

  // LOCAL FILESYSTEM PATH — where the downloaded mp3 should now be sitting.
  const filePath = resolve(cacheDir, `${songId}.mp3`);
  const result = existsSync(filePath) ? { filePath } : null;

  if (DEBUG) {
    console.log(
      result
        ? `downloadClip debug: wrote ${filePath}`
        : `downloadClip debug: yt-dlp exited cleanly but ${filePath} is missing`,
    );
  }

  return result;
}
