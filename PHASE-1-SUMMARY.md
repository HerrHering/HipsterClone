# Phase 1 MVP — Walkthrough

This picks up where `PHASE-ONE-SUMMARY.md` (Phase 0) left off. Phase 0 built the scaffold with everything stubbed out; Phase 1 makes it real for a handful of hand-picked songs: you download them by hand, a small script turns your spreadsheet into `manifest.json`, and the web app fetches that file and plays the songs. No automated searching yet — that's Phase 2.

Read this top to bottom once, then use the **"How to add songs"** section at the end as your day-to-day reference.

---

## Part 1: getting real audio files onto your disk (no code — just two CLI tools)

### Install the tools once

```bash
sudo apt install ffmpeg
pipx install yt-dlp
```

- **`ffmpeg`** is the Swiss-army-knife of audio/video processing. We don't call it directly — `yt-dlp` calls it internally to convert the downloaded video into an mp3 and to cut it down to length.
- **`yt-dlp`** is a command-line YouTube downloader. `pipx` installs Python command-line tools into their own isolated environment so they don't clash with other Python installs on your system — if you don't have `pipx`, `pip install --user -U yt-dlp` works too.

### Download one song

Find the song on YouTube, look at the URL: `https://www.youtube.com/watch?v=`**`dQw4w9WgXcQ`** — that 11-character code after `v=` is the _video id_, and it's all you need. Then, from the repo root:

```bash
python3 -m yt_dlp -x --audio-format mp3 \
  --js-runtimes node \
  --remote-components ejs:github \
  --cookies-from-browser firefox \
  --download-sections "*0:00-5:00" \
  -o "apps/web/public/audio/<song-name>.%(ext)s" \
  "https://www.youtube.com/watch?v=<song-url>"
```

What each flag does:

- **`-x --audio-format mp3`** — "extract just the audio, and convert it to mp3" (the video itself is discarded).
- **`--download-sections "*0:00-5:00"`** — only download the first 5 minutes. This is a safety net, not a requirement — if the song is 3 minutes long you just get all 3; this only matters if someone uploaded, say, a 40-minute video under that song's name.
- **`-o "apps/web/public/audio/<song-id>.%(ext)s"`** — the output filename. `%(ext)s` is a yt-dlp placeholder that gets replaced with `mp3`. `<song-id>` is a short id _you_ choose for this song (e.g. `queen-bohemian-rhapsody`) — lowercase, no spaces, safe to use in a filename and a URL. **You must reuse this exact id in the CSV in Part 2.**

Run that once per song. Each run leaves one file behind: `apps/web/public/audio/<song-id>.mp3`.

---

## Part 2: `tools/scraper/data/songs.csv` — the spreadsheet of truth

Open this file in any text editor (or a real spreadsheet app that can save as CSV). It's just:

```csv
id,title,artist,year
queen-bohemian-rhapsody,Bohemian Rhapsody,Queen,1975
```

CSV ("comma-separated values") is the simplest possible spreadsheet format — one line per row, commas separate the columns, and the first line names the columns. Add one row per song you downloaded in Part 1. The `id` column **must exactly match** the `<song-id>` you used in the `yt-dlp` filename — that's how the script in Part 3 connects a CSV row to its audio file.

---

## Part 3: the scraper script — turning the CSV into `manifest.json`

Run it with:

```bash
npm run scrape
```

(root-level convenience script — it just runs `npm run scrape -w tools/scraper`, which runs `tsx src/index.ts` inside `tools/scraper`). Now the interesting part: what that script (`tools/scraper/src/index.ts`) actually does, line by line.

