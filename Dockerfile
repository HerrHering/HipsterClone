# Multi-stage build: compile everything with full devDependencies available,
# then ship a slimmer runtime image with only what's needed to actually run
# the game server (Node + ffmpeg + a fresh yt-dlp).

FROM node:22-slim AS build
WORKDIR /app

# Copied separately from the rest of the source so `npm ci` is only
# re-run when a package.json/lockfile actually changes, not on every
# source edit (standard Docker layer-caching trick).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY tools/scraper/package.json tools/scraper/package.json
RUN npm ci

# Everything else, including the gitignored-but-required
# apps/web/public/manifest.json (see .dockerignore — it is deliberately
# NOT excluded) generated ahead of time by `npm run scrape`.
COPY . .
RUN npm run build

# --- runtime image ---
FROM node:22-slim
WORKDIR /app

# ffmpeg: yt-dlp needs it to extract/convert audio.
# python3 + pip: to install a fresh yt-dlp into its own venv, exactly
# mirroring downloadClip.ts's own preference for `.venv/bin/yt-dlp` over
# a (likely stale) OS package — YouTube's JS challenges need a recent build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /app/.venv \
  && /app/.venv/bin/pip install --no-cache-dir -U yt-dlp

# Only the compiled output + runtime dependencies — no source, no
# devDependencies, no build tools left in the final image.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace=@hipster-clone/api --workspace=@hipster-clone/shared

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
# cache.ts reads the manifest from apps/web/public (not the built dist
# copy Vite already made) — see its own `manifestPath` comment.
COPY --from=build /app/apps/web/public/manifest.json apps/web/public/manifest.json

ENV NODE_ENV=production
EXPOSE 5174
CMD ["node", "apps/api/dist/server.js"]
