import { useEffect, useState } from "react";
import type { SongManifest } from "@hipster-clone/shared";

type ManifestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: SongManifest };

// SERVER API REQUEST — not a static file, and not a local filesystem path
// (there's no browser-side filesystem to speak of). This URL is proxied
// (in dev, via vite.config.ts) or served directly (in production) by
// apps/api, which transparently downloads on first request and just serves
// the cached file after that — the browser can't tell the difference from a
// plain static file, it just sees an HTTP response arrive eventually.
function audioSrc(song: SongManifest["songs"][number]): string {
  return `/api/audio/${song.id}`;
}

function App() {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // STATIC FILE, not an api request — this hits apps/web/public/manifest.json
    // directly (served by Vite in dev, or as a plain file in a production
    // build). It never touches apps/api at all, unlike every `/api/...` call
    // below this point.
    fetch("/manifest.json")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<SongManifest>;
      })
      .then((manifest) => setState({ status: "ready", manifest }))
      .catch((error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    // Empty dependency array: run this fetch exactly once, when the
    // component first mounts, not on every re-render.
  }, []);

  const refreshCachedIds = () => {
    // SERVER API REQUEST — hits apps/api, which answers from the actual
    // contents of its cache directory on disk (see cache.ts's listCachedIds).
    fetch("/api/cached-ids")
      .then((res) => res.json() as Promise<string[]>)
      .then((ids) => setCachedIds(new Set(ids)))
      .catch((error: unknown) => {
        // The api server may not be running yet (or just hiccuped) — the
        // cache-status badges simply won't update until the next successful
        // call. Not worth alarming a normal session over, but worth seeing
        // in DevTools if you're actually debugging: unlike the Node-side
        // HIPSTER_DEBUG flag, there's no separate opt-in flag for the
        // browser console — it's already a low-noise, open-it-if-you-need-it
        // surface, so this just always logs there.
        console.debug("refreshCachedIds failed:", error);
      });
  };

  useEffect(refreshCachedIds, []);

  const deleteCached = (id: string) => {
    // SERVER API REQUEST — asks apps/api to delete that song's cached mp3.
    fetch(`/api/audio/${id}`, { method: "DELETE" })
      .then(refreshCachedIds)
      .catch((error: unknown) => {
        console.debug(`deleteCached(${id}) failed:`, error);
      });
  };

  const setPending = (id: string, isPending: boolean) => {
    setPendingIds((prev) => {
      // Copy-then-mutate-the-copy, not mutate `prev` directly: React compares
      // state by reference, so mutating the existing Set in place wouldn't
      // be detected as a change and the UI wouldn't re-render.
      const next = new Set(prev);
      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const selectSong = (song: SongManifest["songs"][number]) => {
    setSelectedId(song.id);

    // Trigger (and await) the download explicitly here, rather than relying
    // on the <audio> element's own request — that only starts once it's
    // mounted below, and its load/play events are unreliable signals of
    // exactly when the server-side download actually finished.
    if (!cachedIds.has(song.id)) {
      setPending(song.id, true);
      // SERVER API REQUEST — POSTing here is what actually kicks off the
      // yt-dlp download server-side; nothing is streamed back in the
      // response, we just wait for it to finish, then refresh the badges.
      fetch(`/api/audio/${song.id}/prefetch`, { method: "POST" })
        .then(refreshCachedIds)
        .catch((error: unknown) => {
          console.debug(`prefetch for "${song.id}" failed:`, error);
        })
        .finally(() => setPending(song.id, false));
    }
  };

  return (
    <main>
      <h1>HipsterClone</h1>

      {state.status === "loading" && <p>Loading songs…</p>}

      {state.status === "error" && (
        <p>
          Couldn't load manifest.json ({state.message}). Run{" "}
          <code>npm run scrape</code> first.
        </p>
      )}

      {state.status === "ready" && (
        <>
          <p>{state.manifest.songs.length} songs loaded.</p>
          <ul>
            {state.manifest.songs.map((song) => {
              const isCached = cachedIds.has(song.id);
              const isPending = pendingIds.has(song.id);

              return (
                <li key={song.id}>
                  <button onClick={() => selectSong(song)}>
                    {song.title} — {song.artist} ({song.year})
                  </button>{" "}
                  {isCached ? (
                    <>
                      <span>cached ✓</span>{" "}
                      <button onClick={() => deleteCached(song.id)}>
                        remove cached copy
                      </button>
                    </>
                  ) : isPending ? (
                    <span>downloading…</span>
                  ) : (
                    <span>will download on first play</span>
                  )}
                  {selectedId === song.id && (
                    <div>
                      <audio
                        controls
                        src={audioSrc(song)}
                        onPlay={refreshCachedIds}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}

export default App;