### Path setup

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = resolve(here, "../data/songs.csv");
const audioDir = resolve(here, "../../../apps/web/public/audio");
const manifestPath = resolve(here, "../../../apps/web/public/manifest.json");
```

- **`import.meta.url`** — every JS module (when loaded as ESM, which this whole project uses) has this built-in property: the file's own location, as a `file://...` URL. It's how a script finds _itself_ on disk.
- **`fileURLToPath(...)`** — converts that `file://...` URL into an ordinary filesystem path string (e.g. `/home/you/HipsterClone/tools/scraper/src/index.ts`). This conversion is necessary because URLs and file paths are formatted differently (URLs use `%20` for spaces, drive letters differ on Windows, etc.) — this function from Node's built-in `url` module handles those differences correctly.
- **`dirname(...)`** — strips the filename, leaving just the containing folder.
- **`resolve(here, "../data/songs.csv")`** — starts at `here` (the `src/` folder) and walks up/down according to the given relative path, the same way `cd` would, producing one clean absolute path. `..` means "go up one folder." This is done relative to _the script's own location_, not to whatever folder you happened to run the command from — so `npm run scrape` works correctly whether you run it from the repo root or from inside `tools/scraper`.

### Reading and parsing the CSV

```ts
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

const csvText = await readFile(csvPath, "utf-8");
const rows: SongRow[] = parse(csvText, {
  columns: true,
  skip_empty_lines: true,
});
```

- **`readFile(csvPath, "utf-8")`** — reads the whole file into a string. It's `async` (see below), so we `await` it.
- **`parse(csvText, { columns: true, ... })`** — the `csv-parse` library turns the raw CSV text into an array of objects. `columns: true` is what tells it "use the first row as property names" — so each row becomes e.g. `{ id: "queen-bohemian-rhapsody", title: "Bohemian Rhapsody", artist: "Queen", year: "1975" }` instead of a plain array of strings.
- **`async` / `await`** — reading a file is an operation that takes real time (the disk has to respond), so Node doesn't make your whole program freeze while it happens. `readFile` returns a `Promise` (a placeholder for "a value that will exist soon"), and `await` is the keyword that says "pause _this function_ until that promise resolves, then give me the real value." Any function that uses `await` must itself be declared `async` — that's why `main()` in this file is `async function main()`.

### Turning rows into manifest entries

```ts
const entries: SongManifestEntry[] = [];

for (const row of rows) {
  const audioPath = resolve(audioDir, `${row.id}.mp3`);
  if (!existsSync(audioPath)) {
    console.warn(`skipping "${row.id}": no audio file at ${audioPath}`);
    continue;
  }

  entries.push({
    id: row.id,
    title: row.title,
    artist: row.artist,
    year: Number(row.year),
    audio: { kind: "local-file", ref: `/audio/${row.id}.mp3` },
  });
}
```

