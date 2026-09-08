# HipsterClone contributor guide

## Project layout

- `apps/web`: Vite + React client.
- `apps/api`: Express game server, audio download, and cache.
- `packages/shared`: shared TypeScript protocol and song types.
- `tools/scraper`: CSV-to-song-manifest resolver.
- `tests`: root-level Vitest tests. Keep tests here unless a workspace needs its own test configuration.

This is an npm-workspaces monorepo. Use Node.js 22 and install all JavaScript dependencies from the repository root.

## Everyday commands

Use the Makefile when possible:

```sh
make install       # npm install for local development
make dev           # web client and API server
make test          # automated tests
make lint          # web linting
make build         # type-check and build all workspaces
make check         # test, lint, and build
make ci            # clean install followed by the CI checks
```

Equivalent npm commands are available in the root `package.json`. Run `make check` before handing off a change that affects application code. Run the narrowest relevant command while iterating, then the full check before completion.

## Code and testing conventions

- The repository is ESM TypeScript. Keep import extensions and TypeScript configuration consistent with nearby code.
- Prefer small, deterministic unit tests for game rules, shared helpers, scraper logic, and display helpers.
- Test API game behavior through its exported functions. Mock the song-manifest/cache boundary; tests must not download media, call YouTube, require browser cookies, or depend on external services.
- Keep test fixtures self-contained and stable. The game module maintains in-memory room state, so isolate scenarios with fresh modules or unique room codes.
- Do not add a formatter or change lint rules unless the task explicitly calls for it.

## Generated files and secrets

- Do not commit `node_modules/`, `.venv/`, build output, audio caches, or `apps/web/public/manifest.json`.
- Generate the manifest with `make scrape` after changing `tools/scraper/data/songs.csv`; it is intentionally git-ignored.
- `cookies.txt` is a credential used only for hosted audio downloads. Never add it to source control or log its contents.
- `make clean` removes generated build and runtime artifacts. `make distclean` additionally removes `node_modules/` and `.venv/`; do not run either unless that cleanup is intended.

## CI

GitHub Actions runs `npm ci`, `npm test`, `npm run lint`, and `npm run build` for pushes and pull requests. Keep these commands passing and update the test suite whenever behavior changes.
