import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAction } from "@hipster-clone/shared";
import { errorMessage } from "@hipster-clone/shared";
import express from "express";
import { ensureCached, evictCached, listCachedIds } from "./cache.js";
import { applyAction, createRoom, getState, joinRoom } from "./game.js";

const here = dirname(fileURLToPath(import.meta.url));
// LOCAL FILESYSTEM PATH — apps/web's built output, only relevant/present
// after `npm run build`. Not a route or a URL by itself; see the
// `express.static` call near the bottom for where it actually gets served.
const webDistDir = resolve(here, "../../web/dist");

// Off by default. Set HIPSTER_DEBUG=1 to log every request this server
// receives — see the `npm run dev:debug` root script for a shortcut.
const DEBUG = process.env.HIPSTER_DEBUG === "1";

const app = express();
const PORT = Number(process.env.PORT ?? 5174);

// The room routes below take a JSON body (name, action) — none of the
// existing audio routes did, so this middleware is new. `express.json()`
// parses that body into `req.body`; a request with no/invalid JSON body
// just gets `{}`, which the routes below already treat as "missing field."
app.use(express.json());

if (DEBUG) {
  // `app.use` with no path argument runs for every request, before any
  // route below gets a chance to handle it. `res.on("finish", ...)` fires
  // once the response has actually been sent, so this logs the real status
  // code and timing — not just "a request came in" but "here's what
  // happened to it." This is the one thing the other HIPSTER_DEBUG logging
  // doesn't cover: cache.ts/downloadClip.ts already show *why* a request to
  // `/api/audio/:id` was slow or fast, but routes like `/api/cached-ids` or
  // the DELETE endpoint had no visibility at all before this.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `server debug: ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`,
      );
    });
    next();
  });
}

// SERVER API ROUTES — everything below defines an endpoint the browser
// calls as `/api/...`. In dev, Vite proxies those requests here (see
// apps/web/vite.config.ts); in production, this same Express process serves
// both these routes and the static site (see the bottom of this file). None
// of these paths point at anything on disk directly — each handler decides
// what to do (and what filesystem path, if any, to read) itself.

// Which songs currently have cached audio on disk, so the UI can show
// "cached / will download on first play" without guessing.
app.get("/api/cached-ids", (_req, res) => {
  res.json(listCachedIds());
});

// Downloads on first request if not already cached, then serves the file —
// this is the "start empty, fetch on demand, cache after that" behavior.
app.get("/api/audio/:id", async (req, res) => {
  // `ensureCached` resolves to a LOCAL FILESYSTEM PATH (or null) — never a
  // URL; `res.sendFile` below is what turns that local file into an HTTP
  // response body for the browser.
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

// GAME ROOM ROUTES — everything a room's players poll/act through. A
// thrown Error from game.ts here almost always means "this action doesn't
// make sense right now" (wrong turn, stale phase, already used a steal) —
// expected, recoverable client-side situations, not server bugs, so they
// become a plain 400 with the message and only get logged under
// HIPSTER_DEBUG (compare downloadClip.ts's catch, which *is* a genuine
// unexpected failure and always warns).

// Shared by every route below that catches a game.ts rejection — turns it
// into a message, logs it under HIPSTER_DEBUG with whatever `context`
// identifies which route it was, and sends the 400 response.
function rejectAction(res: express.Response, context: string, error: unknown): void {
  const message = errorMessage(error);
  if (DEBUG) {
    console.log(`game debug: ${context} rejected: ${message}`);
  }
  res.status(400).json({ error: message });
}

app.post("/api/rooms", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res.json(createRoom(name));
});

app.post("/api/rooms/:code/join", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    res.json(joinRoom(req.params.code.toUpperCase(), name));
  } catch (error) {
    rejectAction(res, "join", error);
  }
});

// The poll target — every phone in a room GETs this every ~1.5s and
// re-renders from whatever comes back. No playerId needed here: the game is
// played with open cards, so there's nothing in GameState that should be
// hidden from any particular player.
app.get("/api/rooms/:code/state", (req, res) => {
  const state = getState(req.params.code.toUpperCase());
  if (!state) {
    res.status(404).json({ error: `no room with code "${req.params.code}"` });
    return;
  }
  res.json(state);
});

// The one mutation route — every button a player presses (start the game,
// confirm a placement, attempt a steal, reveal, advance the turn, or
// control playback) sends its GameAction here.
app.post("/api/rooms/:code/action", async (req, res) => {
  const { playerId, action } = req.body as {
    playerId?: string;
    action?: GameAction;
  };
  if (!playerId || !action) {
    res.status(400).json({ error: "playerId and action are required" });
    return;
  }
  try {
    const state = await applyAction(
      req.params.code.toUpperCase(),
      playerId,
      action,
    );
    res.json(state);
  } catch (error) {
    rejectAction(res, `action ${action.type}`, error);
  }
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
