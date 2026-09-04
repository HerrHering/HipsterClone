import { useEffect, useState } from "react";
import type { SongManifest } from "@hipster-clone/shared";

type ManifestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: SongManifest };

function audioSrc(song: SongManifest["songs"][number]): string {
  return song.audio.kind === "local-file"
    ? song.audio.ref
    : `/api/audio/${song.id}`;
}

function App() {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
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
  }, []);

  const refreshCachedIds = () => {
    fetch("/api/cached-ids")
      .then((res) => res.json() as Promise<string[]>)
      .then((ids) => setCachedIds(new Set(ids)))
      .catch(() => {
        // The api server may not be running yet — local-file songs still work.
      });
  };

  useEffect(refreshCachedIds, []);

  const deleteCached = (id: string) => {
    fetch(`/api/audio/${id}`, { method: "DELETE" }).then(refreshCachedIds);
  };

  const setPending = (id: string, isPending: boolean) => {
    setPendingIds((prev) => {
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
    if (song.audio.kind === "embedded-link" && !cachedIds.has(song.id)) {
      setPending(song.id, true);
      fetch(`/api/audio/${song.id}/prefetch`, { method: "POST" })
        .then(refreshCachedIds)
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
              const isEmbeddedLink = song.audio.kind === "embedded-link";
              const isCached = !isEmbeddedLink || cachedIds.has(song.id);

              const isPending = pendingIds.has(song.id);

              return (
                <li key={song.id}>
                  <button onClick={() => selectSong(song)}>
                    {song.title} — {song.artist} ({song.year})
                  </button>
                  {isEmbeddedLink && (
                    <>
                      {" "}
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
                    </>
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
