import type { SongManifest } from "@hipster-clone/shared";

// placeholder manifest shape reference to confirm the shared workspace package resolves;
// real manifest loading arrives once the scraper (Phase 1) produces public/manifest.json
const emptyManifest: SongManifest = {
  version: "0.0.0",
  generatedAt: new Date(0).toISOString(),
  songs: [],
};

function App() {
  return (
    <main>
      <h1>HipsterClone</h1>
      <p>Scaffolding in progress — {emptyManifest.songs.length} songs loaded.</p>
    </main>
  );
}

export default App;
