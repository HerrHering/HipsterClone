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
Resolves every `tools/scraper/data/active_*.csv` file (already tracked in git) into `apps/web/public/manifest.json`. Search-only — **no cookies needed** for this step.
Edit `active_songs.csv` to add or remove songs by hand! See **[Song lists](#song-lists-turning-a-collection-on-or-off)** below for the full active/inactive convention.

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
# 1. add a row to any tools/scraper/data/active_*.csv: artist,title,year (all three, required)
# 2. re-resolve (only new rows are searched):
npm run scrape
# 3. if a match is wrong, hand-edit that song's videoId directly in apps/web/public/manifest.json
#    — it sticks across future scrapes as long as artist/title/year don't change
```

## Song lists: turning a collection on or off

Song lists live in `tools/scraper/data/`, one CSV per collection, each named `active_<name>.csv` or `inactive_<name>.csv` — the prefix decides whether its songs are playable.

```bash
# add a whole new collection:
#   tools/scraper/data/active_80s_hits.csv   (artist,title,year header, same as active_songs.csv)
npm run scrape

# turn a collection off (its songs stop being picked, but stay in manifest.json):
mv tools/scraper/data/active_80s_hits.csv tools/scraper/data/inactive_80s_hits.csv
npm run scrape

# turn it back on later — instant, no re-resolving:
mv tools/scraper/data/inactive_80s_hits.csv tools/scraper/data/active_80s_hits.csv
npm run scrape
```
- Only `active_*.csv` files are ever read by the scraper. An `inactive_*.csv`'s songs are resolved lazily — nothing happens to them until the file is renamed to `active_` and rescraped.
- Deactivating is cheap either way: song ids are derived from `artist-title-year`, not the filename, so a rename never triggers a re-search — the scraper just flips that song's `active` flag in `manifest.json` and reuses its already-resolved YouTube link.
- Once a song has ever been active, it stays in `manifest.json` forever (flagged `active: false` when its list is off) instead of being deleted — this is what makes reactivating instant. To truly remove a song forever, hand-delete its entry from `manifest.json` directly, same as the videoId-override workflow above.
- `apps/api` only ever picks/plays `active: true` songs; a room already in progress isn't affected by a rescrape — start a new room to pick up a list you just toggled.

## Debugging

```bash
npm run dev:debug      # = HIPSTER_DEBUG=1 npm run dev
npm run scrape:debug   # = HIPSTER_DEBUG=1 npm run scrape
```
Shows every yt-dlp candidate considered, cache hits/misses, the exact download command, every HTTP request, and otherwise-silent errors.

## Before opening a PR

```bash
npm test       # runs the automated test suite
npm run build   # type-checks + builds all three real workspaces
npm run lint    # oxlint on apps/web
```
All three must pass clean.

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
  data/active_*.csv, inactive_*.csv  # song collections you hand-edit — see "Song lists" below
node_modules/          # generated (step 4) — git-ignored, platform-specific
.venv/                 # generated (step 3) — git-ignored, platform-specific
cookies.txt            # hosting only, not dev — git-ignored, see HOSTING.md
```

## Hosting for a game night

`npm run dev` is enough for local dev. To package with Docker and expose it to friends via Tailscale Funnel, see **[HOSTING.md](HOSTING.md)**.
