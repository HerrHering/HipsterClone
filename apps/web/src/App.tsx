import { useEffect, useState } from "react";
import type { SongManifest } from "@hipster-clone/shared";

type ManifestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: SongManifest };

function App() {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
            {state.manifest.songs.map((song) => (
              <li key={song.id}>
                <button onClick={() => setSelectedId(song.id)}>
                  {song.title} — {song.artist} ({song.year})
                </button>
                {selectedId === song.id && (
                  <div>
                    <audio controls src={song.audio.ref} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

export default App;
