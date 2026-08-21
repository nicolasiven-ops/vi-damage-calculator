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

import type { ChampionGameData, StatKey, StatScaling } from '../../data/bin';
import { findCalculation, findDataValue, findSpell, pickRank } from '../../data/bin';
import type { DDragonChampionDetail, DDragonSpell } from '../../data/types';
import { breakdown, evaluate, formatCalculation, ratioFor, type StatLookup } from '../spellcalc';
import type { ChampionRuntime } from '../../engine/context';
import type { AbilitySlot } from '../../engine/types';

/**
 * A number the calculator needed, along with where it actually came from.
 * Surfaced in the UI so nobody has to trust an unlabelled constant.
 */
export interface SourcedNumber {
  value: number;
  source: ValueSource;
  /** Why this value looks the way it does. */
  note?: string;
  /** The formula it was read from, when it came from game data. */
  formula?: string;
}

/**
 * Where a number came from, in descending order of authority.
 *
 * `gamedata` is Riot's own spell formula, read from the patch's bin file via
 * CommunityDragon. `ddragon` is Riot's CDN, which still ships cooldowns, costs
 * and base stats reliably but no longer ships ability damage. `registry` is a
 * constant maintained in this repository, used only when neither can answer.
 */
export type ValueSource = 'gamedata' | 'ddragon' | 'registry';

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
  /**
   * Parsed spell formulas for this champion, or null when they could not be
   * loaded — or were loaded but failed the cross-check against Data Dragon, in
   * which case using them would risk numbers that are off by a whole rank.
   */
  gameData: ChampionGameData | null;
}

export interface ChampionModule {
  championId: string;
  displayName: string;
  /**
   * The patch this champion's maintained constants were last checked against.
   *
   * Worth showing wherever those constants are actually used: they are correct
   * for one patch, and the header lets the user select a different one.
   */
  constantsReviewedPatch: string;
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
    source: ValueSource;
    /** Why this value came from where it did, when that is not obvious. */
    note?: string;
    /** Riot's own formula for this value, when it was read from game data. */
    formula?: string;
  }[];
}

/**
 * Ability names, taken from Data Dragon when it has them.
 *
 * Riot renames abilities on rework — Vi's E went from "Excessive Force" to
 * "Relentless Force" — and a name baked into a champion module goes stale
 * silently. Data Dragon does ship names reliably, in the requested locale, so
 * the module's name is only a fallback for when the CDN is unreachable.
 */
export function resolveAbilityNames(
  abilities: AbilityMeta[],
  ctx: ChampionModuleContext,
): AbilityMeta[] {
  return abilities.map((ability) => {
    const live = ability.ddragonId
      ? ctx.spellById[ability.ddragonId]?.name
      : ctx.detail?.passive?.name;
    return live ? { ...ability, name: live } : ability;
  });
}

/* -------------------------------------------------- game data value helpers */

/**
 * Reading numbers out of Riot's own spell formulas.
 *
 * Every helper here has the same contract: return the value Riot ships, marked
 * `gamedata` and carrying the formula it came from — or, if that is impossible,
 * return the maintained constant marked `registry` and say why. There is no
 * third outcome. A champion module therefore never has to check whether game
 * data is available; it passes the constant it would have used anyway.
 */

const NO_GAME_DATA = 'No game data available for this patch — maintained constant used.';

function unreadable(spellKey: string, calcKey: string): string {
  return `Formula ${spellKey}.${calcKey} was not readable — maintained constant used.`;
}

function registryValue(value: number, note: string): SourcedNumber {
  return { value, source: 'registry', note };
}

function calculationOf(ctx: ChampionModuleContext, spellKey: string, calcKey: string) {
  return findCalculation(findSpell(ctx.gameData, spellKey), calcKey);
}

/** The full value of a spell formula, evaluated against the current stats. */
export function calcValue(
  ctx: ChampionModuleContext,
  spellKey: string,
  calcKey: string,
  rank: number,
  stats: StatLookup,
  fallback: number,
): SourcedNumber {
  if (!ctx.gameData) return registryValue(fallback, NO_GAME_DATA);
  const calc = calculationOf(ctx, spellKey, calcKey);
  const value = evaluate(calc, rank, stats);
  if (value === null) return registryValue(fallback, unreadable(spellKey, calcKey));
  return { value, source: 'gamedata', formula: formatCalculation(calc, rank) ?? undefined };
}

/**
 * The part of a formula that does not scale with any stat — a base damage.
 *
 * Multipliers are folded in, so Vi's fully charged Q reports 100 at rank 1
 * (40 × 2.5) rather than the unmultiplied 40.
 */
export function calcBase(
  ctx: ChampionModuleContext,
  spellKey: string,
  calcKey: string,
  rank: number,
  fallback: number,
): SourcedNumber {
  if (!ctx.gameData) return registryValue(fallback, NO_GAME_DATA);
  const calc = calculationOf(ctx, spellKey, calcKey);
  const parts = breakdown(calc, rank);
  if (!parts) return registryValue(fallback, unreadable(spellKey, calcKey));
  return { value: parts.flat, source: 'gamedata', formula: formatCalculation(calc, rank) ?? undefined };
}

