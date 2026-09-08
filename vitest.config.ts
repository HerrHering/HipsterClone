import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "apps/api/src/game.ts",
        "apps/web/src/game/songText.ts",
        "packages/shared/src/**/*.ts",
        "tools/scraper/src/slug.ts",
        "tools/scraper/src/textMatch.ts",
      ],
      thresholds: {
        branches: 81,
        functions: 81,
        lines: 81,
        statements: 81,
      },
    },
  },
});
