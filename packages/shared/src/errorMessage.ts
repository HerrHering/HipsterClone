/**
 * Turns whatever a `catch` block caught into a displayable/loggable string.
 * `catch (error)` types `error` as `unknown` — JS lets `throw` any value at
 * all, not just an `Error` — so this is the one place that decides how to
 * read it: a real `Error` has a `.message` worth showing, anything else
 * just gets stringified as-is.
 *
 * The same three lines this replaces were independently typed out in every
 * workspace in this repo (the scraper, the api server, the web app) —
 * this is the one shared copy all of them import instead.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