/**
 * The combined ratio a formula applies to one stat, multipliers folded in.
 *
 * A readable formula that simply has no such term yields 0, not the maintained
 * constant. The distinction matters: if Riot drops a scaling in a patch, the
 * honest answer is "this ability no longer scales with that" — falling back to
 * the constant would quietly keep adding damage the ability stopped dealing.
 * The constant is only used when the formula itself could not be read.
 */
export function calcRatio(
  ctx: ChampionModuleContext,
  spellKey: string,
  calcKey: string,
  rank: number,
  stat: StatKey,
  scaling: StatScaling,
  fallback: number,
): SourcedNumber {
  if (!ctx.gameData) return registryValue(fallback, NO_GAME_DATA);
  const calc = calculationOf(ctx, spellKey, calcKey);
  if (!calc || !calc.complete) return registryValue(fallback, unreadable(spellKey, calcKey));

  const ratio = ratioFor(calc, rank, stat, scaling);
  if (ratio === null) {
    const which = scaling === 'bonus' ? 'bonus' : 'total';
    return {
      value: 0,
      source: 'gamedata',
      note: `Riot's formula ${spellKey}.${calcKey} has no ${which} ${STAT_NAMES[stat]} scaling — none is calculated.`,
    };
  }
  return { value: ratio, source: 'gamedata' };
}

const STAT_NAMES: Record<StatKey, string> = {
  ad: 'AD',
  ap: 'AP',
  maxHealth: 'health',
  attackSpeed: 'attack speed',
};

/**
 * A per-rank field the bin carries outside the value table: cooldown, mana
 * cost, ammo, channel duration.
 *
 * Cooldowns and costs are also in Data Dragon and are cross-checked against it
 * at load time, so reading them here is equivalent; ammo and channel duration
 * exist only in the bin.
 */
export function spellTiming(
  ctx: ChampionModuleContext,
  spellKey: string,
  field: 'cooldown' | 'cost' | 'maxAmmo' | 'ammoRechargeTime' | 'channelDuration',
  rank: number,
  fallback: number,
): SourcedNumber {
  if (!ctx.gameData) return registryValue(fallback, NO_GAME_DATA);
  const value = pickRank(findSpell(ctx.gameData, spellKey)?.[field] ?? null, rank);
  if (value === null) {
    return registryValue(fallback, `${spellKey}.${field} is missing from the game data — maintained constant used.`);
  }
  return { value, source: 'gamedata', formula: field };
}

/**
 * A named per-rank value out of the spell's own table.
 *
 * These are the numbers that are not damage: shred percentages, durations,
 * charge counts, caps. Riot keeps them in the same table as the damage values,
 * so they come from the same source and are indexed the same way.
 */
export function gameValue(
  ctx: ChampionModuleContext,
  spellKey: string,
  name: string,
  rank: number,
  fallback: number,
): SourcedNumber {
  if (!ctx.gameData) return registryValue(fallback, NO_GAME_DATA);
  const value = findDataValue(findSpell(ctx.gameData, spellKey), name, rank);
  if (value === null) {
    return registryValue(fallback, `Value ${spellKey}.${name} is missing from the game data — maintained constant used.`);
  }
  return { value, source: 'gamedata', formula: name };
}

/** The formula as text, for the inspector. Undefined when unreadable. */
export function calcFormula(
  ctx: ChampionModuleContext,
  spellKey: string,
  calcKey: string,
  rank: number,
): string | undefined {
  return formatCalculation(calculationOf(ctx, spellKey, calcKey), rank) ?? undefined;
}

/* ------------------------------------------------ Data Dragon value helpers */

const ZERO_NOTE =
  'Data Dragon returns 0 here — Riot no longer populates the effect arrays of reworked kits. Maintained constant used.';

/**
 * Read `spell.effect[index][rank - 1]`, falling back to a maintained constant.
 * Data Dragon's `effect` array is 1-based with a `null` at index 0.
 *
 * A zero is treated as *missing*, not as data. Riot ships zero-filled `effect`
 * arrays for reworked kits — the real numbers moved into tooltip placeholders
 * that are resolved from a source Data Dragon does not expose. Accepting those
 * zeros silently replaces every base damage with nothing, which is strictly
 * worse than the maintained constant they would otherwise override.
 *
 * Kept for older kits, where these arrays are still populated and are the
 * shortest path to a correct number. Vi is not one of them: every entry in her
 * `effect` arrays is 0, which is what `data/bin.ts` exists to work around.
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

/**
 * Read a per-rank mana cost.
 *
 * Zero is a real answer here, unlike for a cooldown: plenty of abilities are
 * free, and Vi's ultimate is one of the ones that is not. So a zero from Data
 * Dragon is taken at face value and only a missing field falls back.
 */
export function costValue(
  spell: DDragonSpell | undefined,
  rank: number,
  fallback: readonly number[],
): SourcedNumber {
  const fromDDragon = spell?.cost?.[Math.max(0, rank - 1)];
  if (typeof fromDDragon === 'number' && Number.isFinite(fromDDragon)) {
    return { value: fromDDragon, source: 'ddragon' };
  }
  return {
    value: fallback[Math.max(0, Math.min(fallback.length - 1, rank - 1))] ?? 0,
    source: 'registry',
  };
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
