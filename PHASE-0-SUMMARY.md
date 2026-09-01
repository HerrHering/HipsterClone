# Phase 0 Scaffold — Walkthrough

This explains everything set up so far: what each third-party library is *for*, and — since you're new to TypeScript — a proper explanation of every line of custom code we wrote, including the language features it uses. It's ordered the way you'd naturally read the project: root config first, then the two workspace packages, then the web app.

A quick vocabulary note up front, since it underpins everything below: this project is an **npm workspaces monorepo**. Instead of one `package.json` for one project, we have several small packages living in one repo (`apps/web`, `packages/shared`, `tools/scraper`), and npm links them together locally so they can `import` from each other as if they were installed from the internet — without actually publishing anything. That's the whole reason `packages/shared` can define types once and have both `apps/web` and `tools/scraper` use them.

---

## Repo root

### `package.json`
```json
{
  "name": "hipster-clone",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "apps/*",
    "packages/*",
    "tools/*"
  ]
}
```
`"workspaces"` is what turns this into a monorepo: it tells npm "every folder matching `apps/*`, `packages/*`, `tools/*` that has its own `package.json` is a separate package I manage together." When you run `npm install` once at the root, npm reads every one of those `package.json` files, installs all their combined dependencies into a single top-level `node_modules`, and — for packages that reference *each other* (like `apps/web` depending on `@hipster-clone/shared`) — creates a symlink instead of downloading anything. That's why `import { SongManifest } from "@hipster-clone/shared"` works inside `apps/web`: `node_modules/@hipster-clone/shared` is just a symlink pointing at `packages/shared`.

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```
A `tsconfig.json` configures the TypeScript compiler. This one is a *base* file that the other packages' tsconfigs `extend` (inherit from), so we only set these options once. The individually interesting ones:
- **`target: "ES2022"`** — how modern the generated JavaScript is allowed to be (affects what syntax TypeScript will let you compile without extra transformation).
- **`strict: true`** — turns on TypeScript's full strictness (no implicit `any`, no using a possibly-`null` value without checking, etc.). This is the single most important setting for actually catching bugs — it's why we're bothering with TypeScript at all.
- **`noUncheckedIndexedAccess: true`** — a stricter-than-default option. Without it, TypeScript assumes `someRecord[key]` always returns a value; with it, TypeScript makes you handle the case where the key doesn't exist (`value | undefined`). Relevant later because our game state uses `Record<PlayerId, PlayerState>` (a dictionary keyed by player id) — this setting stops us from assuming a player id is always present.
- **`moduleResolution: "Bundler"`** — tells TypeScript to resolve `import`s the way modern bundlers like Vite do, rather than mimicking older Node.js resolution rules.

### `.gitignore`
Standard "don't track these" file. Worth calling out: it excludes `apps/web/public/audio/` and `apps/web/public/manifest.json` specifically — those will be *generated* by the scraper in Phase 1 (up to ~2GB of audio), so they don't belong in git; only the scraper's input (`tools/scraper/data/songs.csv`) is source-of-truth and tracked.

---

## `packages/shared` — shared TypeScript types, no libraries

This package has **zero runtime dependencies** — it's pure TypeScript type definitions, used only at compile time by the other two packages. Its job is to be the single place that defines "what does our game state look like" and "what does a song look like," so `apps/web` and `tools/scraper` can never disagree about the shape of that data.

### `package.json` / `tsconfig.json`
```json
{
  "name": "@hipster-clone/shared",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```
`"main"`/`"types"` normally point at *compiled* output (e.g. `dist/index.js`), but since this package is only ever consumed by other TypeScript projects in the same monorepo (via Vite/tsx, which compile on the fly), we can point straight at the `.ts` source and skip having a separate build step for this package.

### `src/types/song.ts`
```ts
export type AudioKind = "local-file" | "embedded-link";
```
This is a **string literal union type**. `AudioKind` isn't "any string" — it can *only* ever be the exact text `"local-file"` or `"embedded-link"`. If you typo `"local-fiel"` anywhere, TypeScript refuses to compile. This is TypeScript's version of an enum, and it's the idiomatic way to write one.

```ts
export interface SongAudioRef {
  kind: AudioKind;
  ref: string;
  durationSec?: number;
}
```
An `interface` describes the *shape* of an object — what properties it must have and what type each one is. `durationSec?: number` — the `?` makes that property **optional**; an object satisfies this interface whether or not it includes `durationSec`, but if it does, it must be a `number`. (`kind` and `ref` are required.)

```ts
export interface SongManifestEntry {
  id: string;
  title: string;
  artist: string;
  year: number;
  audio: SongAudioRef;
}

export interface SongManifest {
  version: string;
  generatedAt: string;
  songs: SongManifestEntry[];
}
```
Interfaces can reference each other as property types — `audio: SongAudioRef` means "this property must be an object matching the `SongAudioRef` interface above." `SongManifestEntry[]` means "an array of `SongManifestEntry` objects." Together these three types describe exactly what `manifest.json` (generated by the Phase 1 scraper) will contain, before we've written a single line of scraper code.

### `src/types/protocol.ts` — the richest file here

```ts
export type PlayerId = string;
```
A **type alias**. `PlayerId` and `string` are interchangeable to the compiler — this buys us *no* extra safety by itself, but it makes function signatures self-documenting: `players: Record<PlayerId, PlayerState>` reads much more clearly than `players: Record<string, PlayerState>`.

```ts
export interface PlayerState {
  id: PlayerId;
  name: string;
  connected: boolean;
  timeline: TimelineCard[];
  tokens: number;
}
```
Nothing new here — same interface pattern as above, describing one player's data.

```ts
export interface GameState {
  phase: GamePhase;
  players: Record<PlayerId, PlayerState>;
  ...
}
```
`Record<K, V>` is a **generic utility type** built into TypeScript — `Record<PlayerId, PlayerState>` means "an object used as a dictionary, where every key is a `PlayerId` (a string) and every value is a `PlayerState`." It's equivalent to `{ [key: string]: PlayerState }` but more readable. Because of `noUncheckedIndexedAccess` (set in the base tsconfig), doing `state.players[someId]` gives you type `PlayerState | undefined`, not just `PlayerState` — TypeScript is forcing us to remember that a given id might not actually be in the dictionary.

Now the important pattern — **discriminated unions**, used three times in this file (`GamePhase`, `Intent`, `GameEvent`). Here's `GamePhase`:
```ts
export type GamePhase =
  | { type: "lobby" }
  | { type: "playingSong"; songId: string; activePlayerId: PlayerId }
  | {
      type: "awaitingPlacement";
      songId: string;
      activePlayerId: PlayerId;
      activeDraftPosition: number | null;
      spectatorGuesses: Record<PlayerId, number | null>;
    }
  | { type: "reveal"; songId: string; correctPosition: number; activePlacementCorrect: boolean; stolenBy: PlayerId | null }
  | { type: "gameOver"; winnerId: PlayerId };
```
This says: "a `GamePhase` value is *one of* these five shapes, and every shape carries a `type` field that says which one it is." The `|` is a **union type** ("this OR that OR that..."). What makes it a *discriminated* union specifically is that shared `type` field — it's called the "discriminant." The payoff: if you write
```ts
if (state.phase.type === "awaitingPlacement") {
  state.phase.activeDraftPosition // TypeScript knows this exists here!
}
```
TypeScript **narrows** the type automatically after that check — inside the `if`, it knows `state.phase` can only be the `"awaitingPlacement"` variant, so it lets you access `activeDraftPosition` (which doesn't exist on the other four variants) without complaint. This is much safer than one big interface with a dozen optional fields, because it's *impossible* to accidentally construct a nonsensical state like "phase is `lobby` but also has a `winnerId`" — the type system won't allow it. It also directly encodes the spectator "insert coins" mechanic from the plan: `spectatorGuesses: Record<PlayerId, number | null>` only exists (and only makes sense) during `awaitingPlacement`.

`Intent` and `GameEvent` use the exact same pattern for the messages sent between phones:
```ts
export type Intent =
  | { type: "JOIN_REQUEST"; name: string }
  | { type: "PLAY_READY" }
  | { type: "DRAFT_POSITION_UPDATE"; position: number | null }
  | { type: "CONFIRM_PLACEMENT"; position: number }
  | { type: "SPECTATOR_GUESS_UPDATE"; position: number | null }
  | { type: "SPECTATOR_GUESS_CONFIRM"; position: number };
```
Later, when we write the code that receives one of these over the network and does a `switch (intent.type) { case "JOIN_REQUEST": ... }`, TypeScript will narrow the type inside each `case` block exactly like the `if` example above — and it will *also* error if we forget to handle one of the cases (if we set it up with an `exhaustive switch` check), which is a nice safety net for a message protocol.

### `src/index.ts`
```ts
export * from "./types/song.js";
export * from "./types/protocol.js";
```
This is a **barrel file** — its only job is to re-export everything from the other two files, so anything importing this package can write `import { SongManifest, GameState } from "@hipster-clone/shared"` from one path, instead of having to know the internal file layout. One TypeScript quirk worth flagging: the import paths end in `.js`, not `.ts`, even though the actual files are `song.ts`/`protocol.ts`. This looks wrong but is correct — TypeScript requires you to write the import path as it will look *after* compilation (when `.ts` becomes `.js`), even while you're still editing the `.ts` source.

---

## `tools/scraper` — one-time offline script (skeleton only, logic comes in Phase 1)

### Libraries (`package.json`)
- **`csv-parse`** / **`csv-stringify`** — read and write CSV files respectively. Not wired into any code yet — they're installed in advance because Phase 1 (parsing `songs.csv` and writing `review-needed.csv`) will need them.
- **`tsx`** — lets you run a `.ts` file directly (`tsx src/index.ts`) without a separate "compile to JS, then run the JS" step. That's what the `"scrape": "tsx src/index.ts"` script does.
- **`@types/node`** — TypeScript itself doesn't know about Node.js's built-in APIs (like the filesystem). This package supplies the type definitions for them, purely for editor/compiler support — it has no runtime effect.
- **`@hipster-clone/shared`** — same workspace-linking mechanism as before; the scraper will construct `SongManifestEntry` objects and needs that type.

### `tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  }
}
```
`"extends"` is how this file inherits every option from `tsconfig.base.json` and only overrides what's different. Unlike `apps/web` (a browser app, bundled by Vite), this package runs directly under Node.js, so it uses `"NodeNext"` module resolution (Node's actual rules) instead of `"Bundler"`, and explicitly loads the `"node"` types.

### The four stub files
```ts
export async function resolveSource(
  _title: string,
  _artist: string,
): Promise<ResolvedSource | null> {
  throw new Error("not implemented yet (Phase 1)");
}
```
A few things to unpack here, since this shape repeats in all four files:
- **`async function ... : Promise<T>`** — any function marked `async` automatically returns a `Promise` (JavaScript's representation of "a value that will be available later," e.g. after a network request). The return type `Promise<ResolvedSource | null>` says: "eventually resolves to either a `ResolvedSource` object, or `null`" — `null` representing "we searched and found nothing usable."
- **Leading underscore on parameters (`_title`, `_artist`)** — a naming convention (not a language feature) meaning "this parameter is intentionally unused right now." Linters commonly warn about unused variables/parameters; prefixing with `_` tells both the linter and a human reader "yes, I know, this is a deliberate placeholder."
- **`throw new Error(...)`** — rather than leaving the function body empty (which would silently return `undefined` and cause a confusing bug somewhere else later), it fails loudly and immediately if anything tries to call it before Phase 1 actually implements it.

The other three files (`downloadClip.ts`, `buildManifest.ts`, `index.ts`) follow the identical pattern — typed async function signatures with real parameter/return types already decided, bodies deferred to Phase 1.

### `data/songs.csv`
Just the header row (`id,title,artist,year,notes`) — the actual song rows are what you'll add (or hand me) before Phase 1 can do anything meaningful.

---

## `apps/web` — the actual app (only the files we touched)

### Libraries (`package.json`)
- **`react`** — the UI library: lets us describe the interface as components (functions that return "what should be on screen") instead of manually poking at the DOM.
- **`react-dom`** — the piece that actually takes React's output and renders it into a real browser page (`main.tsx` calls `createRoot(...).render(...)`, which comes from here).
- **`vite`** — the dev server and build tool. `npm run dev` starts a local server with instant hot-reload; `npm run build` bundles everything into optimized static files for deployment.
- **`@vitejs/plugin-react`** — teaches Vite how to handle React's JSX syntax (the HTML-like syntax inside `.tsx` files) and enables Fast Refresh (editing a component updates the running page without losing its state).
- **`typescript`** — the compiler/type-checker itself.
- **`oxlint`** — a linter (catches style issues and likely bugs, like unused variables) — separate from TypeScript's type checking.
- **`@types/react`, `@types/react-dom`** — type definitions for React, same idea as `@types/node` above.
- **`@hipster-clone/shared`** — added as a dependency so this app can use the types we just walked through.

### `src/App.tsx`
```tsx
import type { SongManifest } from "@hipster-clone/shared";

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
```
- **`import type { ... }`** — a variant of `import` that TypeScript guarantees is *only* used for type checking and is completely erased from the compiled JavaScript. A normal `import { SongManifest }` would also work here (TypeScript is often smart enough to erase it automatically), but writing `import type` makes the intent explicit and unambiguous: "I am only borrowing a type shape from this package, not any runtime code." It costs nothing when the app runs.
- **`const emptyManifest: SongManifest = { ... }`** — a plain object, but *annotated* with the `SongManifest` interface. This means TypeScript checks, at compile time, that the object actually has all the required fields (`version`, `generatedAt`, `songs`) with the right types — if you left out `songs` or typed a number into `version`, this line would fail to compile. Its only purpose right now is to prove the import from `@hipster-clone/shared` actually resolves and type-checks correctly; it gets replaced by real manifest-loading logic later.
- **`function App() { return (<main>...</main>) }`** — this is a **React function component**: any function that returns JSX (that HTML-looking syntax) and whose name starts with a capital letter. The `{expression}` syntax inside JSX (`{emptyManifest.songs.length}`) lets you drop a plain JavaScript/TypeScript value into the middle of the markup.
- **`export default App`** — makes this the "main export" of the file, which is what `main.tsx` imports and renders.

### `package.json` / `index.html`
Two small edits: added `"@hipster-clone/shared": "*"` to `dependencies` (the `"*"` version means "whatever version exists in the local workspace" — since we're not publishing this package anywhere, there's no real version to pin), and changed the `<title>` tag from the Vite default (`web`) to `HipsterClone`.

---

## What's next

Everything above type-checks and the app builds/runs (`npm run build` and `npm run dev` from `apps/web`, or via the workspace root). Phase 1 is the scraper: parsing your real `songs.csv`, resolving each song to a YouTube source, downloading short clips, and producing `apps/web/public/manifest.json` — which is what will replace the placeholder `emptyManifest` in `App.tsx` with real, playable songs.