- **`` `${row.id}.mp3` ``** — a **template literal**. Backticks let you embed a value directly inside a string with `${...}`, instead of writing `row.id + ".mp3"`. Much easier to read once there's more than one piece being joined.
- **`existsSync(audioPath)`** — a synchronous (no `await` needed) check: "is there really a file at this path?" This is the check that connects Part 1 and Part 2 — if you added a CSV row but forgot to run the `yt-dlp` command (or used a different id), this catches it.
- **`continue`** — skips the rest of _this_ loop iteration and moves on to the next row, without adding anything to `entries`. Combined with `console.warn` instead of throwing an error, one bad row doesn't stop the other songs from working.
- **`Number(row.year)`** — every value coming out of a CSV is a plain string (`"1975"`, not `1975`), because CSV has no concept of types. `Number(...)` converts it to an actual JS number so it matches the `year: number` field in the `SongManifestEntry` type from `packages/shared`.
- **`audio: { kind: "local-file", ref: "/audio/<id>.mp3" }`** — note this is a **web path** (`/audio/...`), not a filesystem path. It's what the _browser_ will use to fetch the file over HTTP once the app is running — and it works because Vite serves everything under `apps/web/public/` at the site's root (that's also why `favicon.svg` at `apps/web/public/favicon.svg` is reachable as `/favicon.svg`).

### Writing the manifest

```ts
const manifest = await buildManifest(entries, manifestPath);
console.log(`wrote ${manifest.songs.length} song(s) to ${manifestPath}`);
```

`buildManifest` (in `tools/scraper/src/buildManifest.ts`) does the last step:

```ts
export async function buildManifest(entries, outPath) {
  const manifest = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    songs: entries,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  return manifest;
}
```

- **`new Date().toISOString()`** — the current date/time, in a standard, sortable, unambiguous text format (e.g. `2026-09-01T17:13:48.346Z`).
- **`mkdir(..., { recursive: true })`** — creates the destination folder if it doesn't exist yet. `recursive: true` means "and create any missing parent folders too," and it also means "don't error if the folder already exists" — both are exactly what you want for "make sure this folder is there," as opposed to "create this folder and fail if it already is."
- **`JSON.stringify(manifest, null, 2)`** — converts the JS object into JSON text. The `2` means "indent nested content with 2 spaces," which is what makes the resulting `manifest.json` file human-readable instead of one giant single line. (The `null` in the middle is an advanced filtering option we're not using here.)

---

## Part 4: `apps/web/src/App.tsx` — loading and showing the songs

Phase 0's `App.tsx` had a hardcoded, always-empty song list. Now it actually fetches `manifest.json` at runtime and reacts to what comes back.

### State: what can this component be showing right now?

```tsx
type ManifestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: SongManifest };

const [state, setState] = useState<ManifestState>({ status: "loading" });
```

This is the same "discriminated union" pattern from `packages/shared/src/types/protocol.ts` (see Phase 0's summary) — `ManifestState` can be _exactly one_ of three shapes, distinguished by its `status` field. It's a clean way to represent "still loading" / "something went wrong" / "here's the data" without a pile of `if (loading) ... if (error) ...` flags that could contradict each other.

**`useState<ManifestState>({ status: "loading" })`** is a React **hook** — a special function (always starting with `use`) that lets a plain function component have memory across re-renders. It returns a pair: the current value (`state`) and a function to change it (`setState`). Calling `setState(newValue)` does two things: updates what `state` will be, _and_ tells React "please re-run this component function so the screen reflects the new value." Without hooks, a function component would forget everything and start fresh every time it re-rendered — `useState` is what makes "this song is currently selected" possible to represent at all.

We also track which song is currently selected the same way:

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null);
```

### Effect: fetching the manifest once, when the component first appears

```tsx
useEffect(() => {
  fetch("/manifest.json")
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
```

- **`useEffect(fn, [])`** — another hook: "after this component renders, run `fn` once." The second argument (`[]`, an empty array) is the _dependency list_ — React re-runs the effect only when something in that list changes; an empty list means "there's nothing to watch, so only run this once, right after the first render." This is the standard React pattern for "fetch data when the page loads."
- **`fetch("/manifest.json")`** — the browser's built-in function for making an HTTP request. It also returns a `Promise` (same concept as `readFile` above), but here we're chaining `.then(...)` instead of using `await`, because you can't mark a `useEffect` callback itself `async` — `.then()` is the older, equivalent way of saying "when this promise resolves, run this next step."
- **`res.ok`** / **`res.status`** — `fetch` treats a 404 or 500 response as a "successful" promise (the request _did_ complete — the server just said "not found"), so you have to explicitly check `res.ok` and throw yourself if it's a failure. This matters here: while you haven't run `npm run scrape` yet, or before the dev server has ever seen the file, `manifest.json` won't exist and this is exactly the path that catches it.
- **`res.json()`** — parses the response body as JSON, returning yet another promise (reading the body is itself an async operation).
- **`.catch(...)`** — runs if _any_ `.then()` in the chain threw or rejected, so both "the network request itself failed" and "we threw because `res.ok` was false" land here. `error: unknown` (not `error: any`) is a deliberate TypeScript choice — you're forced to check what kind of thing `error` actually is (`error instanceof Error`) before using it, rather than trusting it blindly. That check exists because in JavaScript, _anything_ can be thrown, not just `Error` objects — `unknown` makes that reality visible in the type system instead of hiding it.

### Rendering: turning `state` into what's on screen

```tsx
{
  state.status === "loading" && <p>Loading songs…</p>;
}

{
  state.status === "error" && (
    <p>
      Couldn't load manifest.json ({state.message}). Run{" "}
      <code>npm run scrape</code> first.
    </p>
  );
}

{
  state.status === "ready" && (
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
  );
}
```

- **`{condition && <jsx />}`** — a common JSX trick: `&&` short-circuits, so if `condition` is `false`, the right side never evaluates and React renders nothing there; if it's `true`, it renders the JSX. Combined with the `status` checks, exactly one of the three blocks ever shows.
- **`state.status === "ready" && (... state.manifest.songs ...)`** — this is why the discriminated union in Part 4's first section is worth it: _inside_ this block, TypeScript knows `state` must be the `"ready"` variant (the only one with a `manifest` field), and lets you write `state.manifest` with no error, even though `state` in general might not have that field.
- **`<>...</>`** — a **React Fragment**: JSX requires every block to return one single wrapping element, but you don't always want an extra `<div>` in the actual page. `<>...</>` groups multiple elements (here, the `<p>` and the `<ul>`) without adding one.
- **`.map((song) => ...)`** — the standard way to turn an array into a list of JSX elements: run this function once per array item, collect the results. `key={song.id}` is required by React on anything produced by `.map()` — it's how React tells "this specific list item" apart from the others across re-renders (e.g. if the order changes later), and it must be something stable and unique — the song's own `id` fits perfectly.
- **`onClick={() => setSelectedId(song.id)}`** — note the `() =>` wrapping. `onClick={setSelectedId(song.id)}` (without the arrow function) would _call_ `setSelectedId` immediately while rendering, not when clicked — wrapping it in `() => ...` creates a new function that only runs `setSelectedId(song.id)` when the click actually happens.
- **`selectedId === song.id && (...)`** — the click handler doesn't play audio itself; it just records _which_ song is selected. Then, for the one `<li>` whose `song.id` matches `selectedId`, this condition is true and an `<audio>` element appears for it.
- **`<audio controls src={song.audio.ref} />`** — a native HTML element, not something React invented. `controls` gives it a built-in play/pause/seek bar (no extra code needed), and `src` points at the file (`/audio/<id>.mp3`) — the same path the scraper wrote into the manifest. This is genuinely playing your locally downloaded mp3, over your own dev server, entirely offline-capable — no YouTube, no ads, no network dependency at play time.

---

## How to add songs (your day-to-day reference)

1. `yt-dlp -x --audio-format mp3 --download-sections "*0:00-5:00" -o "apps/web/public/audio/<song-id>.%(ext)s" "https://www.youtube.com/watch?v=<video-id>"`
2. Add a row to `tools/scraper/data/songs.csv`: `<song-id>,<title>,<artist>,<year>` — the id must match step 1 exactly.
3. `npm run scrape` — regenerates `apps/web/public/manifest.json`. Watch the output; a `skipping "..."` warning means step 1 and step 2's id didn't match, or the download failed.
4. `npm run dev` — open the printed `localhost` URL, click a song, confirm it plays.

Both `apps/web/public/audio/` and `apps/web/public/manifest.json` are git-ignored (see the root `.gitignore`) — they're _generated_, regenerable any time from `songs.csv` plus your downloaded mp3s. Only `songs.csv` is the real, tracked source of truth for which songs are in the game.

## What's next

Phase 2 replaces step 1 above with automation: given just a title and artist, `resolveSource.ts` will search YouTube itself and score candidates by similarity, and `downloadClip.ts` will download and trim automatically — turning "download and add one song" from a manual multi-step process into something a batch script can do for hundreds of songs unattended. Everything downstream (the CSV shape's replacement, `buildManifest.ts`, and all of `App.tsx`) stays exactly as it is now.
