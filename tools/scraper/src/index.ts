// Entry point for the one-time offline content-prep script.
// Run manually via `npm run scrape -w @hipster-clone/scraper`. Never run in the
// browser or CI. Phase 1 fills this in: parse data/songs.csv, resolve each row
// via resolveSource, download via downloadClip, then buildManifest into
// apps/web/public/manifest.json. Rows that fail or score low confidence are
// written to data/review-needed.csv instead of being silently dropped.

async function main() {
  throw new Error("not implemented yet (Phase 1)");
}

main();
