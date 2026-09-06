// Thin wrappers around the browser's localStorage that never throw. Private
// browsing (Safari in particular) and storage-disabled settings can make
// plain localStorage.getItem/setItem throw instead of just failing quietly
// — every caller in this app treats that the same way regardless of which
// key it's touching (fall back gracefully, don't crash the app over a
// remembered preference), so that's handled once, here, instead of each
// call site carrying its own try/catch.

export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do — this session just won't remember it for next time.
  }
}

export function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
