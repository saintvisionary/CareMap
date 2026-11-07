// Remembers the person's search and chat on this device only, with the
// browser's built-in localStorage: free, no server, no cookies sent
// anywhere. Every read and write is guarded, so a private window or
// blocked storage just means nothing is remembered.
const KEY = "caremap:v1";

export function loadSaved<T>(): Partial<T> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function saveSome(patch: Record<string, unknown>): void {
  try {
    const current = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    window.localStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Full or blocked storage: carry on without remembering.
  }
}

export function forgetAll(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
