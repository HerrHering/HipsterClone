/**
 * Turns arbitrary text into a lowercase, hyphen-separated, filesystem/URL-safe
 * id. Used to derive a song's id from `title-artist-year` — combining all
 * three makes a collision between two different songs practically impossible,
 * so callers don't need any collision-retry logic.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
