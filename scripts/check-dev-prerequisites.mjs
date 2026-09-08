import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const localYtDlp = resolve(repoRoot, ".venv/bin/yt-dlp");
const ytDlp = existsSync(localYtDlp) ? localYtDlp : "yt-dlp";

function isAvailable(command, versionArgument = "--version") {
  try {
    execFileSync(command, [versionArgument], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const missing = [];

if (!isAvailable("ffmpeg", "-version")) {
  missing.push("ffmpeg");
}

if (!isAvailable(ytDlp)) {
  missing.push("yt-dlp");
}

if (missing.length === 0) {
  process.exit(0);
}

console.error(`Cannot start development servers: missing ${missing.join(" and ")}.`);

if (missing.includes("ffmpeg")) {
  if (process.platform === "darwin") {
    console.error("Install it with: brew install ffmpeg");
  } else {
    console.error("Install it with: sudo apt install -y ffmpeg");
  }
}

if (missing.includes("yt-dlp")) {
  console.error("Install it with: make install-ytdlp");
}

console.error("See README.md, ‘Install prerequisites’, for the full setup.");
process.exit(1);
