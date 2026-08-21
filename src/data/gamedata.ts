/**
 * CommunityDragon client: the app's source for ability damage.
 *
 * Data Dragon covers base stats, item stats, rune trees, cooldowns and costs.
 * It does not cover ability damage — see `bin.ts` for why. CommunityDragon
 * republishes the game's own `bin` files as JSON, per patch, with
 * `Access-Control-Allow-Origin: *`, which makes it usable straight from the
 * browser with no proxy and no key.
 *
 * Two things matter for trust:
 *
 *  1. The patch is pinned. The URL contains the same patch the rest of the app
 *     is showing, so the numbers cannot silently drift to a different version.
 *  2. The reading is checked. `validateGameData` re-derives every cooldown and
 *     mana cost from the bin and compares it to Data Dragon, which ships those
 *     two fields reliably. They come out of the same per-rank arrays as the
 *     damage values, so if the array convention ever changes, this catches it —
 *     and the app then falls back to maintained constants instead of showing
 *     numbers that are off by one rank.
 */

import { parseChampionBin, pickRank, findSpell, type ChampionGameData } from './bin';
import { CdnError, getJson } from './http';
import type { DDragonSpell } from './types';

const CDN = 'https://raw.communitydragon.org';

/**
 * Data Dragon versions the patch as `16.16.1`; CommunityDragon's paths use
 * `16.16`. The third component is a Data-Dragon-only build counter.
 */
export function cdragonPatch(ddragonVersion: string): string {
  const parts = ddragonVersion.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : ddragonVersion;
}

function binUrl(patch: string, championId: string): string {
  const slug = championId.toLowerCase();
  return `${CDN}/${patch}/game/data/characters/${slug}/${slug}.bin.json`;
}

export interface GameDataResult {
  data: ChampionGameData;
  /** Set when the requested patch was not available and a fallback was used. */
  note?: string;
}

/**
 * Load one champion's game data for a patch.
 *
 * CommunityDragon regenerates a patch folder some hours after Riot ships the
 * patch, so a brand-new Data Dragon version can 404 here. That is not an error
 * worth failing over: fall back to `latest` and say so.
 */
export async function fetchChampionGameData(
  ddragonVersion: string,
  championId: string,
): Promise<GameDataResult> {
  const patch = cdragonPatch(ddragonVersion);
  try {
    const raw = await getJson<unknown>(
      binUrl(patch, championId),
      `gamedata:${patch}:${championId}`,
      null,
    );
    return { data: parseChampionBin(raw, championId, patch) };
  } catch (err) {
    if (!(err instanceof CdnError)) throw err;
    // One retry against the rolling folder, with a short TTL because unlike a
    // pinned patch, `latest` does change under us.
    const raw = await getJson<unknown>(
      binUrl('latest', championId),
      `gamedata:latest:${championId}`,
      60 * 60 * 1000,
    );
    return {
      data: parseChampionBin(raw, championId, 'latest'),
      note: `CommunityDragon has no game data for patch ${patch} yet — the "latest" folder was used instead.`,
    };
  }
}

/* --------------------------------------------------------------- validation */

export interface ValidationCheck {
  spellId: string;
  field: 'cooldown' | 'cost' | 'effect value';
  rank: number;
  fromBin: number;
  fromDDragon: number;
  ok: boolean;
}

export interface ValidationReport {
  /** True when every comparable value matched. */
  ok: boolean;
  checks: ValidationCheck[];
  mismatches: ValidationCheck[];
  /**
   * How many checks could actually have caught an off-by-one-rank error, i.e.
   * came from an array whose values differ between ranks. A flat cooldown of
   * 1s matches under every indexing rule and proves nothing.
   */
  decisive: number;
}

function varies(values: number[]): boolean {
  return values.some((value) => value !== values[0]);
}

function allZero(values: number[]): boolean {
  return values.every((value) => value === 0);
}

/**
 * Cross-check the bin reading against Data Dragon.
 *
 * Three quantities are comparable, and all three come out of arrays with the
 * same shape and indexing as the damage values:
 *
 *  - cooldowns and mana costs, which Riot still publishes in both places;
 *  - the unnamed effect slots, where `effect[n + 1]` in Data Dragon is
 *    `mEffectAmount[n]` in the bin.
 *
 * Zero-filled Data Dragon rows are skipped rather than counted as a mismatch:
 * those are the fields Riot stopped publishing, which is the reason this whole
 * path exists. A comparison is only ever used to catch a *disagreement* between
 * two populated sources.
 */
export function validateGameData(
  data: ChampionGameData | null,
  spellById: Record<string, DDragonSpell | undefined>,
): ValidationReport {
  const checks: ValidationCheck[] = [];
  let decisive = 0;

  if (!data) return { ok: false, checks, mismatches: [], decisive };

  for (const spell of Object.values(spellById)) {
    if (!spell) continue;
    const gameSpell = findSpell(data, spell.id);
    if (!gameSpell) continue;

    const fields: { field: ValidationCheck['field']; bin: number[] | null; dd: number[] | undefined }[] = [
      { field: 'cooldown', bin: gameSpell.cooldown, dd: spell.cooldown },
      { field: 'cost', bin: gameSpell.cost, dd: spell.cost },
    ];

    // Data Dragon's `effect` array is one longer, with a null in front.
    gameSpell.effectAmounts.forEach((bin, index) => {
      const dd = spell.effect?.[index + 1];
      if (bin && Array.isArray(dd)) fields.push({ field: 'effect value', bin, dd });
    });

    for (const { field, bin, dd } of fields) {
      if (!bin || !Array.isArray(dd) || dd.length === 0) continue;
      if (allZero(dd) || allZero(bin)) continue;
      const informative = varies(bin) && varies(dd);
      for (let rank = 1; rank <= Math.min(spell.maxrank || dd.length, dd.length); rank += 1) {
        const fromBin = pickRank(bin, rank);
        const fromDDragon = dd[rank - 1];
        if (fromBin === null || typeof fromDDragon !== 'number') continue;
        const ok = Math.abs(fromBin - fromDDragon) < 0.001;
        checks.push({ spellId: spell.id, field, rank, fromBin, fromDDragon, ok });
        if (informative) decisive += 1;
      }
    }
  }

  const mismatches = checks.filter((check) => !check.ok);
  return { ok: checks.length > 0 && mismatches.length === 0, checks, mismatches, decisive };
}

/** One-line summary for the UI. */
export function describeValidation(report: ValidationReport): string {
  if (report.checks.length === 0) {
    return 'No values available to cross-check — game data is not used.';
  }
  if (report.ok) {
    return `${report.checks.length} cooldowns and costs match Data Dragon (${report.decisive} of them rank-dependent).`;
  }
  const first = report.mismatches[0]!;
  return `${report.mismatches.length} of ${report.checks.length} values disagree with Data Dragon (e.g. ${first.spellId} ${first.field} rank ${first.rank}: ${first.fromBin} instead of ${first.fromDDragon}). Game data is discarded.`;
}
