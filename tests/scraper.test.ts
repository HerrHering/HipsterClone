import { describe, expect, it } from "vitest";
import { slugify } from "../tools/scraper/src/slug.ts";
import {
  normalize,
  wordOverlapFraction,
  wordsOf,
} from "../tools/scraper/src/textMatch.ts";

describe("scraper text helpers", () => {
  it("normalizes case, punctuation, and whitespace", () => {
    expect(normalize("  Don't STOP... Me   Now! ")).toBe("don t stop me now");
  });

  it("drops filler words and measures target coverage", () => {
    const target = wordsOf(normalize("The Show Must Go On"));
    const candidate = wordsOf(
      normalize("Queen - The Show Must Go On (Official Video)"),
    );

    expect([...target]).toEqual(["show", "must", "go", "on"]);
    expect(wordOverlapFraction(target, candidate)).toBe(1);
    expect(
      wordOverlapFraction(wordsOf(normalize("show missing")), candidate),
    ).toBe(0.5);
    expect(wordOverlapFraction(wordsOf(normalize("official video")), candidate)).toBe(0);
  });

  it("creates safe, trimmed slugs", () => {
    expect(slugify("  Don't Stop Me Now — Queen (1978) ")).toBe(
      "don-t-stop-me-now-queen-1978",
    );
    expect(slugify("---")).toBe("");
  });
});
