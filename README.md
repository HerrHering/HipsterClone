# HipsterClone

A "Hitster"-style party game: players place song cards on a personal timeline by guessing the year, listening on their own phone. Create a room, share the 4-letter code, everyone joins on their own device.

| Workspace | What it is |
|---|---|
| `apps/web` | Client — Vite + React |
| `apps/api` | Game server — Express (game state + on-demand audio download/cache) |
| `packages/shared` | Shared TypeScript types |
| `tools/scraper` | CSV → `manifest.json` (resolves songs to YouTube links) |

Dev setup only. To host a game night for friends over the internet, do this first, then go to **[HOSTING.md](HOSTING.md)**.

## 1. Install prerequisites

| Tool | Debian/Ubuntu | macOS |
|---|---|---|
| **Node 22** | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs` | `brew install node@22` |
| **Python 3 + venv** | `sudo apt install -y python3 python3-venv` | usually preinstalled |
| **ffmpeg** | `sudo apt install -y ffmpeg` | `brew install ffmpeg` |
| **git** | `sudo apt install -y git` | usually preinstalled |

Check versions:
```bash
node --version   # v22.x
python3 --version
ffmpeg -version
git --version
```

## 2. Clone

```bash
git clone <this-repo-url>
cd HipsterClone
```

> ⚠️ **Moving this project any other way** (zip/USB/`rsync`, not `git clone`)? Do **not** bring `node_modules/`, `.venv/`, or any `dist/` folder — they're compiled/platform-specific and must be regenerated on each machine (steps 3–4 below), never copied. A plain `git clone` never has this problem.

## 3. Set up `yt-dlp`

```bash
python3 -m venv .venv
.venv/bin/pip install -U yt-dlp
```
Why: a system-packaged `yt-dlp` is usually too old for YouTube's current bot-check. The app's own code already looks for `.venv/bin/yt-dlp` first — nothing else to configure.

## 4. Install dependencies

```bash
npm install
```
One command, covers all four workspaces.

## 5. Generate the song catalog

```bash
npm run scrape
```
Resolves `tools/scraper/data/songs.csv` (already tracked in git) into `apps/web/public/manifest.json`. Search-only — **no cookies needed** for this step.
Edit `songs.csv` to add or remove songs by hand!

## 6. Run it

```bash
npm run dev
```
Open `http://localhost:5173`. `apps/web` (`:5173`) and `apps/api` (`:5174`) both start; songs download and cache automatically on first play, using your local browser's cookies (`--cookies-from-browser firefox` by default — see below if that's not your browser).

---

## Common issues / things that have happened before

- **`.venv/bin/yt-dlp` doesn't seem to exist right after step 3.** The `pip install` can take a little while to finish writing the entry-point script — wait for the command to fully finish (no error at the end), then check again:
  ```bash
  ls .venv/bin/yt-dlp && .venv/bin/yt-dlp --version
  ```
  If it's genuinely still missing after that, re-run `.venv/bin/pip install -U yt-dlp`.
- **`Couldn't load manifest.json (404)`** → you skipped step 5, or it failed. Run `npm run scrape:debug` and read its output.
- **`yt-dlp` error: "Sign in to confirm you're not a bot" / a signature-solving error** → your `.venv`'s `yt-dlp` is stale (or you forgot some flags - see later):
  ```bash
  .venv/bin/pip install -U yt-dlp
  ```
- **Port `5173` already in use / `/api` requests fail with a confusing `502`.** Vite refuses to silently move to `5174` (the api's own port) — free up `5173` instead:
  ```bash
  lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
  ```
- **Not using Firefox?** Song downloads use `--cookies-from-browser firefox` by default:
  ```bash
  export YTDLP_COOKIES_BROWSER=chrome   # or edge, brave, safari, ...
  # or, if downloads already work fine without this:
  export YTDLP_COOKIES_BROWSER=none
  ```

## Day-to-day: adding a song

```bash
# 1. add a row to tools/scraper/data/songs.csv: artist,title,year (all three, required)
# 2. re-resolve (only new rows are searched):
npm run scrape
# 3. if a match is wrong, hand-edit that song's videoId directly in apps/web/public/manifest.json
#    — it sticks across future scrapes as long as artist/title/year don't change
```

## Debugging

```bash
npm run dev:debug      # = HIPSTER_DEBUG=1 npm run dev
npm run scrape:debug   # = HIPSTER_DEBUG=1 npm run scrape
```
Shows every yt-dlp candidate considered, cache hits/misses, the exact download command, every HTTP request, and otherwise-silent errors.

## Before opening a PR

```bash
npm run build   # type-checks + builds all three real workspaces
npm run lint    # oxlint on apps/web
```
Both must pass clean. No automated test suite exists yet.

## Project structure

```
apps/
  web/                 # Vite + React client
    public/manifest.json  # generated (step 5) — git-ignored
    dist/                  # generated (npm run build) — git-ignored
  api/                 # Express server
    data/cache/          # downloaded mp3s — git-ignored, regenerates on demand
    dist/                # generated — git-ignored
packages/shared/       # shared TS types
tools/scraper/
  data/songs.csv       # the catalog you hand-edit
node_modules/          # generated (step 4) — git-ignored, platform-specific
.venv/                 # generated (step 3) — git-ignored, platform-specific
cookies.txt            # hosting only, not dev — git-ignored, see HOSTING.md
```

## Hosting for a game night

`npm run dev` is enough for local dev. To package with Docker and expose it to friends via Tailscale Funnel, see **[HOSTING.md](HOSTING.md)**.
