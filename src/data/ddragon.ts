/**
 * Data Dragon client.
 *
 * Riot serves Data Dragon with `Access-Control-Allow-Origin: *`, so the browser
 * can fetch it directly — no proxy, no API key, no rate limit worth worrying
 * about. Files are immutable per version, so we cache aggressively.
 *
 * Locale note: we fetch `en_US` by default and parse item stats out of the
 * English description markup (see `model/items.ts`). Riot does not expose
 * modern stats such as Ability Haste or Lethality in the machine-readable
 * `stats` object at all, so the description is the only complete source, and
 * the label table it is matched against is English. Switching locale changes
 * displayed names and degrades stat parsing accordingly.
 */

import { readCache, writeCache } from './cache';
import { OFFLINE_BUNDLE } from './fallback';
import type {
  DDragonChampionDetail,
  DDragonChampionSummary,
  DDragonItem,
  DDragonRuneTree,
  PatchBundle,
} from './types';

const CDN = 'https://ddragon.leagueoflegends.com';
const VERSIONS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — patches ship far less often
const FETCH_TIMEOUT_MS = 15_000;

export const DEFAULT_LOCALE = 'en_US';

export class DDragonError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DDragonError';
  }
}

async function getJson<T>(url: string, cacheKey: string, ttlMs: number | null): Promise<T> {
  const cached = readCache<T>(cacheKey);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!res.ok) throw new DDragonError(`${url} antwortete mit HTTP ${res.status}`);
    const json = (await res.json()) as T;
    writeCache(cacheKey, json, ttlMs);
    return json;
  } catch (err) {
    if (err instanceof DDragonError) throw err;
    const reason = err instanceof Error && err.name === 'AbortError' ? 'Zeitüberschreitung' : 'Netzwerkfehler';
    throw new DDragonError(`${reason} beim Laden von ${url}`, err);
  } finally {
    clearTimeout(timer);
  }
}

/** Newest patch version first. */
export async function fetchVersions(): Promise<string[]> {
  const versions = await getJson<string[]>(`${CDN}/api/versions.json`, 'versions', VERSIONS_TTL_MS);
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new DDragonError('versions.json war leer');
  }
  return versions;
}

function dataUrl(version: string, locale: string, file: string): string {
  return `${CDN}/cdn/${version}/data/${locale}/${file}`;
}

export async function fetchChampionIndex(
  version: string,
  locale: string,
): Promise<Record<string, DDragonChampionSummary>> {
  const payload = await getJson<{ data: Record<string, DDragonChampionSummary> }>(
    dataUrl(version, locale, 'champion.json'),
    `champions:${version}:${locale}`,
    null,
  );
  return payload.data ?? {};
}

export async function fetchChampionDetail(
  version: string,
  locale: string,
  championId: string,
): Promise<DDragonChampionDetail> {
  const payload = await getJson<{ data: Record<string, DDragonChampionDetail> }>(
    dataUrl(version, locale, `champion/${championId}.json`),
    `champion:${version}:${locale}:${championId}`,
    null,
  );
  const detail = payload.data?.[championId];
  if (!detail) throw new DDragonError(`Champion ${championId} fehlt in Data Dragon ${version}`);
  return detail;
}

export async function fetchItems(version: string, locale: string): Promise<Record<string, DDragonItem>> {
  const payload = await getJson<{ data: Record<string, DDragonItem> }>(
    dataUrl(version, locale, 'item.json'),
    `items:${version}:${locale}`,
    null,
  );
  return payload.data ?? {};
}

export async function fetchRuneTrees(version: string, locale: string): Promise<DDragonRuneTree[]> {
  return getJson<DDragonRuneTree[]>(
    dataUrl(version, locale, 'runesReforged.json'),
    `runes:${version}:${locale}`,
    null,
  );
}

/**
 * Load everything the app needs for one patch. Falls back to the bundled
 * offline snapshot if the CDN cannot be reached, so the app degrades to
 * "base stats only" instead of a blank error page.
 */
export async function loadPatchBundle(
  version: string | null,
  locale: string = DEFAULT_LOCALE,
): Promise<PatchBundle> {
  const resolved = version ?? (await fetchVersions())[0]!;
  const [champions, items, runeTrees] = await Promise.all([
    fetchChampionIndex(resolved, locale),
    fetchItems(resolved, locale),
    fetchRuneTrees(resolved, locale),
  ]);
  return { version: resolved, locale, offline: false, champions, items, runeTrees };
}

export function offlineBundle(): PatchBundle {
  return OFFLINE_BUNDLE;
}

/* ---------------------------------------------------------------- image URLs */

export const imageUrls = {
  item: (version: string, file: string) => `${CDN}/cdn/${version}/img/item/${file}`,
  spell: (version: string, file: string) => `${CDN}/cdn/${version}/img/spell/${file}`,
  passive: (version: string, file: string) => `${CDN}/cdn/${version}/img/passive/${file}`,
  champion: (version: string, file: string) => `${CDN}/cdn/${version}/img/champion/${file}`,
  championSplash: (championId: string) => `${CDN}/cdn/img/champion/splash/${championId}_0.jpg`,
  championLoading: (championId: string) => `${CDN}/cdn/img/champion/loading/${championId}_0.jpg`,
  /** Rune icons are versionless in Data Dragon. */
  rune: (iconPath: string) => `${CDN}/cdn/img/${iconPath}`,
};
