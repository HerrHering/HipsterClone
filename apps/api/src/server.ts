import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ensureCached, evictCached, listCachedIds } from "./cache.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(here, "../../web/dist");

const app = express();
const PORT = Number(process.env.PORT ?? 5174);

// Which songs currently have cached audio on disk, so the UI can show
// "cached / will download on first play" without guessing.
app.get("/api/cached-ids", (_req, res) => {
  res.json(listCachedIds());
});

// Downloads on first request if not already cached, then serves the file —
// this is the "start empty, fetch on demand, cache after that" behavior.
app.get("/api/audio/:id", async (req, res) => {
  const filePath = await ensureCached(req.params.id);
  if (!filePath) {
    res
      .status(404)
      .json({ error: `no audio available for "${req.params.id}"` });
    return;
  }
  res.sendFile(filePath);
});

// Warms the cache without streaming audio back. Not called from the UI yet —
// this is the ready-made hook a future "prefetch the next song" feature
// would call ahead of playback.
app.post("/api/audio/:id/prefetch", async (req, res) => {
  const filePath = await ensureCached(req.params.id);
  res.json({ cached: filePath !== null });
});

// The "cache it until the user says delete it" control.
app.delete("/api/audio/:id", async (req, res) => {
  const deleted = await evictCached(req.params.id);
  res.status(deleted ? 204 : 404).end();
});

// Serves a built apps/web from this same process/port, so a friend can run
// one server instead of two — but only in an actual production run. Gating
// this on NODE_ENV matters: during `npm run dev`, apps/web/dist is whatever
// stale build happened to be lying around (or missing entirely), while the
// live, always-current app is served by Vite on its own port. Serving that
// stale build here too would let someone land on this port by mistake and
// see confusingly broken/outdated content instead of a clear signal they're
// on the wrong port for dev.
if (process.env.NODE_ENV === "production" && existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
}

app.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
});
