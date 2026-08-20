/**
 * Small localStorage cache for Data Dragon payloads.
 *
 * Data Dragon files are immutable per version, so anything keyed by a concrete
 * version number never needs invalidating. The one moving target is
 * `versions.json`, which gets a short TTL.
 */

const PREFIX = 'vidmg:v1:';

interface Envelope<T> {
  storedAt: number;
  ttlMs: number | null;
  payload: T;
}

function storage(): Storage | null {
  try {
    // Safari private mode and some embedded webviews throw on access.
    const probe = '__vidmg_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Envelope<T>;
    if (env.ttlMs !== null && Date.now() - env.storedAt > env.ttlMs) {
      store.removeItem(PREFIX + key);
      return null;
    }
    return env.payload;
  } catch {
    store.removeItem(PREFIX + key);
    return null;
  }
}

export function writeCache<T>(key: string, payload: T, ttlMs: number | null = null): void {
  const store = storage();
  if (!store) return;
  const env: Envelope<T> = { storedAt: Date.now(), ttlMs, payload };
  try {
    store.setItem(PREFIX + key, JSON.stringify(env));
  } catch {
    // Quota exceeded: drop our own entries and give up quietly rather than
    // breaking the app over a cache miss.
    clearCache();
  }
}

export function clearCache(): void {
  const store = storage();
  if (!store) return;
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(PREFIX)) doomed.push(key);
  }
  doomed.forEach((key) => store.removeItem(key));
}
