/** localStorage helpers that never throw (private mode, quota, corrupted JSON fall back to defaults). */
const PREFIX = 'omni-studio:';

export function readJson<T>(key: string, fallback: T, guard?: (value: unknown) => value is T): T {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);
    if (guard && !guard(value)) return fallback;
    return value as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience; the in-memory state stays authoritative.
  }
}
