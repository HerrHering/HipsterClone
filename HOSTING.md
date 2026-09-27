# Hosting HipsterClone for a game night

Package the app with Docker and expose it to friends over the internet via [Tailscale Funnel](https://tailscale.com/kb/1223/tailscale-funnel) — no router config, port forwarding, or domain purchase.

**Not needed for development** — see [README.md](README.md) for that.

## 1. On your dev machine: prepare two files

```bash
# manifest.json must already exist (it's git-ignored):
npm run scrape

# export your browser's YouTube cookies to a plain file — the server has
# no real browser to borrow cookies from, unlike local dev:
yt-dlp --js-runtimes node --remote-components ejs:github \
  --cookies-from-browser firefox --cookies cookies.txt --skip-download \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```
- Swap `firefox` for `chrome`/`chromium`/`edge`/`brave`/`opera`/`vivaldi`/`safari` if that's what you use.
- **If the export fails:** fully close that browser first (it can lock its own cookie database while running) and retry.
- Treat `cookies.txt` like a password — it's a real, working login session. Never commit it (already git-ignored). Re-export if downloads ever start failing again (cookies expire).

## 2. Get the repo + those two files onto the server machine

```bash
git clone <your-repo-url> ~/HipsterClone
cd ~/HipsterClone
# then copy cookies.txt and apps/web/public/manifest.json here (scp/USB/shared folder)
```
Don't copy the whole working directory instead of cloning — `node_modules/`, `.venv/`, `dist/` are platform-specific and pointless to bring along; the Docker build regenerates all of them fresh anyway (`.dockerignore` excludes them).

## 3. Install prerequisites on the server machine

Only these three — **not** Node/npm/yt-dlp/ffmpeg, all of that lives inside the Docker image and is built automatically in step 4.

```bash
git --version || sudo apt install -y git   # only if you didn't clone above

curl -fsSL https://get.docker.com | sh
docker --version && docker compose version

curl -fsSL https://tailscale.com/install.sh | sh
```

**Docker permission gotcha:** a fresh install usually only lets `root` run `docker`. Either prefix every command with `sudo`, or:
```bash
sudo usermod -aG docker $USER
newgrp docker   # picks up the group in this shell without logging out
```

## 4. Build and start the server

```bash
# One-time: make the container run as *you*, not root — otherwise every
# song it downloads into apps/api/data/cache/ ends up root-owned on this
# machine, which then blocks a plain (non-Docker) `npm run dev` from ever
# writing to that same folder again. mkdir first so Docker bind-mounts your
# already-correctly-owned directory instead of auto-creating a root-owned
# one on first run.
mkdir -p apps/api/data/cache
printf "HIPSTER_UID=%s\nHIPSTER_GID=%s\n" "$(id -u)" "$(id -g)" > .env

docker compose up -d --build
```
Verify:
```bash
docker compose logs -f                      # Ctrl+C to stop watching
curl http://localhost:5174/api/cached-ids   # should print [] or a list, not an error
```

## 5. Join your tailnet and turn on Funnel

```bash
sudo tailscale up
```
(opens a link to log in). Optionally rename first — see step 7 below, since renaming *after* sharing a link breaks it. Then:
```bash
sudo tailscale funnel 5174
```
First run prints a link to approve enabling HTTPS + Funnel — open it, approve. It then prints your public URL:
```
Available on the internet:
https://hipster.cat-crocodile.ts.net
```
Send that URL to your friends. No Tailscale install or account needed on their end.

---

## Common issues

- **`docker compose` / `docker` commands fail with a permission error on `/var/run/docker.sock`** — see the group fix in step 3.
- **Cookie export (step 1) fails or hangs** — close the browser completely first, then retry.
- **Every song download fails inside the container, even though it worked locally** — check `docker-compose.yml`'s cookies volume is **not** mounted `:ro`. `yt-dlp` rewrites its cookie jar on every run; a read-only mount makes that crash, and every download looks like a failure.
- **`docker compose up --build` fails early / `manifest.json` missing inside the image** — you skipped step 1's `npm run scrape`, or didn't copy the file over in step 2.
- **After a while, downloads start failing with a bot-check error** — cookies expired; redo step 1's export and copy the new `cookies.txt` over, then `docker compose up -d --build`.
- **A local (non-Docker) `npm run dev` on this same machine suddenly can't download any *new* song** (`EACCES: permission denied` in its logs), even though already-cached songs still play fine — `apps/api/data/` got left root-owned by an older Docker run from before step 4's `.env` fix existed. One-time repair:
  ```bash
  sudo chown -R "$(id -u):$(id -g)" apps/api/data
  ```
  Then redo step 4's `.env` file (if missing) and `docker compose up -d --build` so this doesn't happen again.

## 6. Day-to-day

- Survives reboots on its own (`restart: unless-stopped` + Tailscale's own autostart).
- Ship a code update:
  ```bash
  git pull   # or copy changed files over
  docker compose up -d --build
  ```
  Cached songs (`apps/api/data/cache`) survive the rebuild — nothing re-downloads unless you clear that folder.

## 7. Naming the public address (optional)

Address shape: `https://<machine-name>.<tailnet-name>.ts.net` — two independently renameable parts.

```bash
sudo tailscale set --hostname=hipster
```
sets the first part. The second part (`tailnet-name`) is renamed in Tailscale's admin console → DNS page → "Rename tailnet" (pick from generated options, e.g. `cat-crocodile.ts.net`). Do this **before** step 5's `tailscale funnel`, if you care about the final URL — renaming later breaks any link already shared.

---

## Background (optional reading)

**Image vs. container.** An *image* is a frozen snapshot of a whole working machine for this app (Node, ffmpeg, yt-dlp, compiled code), built once from the `Dockerfile`. A *container* is a running instance of it — start/stop/discard freely, the image itself never changes.

**Why the `Dockerfile` copies `package.json` before the rest of the source.** Docker caches each step; changing a source file shouldn't force a slow `npm ci` from scratch, only steps after the change re-run.

**Why `.venv`/`yt-dlp` get reinstalled inside the image.** Same reason as `README.md`'s dev setup — a system-packaged `yt-dlp` is commonly too old for YouTube's current bot-check, and `apps/api/src/downloadClip.ts` already looks for `.venv/bin/yt-dlp` first.

**What Funnel actually is.** Your server makes an *outbound* connection to Tailscale's relay (works through almost any home router/NAT with zero config); the relay forwards public HTTPS traffic down that pipe. Your router never has anything "open." Funnel publishes *only* the one port you turn it on for — nothing else about your tailnet or other devices becomes reachable.

**Security, honestly.** Your home IP is never exposed and the connection is encrypted end-to-end, but Funnel is a pipe, not a firewall for the app itself — the game has no login, just 4-letter room codes. Anyone with the URL who knows/guesses a code can join that room. Fine for a free, low-stakes party game; not access control.
