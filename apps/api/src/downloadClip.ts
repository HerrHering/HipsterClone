import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// yt-dlp needs a recent build to solve YouTube's JS signature challenges —
// prefer the project's own .venv (python3 -m venv .venv && .venv/bin/pip
// install -U yt-dlp) if one exists, falling back to PATH otherwise.
const venvYtDlp = resolve(repoRoot, ".venv/bin/yt-dlp");
const YTDLP_BIN = existsSync(venvYtDlp) ? venvYtDlp : "yt-dlp";

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

/**
 * Downloads audio for a resolved YouTube video id via `yt-dlp`, saving it to
 * <cacheDir>/<songId>.mp3. Besides the JS-challenge flags above, YouTube also
 * demands proof the request isn't a bot, which yt-dlp satisfies by borrowing
 * cookies from a real logged-in browser session (--cookies-from-browser).
 * Which browser is available varies per machine/friend, so it's configurable
 * via the YTDLP_COOKIES_BROWSER env var (defaults to "firefox"; set to "none"
 * to skip cookies entirely, e.g. on a machine where downloads work without them).
 */
export async function downloadClip(
  songId: string,
  videoId: string,
  cacheDir: string,
): Promise<{ filePath: string } | null> {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    console.warn(`downloadClip: refusing suspicious video id "${videoId}"`);
    return null;
  }

  await mkdir(cacheDir, { recursive: true });

  const cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER ?? "firefox";
  const cookieArgs =
    cookiesBrowser && cookiesBrowser !== "none"
      ? ["--cookies-from-browser", cookiesBrowser]
      : [];

  const args = [
    "-x",
    "--audio-format",
    "mp3",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    ...cookieArgs,
    "--download-sections",
    "*0:00-5:00",
    "-o",
    resolve(cacheDir, `${songId}.%(ext)s`),
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  try {
    await execFileAsync(YTDLP_BIN, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    console.warn(
      `downloadClip: yt-dlp failed for "${songId}" (${videoId}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  const filePath = resolve(cacheDir, `${songId}.mp3`);
  return existsSync(filePath) ? { filePath } : null;
}
