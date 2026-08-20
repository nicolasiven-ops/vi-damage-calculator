/**
 * Shared CDN plumbing for the two data sources the app reads.
 *
 * Riot's Data Dragon and CommunityDragon both serve static JSON with
 * `Access-Control-Allow-Origin: *`, both are immutable once a patch has
 * shipped, and both can be slow or unreachable. That is the whole contract, so
 * fetching, timing out, caching and error wrapping live here once instead of
 * twice.
 */

import { readCache, writeCache } from './cache';

const FETCH_TIMEOUT_MS = 15_000;

/** Any failure while talking to a CDN, with the URL that caused it. */
export class CdnError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CdnError';
  }
}

/**
 * Fetch JSON, serving from the cache when possible.
 *
 * `ttlMs === null` means "cache forever", which is correct for anything keyed
 * by a concrete patch version: those files never change again.
 */
export async function getJson<T>(url: string, cacheKey: string, ttlMs: number | null): Promise<T> {
  const cached = readCache<T>(cacheKey);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!res.ok) throw new CdnError(`${url} antwortete mit HTTP ${res.status}`);
    const json = (await res.json()) as T;
    writeCache(cacheKey, json, ttlMs);
    return json;
  } catch (err) {
    if (err instanceof CdnError) throw err;
    const reason = err instanceof Error && err.name === 'AbortError' ? 'Zeitüberschreitung' : 'Netzwerkfehler';
    throw new CdnError(`${reason} beim Laden von ${url}`, err);
  } finally {
    clearTimeout(timer);
  }
}
