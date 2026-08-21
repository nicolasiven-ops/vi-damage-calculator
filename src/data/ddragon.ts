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

import { CdnError, getJson } from './http';
import { OFFLINE_BUNDLE } from './fallback';
import type {
  DDragonChampionDetail,
  DDragonChampionSummary,
  DDragonItem,
  DDragonRuneTree,
  DDragonSummonerSpell,
  PatchBundle,
} from './types';

const CDN = 'https://ddragon.leagueoflegends.com';
const VERSIONS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — patches ship far less often

export const DEFAULT_LOCALE = 'en_US';

/**
 * Kept as the name the rest of the app throws and catches. Data Dragon and
 * CommunityDragon fail the same way, so they share one error type.
 */
export { CdnError as DDragonError };

/** Newest patch version first. */
export async function fetchVersions(): Promise<string[]> {
  const versions = await getJson<string[]>(`${CDN}/api/versions.json`, 'versions', VERSIONS_TTL_MS);
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new CdnError('versions.json was empty');
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
  if (!detail) throw new CdnError(`Champion ${championId} is missing from Data Dragon ${version}`);
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
  const [champions, items, runeTrees, summoners] = await Promise.all([
    fetchChampionIndex(resolved, locale),
    fetchItems(resolved, locale),
    fetchRuneTrees(resolved, locale),
    fetchSummoners(resolved, locale),
  ]);
  return { version: resolved, locale, offline: false, champions, items, runeTrees, summoners };
}

export function offlineBundle(): PatchBundle {
  return OFFLINE_BUNDLE;
}

/* ---------------------------------------------------------------- image URLs */

/**
 * Summoner spells, filtered to the ones Summoner's Rift allows.
 *
 * Data Dragon ships every spell of every mode in one file, tutorial and Nexus
 * Blitz entries included. Offering those in a picker would be offering spells
 * nobody can take.
 */
export async function fetchSummoners(
  version: string,
  locale: string = DEFAULT_LOCALE,
): Promise<Record<string, DDragonSummonerSpell>> {
  const payload = await getJson<{ data: Record<string, DDragonSummonerSpell> }>(
    `${CDN}/cdn/${version}/data/${locale}/summoner.json`,
    `summoners:${version}:${locale}`,
    null,
  );
  const allowed: Record<string, DDragonSummonerSpell> = {};
  for (const [id, spell] of Object.entries(payload.data ?? {})) {
    if (spell?.modes?.includes('CLASSIC')) allowed[id] = spell;
  }
  return allowed;
}

const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';

export const imageUrls = {
  /**
   * Spell icons that only CommunityDragon has.
   *
   * Primal Smite is not in Data Dragon at all — it exists only as the upgraded
   * form the jungle pet grants — so its three icons come from the game-data
   * assets, where the paths are lower-cased.
   */
  gameDataSpell: (file: string) => `${CDRAGON}/data/spells/icons2d/${file}`,
  /** Summoner icons sit under the same path as ability icons. */
  summoner: (version: string, file: string) => `${CDN}/cdn/${version}/img/spell/${file}`,
  item: (version: string, file: string) => `${CDN}/cdn/${version}/img/item/${file}`,
  spell: (version: string, file: string) => `${CDN}/cdn/${version}/img/spell/${file}`,
  passive: (version: string, file: string) => `${CDN}/cdn/${version}/img/passive/${file}`,
  champion: (version: string, file: string) => `${CDN}/cdn/${version}/img/champion/${file}`,
  championSplash: (championId: string) => `${CDN}/cdn/img/champion/splash/${championId}_0.jpg`,
  championLoading: (championId: string) => `${CDN}/cdn/img/champion/loading/${championId}_0.jpg`,
  /** Rune icons are versionless in Data Dragon. */
  rune: (iconPath: string) => `${CDN}/cdn/img/${iconPath}`,
};
