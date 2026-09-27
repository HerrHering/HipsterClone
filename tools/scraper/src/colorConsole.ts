// Side-effect import — patches the global `console.warn`/`console.error`
// once, here, so every existing call site across this script (index.ts,
// resolveSource.ts, ...) gets colored automatically, with no per-call-site
// changes needed. Import this first, before anything else logs.
// console.log (info) is left untouched — default terminal color.
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

console.warn = (...args: unknown[]) => {
  originalWarn(YELLOW, ...args, RESET);
};

console.error = (...args: unknown[]) => {
  originalError(RED, ...args, RESET);
};
