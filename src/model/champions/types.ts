/**
 * Champion module contract.
 *
 * A champion contributes two things:
 *  - `abilities`: declarative metadata the UI renders (names, ranks, notes).
 *  - `createRuntime`: the imperative behaviour the simulation drives.
 *
 * The split exists because kits resist pure data modelling. Vi alone has a
 * charged dash, a stacking third-hit passive, an on-hit empowered attack with
 * ammo, and a shield that keys off "any ability damage". Encoding that as
 * declarative JSON produces a worse, less honest model than a few lines of
 * TypeScript per champion.
 */

import type { DDragonChampionDetail, DDragonSpell } from '../../data/types';
import type { ChampionRuntime } from '../../engine/context';
import type { AbilitySlot } from '../../engine/types';

/**
 * A number the calculator needed, along with where it actually came from.
 * Surfaced in the UI so nobody has to trust an unlabelled constant.
 */
export interface SourcedNumber {
  value: number;
  source: 'ddragon' | 'registry';
  /** Why this value looks the way it does. */
  note?: string;
}

export interface AbilityMeta {
  slot: AbilitySlot;
  /** Data Dragon spell id, e.g. `ViQ`. Empty string for the passive. */
  ddragonId: string;
  name: string;
  maxRank: number;
  castable: boolean;
  /** Short bullet points describing exactly what this calculator models. */
  modelNotes: string[];
  /** Set for abilities that can be held down, like Vault Breaker. */
  chargeable?: { maxSeconds: number };
}

export interface ChampionModuleContext {
  detail: DDragonChampionDetail | null;
  spellById: Record<string, DDragonSpell | undefined>;
}

export interface ChampionModule {
  championId: string;
  displayName: string;
  abilities: AbilityMeta[];
  createRuntime(ctx: ChampionModuleContext): ChampionRuntime;
  /**
   * Values the UI shows in the formula inspector, resolved for the given
   * ranks so the user can audit every number the engine used.
   */
  describeValues(
    ctx: ChampionModuleContext,
    ranks: Record<AbilitySlot, number>,
  ): {
    slot: AbilitySlot;
    label: string;
    value: string;
    source: SourcedNumber['source'];
    /** Why this value came from where it did, when that is not obvious. */
    note?: string;
  }[];
}

/* ------------------------------------------------ Data Dragon value helpers */

const ZERO_NOTE =
  'Data Dragon liefert hier 0 — Riot füllt die effect-Arrays überarbeiteter Kits nicht mehr. Gepflegte Konstante verwendet.';

/**
 * Read `spell.effect[index][rank - 1]`, falling back to a maintained constant.
 * Data Dragon's `effect` array is 1-based with a `null` at index 0.
 *
 * A zero is treated as *missing*, not as data. Riot ships zero-filled `effect`
 * arrays for reworked kits — the real numbers moved into tooltip placeholders
 * that are resolved from a source Data Dragon does not expose. Accepting those
 * zeros silently replaces every base damage with nothing, which is strictly
 * worse than the maintained constant they would otherwise override.
 */
export function effectValue(
  spell: DDragonSpell | undefined,
  effectIndex: number,
  rank: number,
  fallback: number[],
  note?: string,
): SourcedNumber {
  const row = spell?.effect?.[effectIndex];
  const fromDDragon = Array.isArray(row) ? row[Math.max(0, rank - 1)] : undefined;
  const usable = typeof fromDDragon === 'number' && Number.isFinite(fromDDragon) && fromDDragon > 0;
  if (usable) return { value: fromDDragon as number, source: 'ddragon' };

  return {
    value: fallback[Math.max(0, Math.min(fallback.length - 1, rank - 1))] ?? 0,
    source: 'registry',
    note: fromDDragon === 0 ? ZERO_NOTE : note,
  };
}

/** Read a coefficient out of `spell.vars`, falling back to a constant. */
export function varCoefficient(
  spell: DDragonSpell | undefined,
  key: string,
  rank: number,
  fallback: number,
  note?: string,
): SourcedNumber {
  const entry = spell?.vars?.find((v) => v.key === key);
  if (entry) {
    const coeff = Array.isArray(entry.coeff)
      ? entry.coeff[Math.max(0, Math.min(entry.coeff.length - 1, rank - 1))]
      : entry.coeff;
    if (typeof coeff === 'number' && Number.isFinite(coeff)) {
      return { value: coeff, source: 'ddragon' };
    }
  }
  return { value: fallback, source: 'registry', note };
}

/** Read a per-rank cooldown, falling back to a constant. Zero means missing. */
export function cooldownValue(
  spell: DDragonSpell | undefined,
  rank: number,
  fallback: number[],
): SourcedNumber {
  const fromDDragon = spell?.cooldown?.[Math.max(0, rank - 1)];
  if (typeof fromDDragon === 'number' && Number.isFinite(fromDDragon) && fromDDragon > 0) {
    return { value: fromDDragon, source: 'ddragon' };
  }
  return {
    value: fallback[Math.max(0, Math.min(fallback.length - 1, rank - 1))] ?? 0,
    source: 'registry',
    note: fromDDragon === 0 ? ZERO_NOTE : undefined,
  };
}
