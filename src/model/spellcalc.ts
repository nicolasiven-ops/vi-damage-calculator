/**
 * Evaluating Riot's spell formulas against a stat block.
 *
 * `data/bin.ts` produces the canonical shape — a list of additive parts plus a
 * multiplier chain. This file turns that into three things the rest of the app
 * needs:
 *
 *   - `evaluate`: the number, for a rank and a stat block.
 *   - `breakdown`: the flat part and the ratios separately, which is what a
 *     champion module needs when it has to interpolate between two formulas
 *     (Vi's Q ramps from `TotalDamage` to `MaxDamageTooltip` over its charge).
 *   - `formatCalculation`: the formula as text, for the inspector, so a number
 *     can be checked against the tooltip in the client without reading code.
 *
 * A calculation that contains a part the parser did not understand evaluates to
 * `null`, never to a partial sum. Half a formula is worse than no formula: the
 * caller can fall back to a maintained constant, but it cannot detect a
 * silently missing term.
 */

import { pickRank, type CalcPart, type SpellCalculation, type StatKey, type StatScaling } from '../data/bin';
import type { ChampionStats } from './stats';

/** The champion levels the game actually has. */
const MIN_LEVEL = 1;
const MAX_LEVEL = 18;

export interface StatLookup {
  level: number;
  value(stat: StatKey, scaling: StatScaling): number;
}

/** Adapter from the app's stat block to what a formula part may read. */
export function statLookup(stats: ChampionStats): StatLookup {
  return {
    level: stats.level,
    value(stat, scaling) {
      switch (stat) {
        case 'ad':
          return scaling === 'bonus' ? stats.bonusAttackDamage : stats.totalAttackDamage;
        case 'ap':
          // Ability power has no base component, so total and bonus coincide.
          return stats.abilityPower;
        case 'maxHealth':
          return scaling === 'bonus' ? stats.bonusHealth : stats.maxHealth;
        case 'attackSpeed':
          return scaling === 'bonus' ? stats.bonusAttackSpeed : stats.totalAttackSpeed;
      }
    },
  };
}

/**
 * Riot's champion-level curve.
 *
 * From level 2 on, each level adds the current per-level step. A breakpoint at
 * level L applies before that level's step is added: it can add a one-off
 * amount and replace the step (an absent step means "stop scaling here").
 *
 * Vi's Blast Shield is the reference case: 16 s at level 1, −0.5 s per level,
 * breakpoint at 10. That is 12 s from level 9 on, which is what the client
 * shows ("16 − 12 based on level").
 */
function evaluateByLevel(
  part: Extract<CalcPart, { kind: 'byLevel' }>,
  level: number,
): number {
  const target = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
  let total = part.level1;
  let perLevel = part.perLevel;
  for (let current = 2; current <= target; current += 1) {
    const breakpoint = part.breakpoints.find((entry) => entry.level === current);
    if (breakpoint) {
      total += breakpoint.add;
      perLevel = breakpoint.perLevel ?? 0;
    }
    total += perLevel;
  }
  return total;
}

export interface CalcRatio {
  stat: StatKey;
  scaling: StatScaling;
  /** Already multiplied by the calculation's multiplier chain. */
  ratio: number;
}

export interface CalcBreakdown {
  /** Everything that does not scale with a stat, multipliers applied. */
  flat: number;
  /** One entry per stat term, multipliers applied. */
  ratios: CalcRatio[];
  /** The product of the multiplier chain, for display. */
  multiplier: number;
  /** Riot renders this as a percentage. */
  displayAsPercent: boolean;
}

/**
 * Split a calculation into its flat and scaling components for one rank.
 *
 * Returns `null` if the calculation was not fully understood.
 */
export function breakdown(
  calc: SpellCalculation | null,
  rank: number,
  level: number = MAX_LEVEL,
): CalcBreakdown | null {
  if (!calc || !calc.complete) return null;

  let multiplier = 1;
  for (const part of calc.multipliers) {
    const value = partScalar(part, rank, level);
    if (value === null) return null;
    multiplier *= value;
  }

  let flat = 0;
  const ratios: CalcRatio[] = [];
  for (const part of calc.parts) {
    if (part.kind === 'stat') {
      const coefficient = pickRank(part.perRank, rank);
      if (coefficient === null) return null;
      ratios.push({ stat: part.stat, scaling: part.scaling, ratio: coefficient * multiplier });
      continue;
    }
    const value = partScalar(part, rank, level);
    if (value === null) return null;
    flat += value * multiplier;
  }

  return { flat, ratios, multiplier, displayAsPercent: calc.displayAsPercent };
}

/** A part that does not read a stat, resolved to a number. */
function partScalar(part: CalcPart, rank: number, level: number): number | null {
  switch (part.kind) {
    case 'flat':
      return pickRank(part.perRank, rank);
    case 'byLevel':
      return evaluateByLevel(part, level);
    case 'stat':
      // Callers handle stat parts separately; treating one as a scalar here
      // would drop the stat it scales with.
      return null;
    case 'unsupported':
      return null;
  }
}

/**
 * The full value of a calculation.
 *
 * `null` means "this calculator could not read the formula" — the caller is
 * expected to fall back to a maintained constant and say so.
 */
export function evaluate(
  calc: SpellCalculation | null,
  rank: number,
  stats: StatLookup,
): number | null {
  const parts = breakdown(calc, rank, stats.level);
  if (!parts) return null;
  let total = parts.flat;
  for (const entry of parts.ratios) {
    total += entry.ratio * stats.value(entry.stat, entry.scaling);
  }
  return total;
}

/** The combined ratio for one stat, e.g. Vi's bonus-AD ratio on Q. */
export function ratioFor(
  calc: SpellCalculation | null,
  rank: number,
  stat: StatKey,
  scaling: StatScaling,
): number | null {
  const parts = breakdown(calc, rank);
  if (!parts) return null;
  const matching = parts.ratios.filter((entry) => entry.stat === stat && entry.scaling === scaling);
  if (matching.length === 0) return null;
  return matching.reduce((sum, entry) => sum + entry.ratio, 0);
}

/* ----------------------------------------------------------------- formatting */

/** A number as the tooltips print it, without trailing zeros. */
export function num(value: number, maxDecimals = 2): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded);
}

const STAT_LABELS: Record<StatKey, Record<StatScaling, string>> = {
  ad: { total: 'total AD', bonus: 'bonus AD' },
  ap: { total: 'AP', bonus: 'AP' },
  maxHealth: { total: 'maximum health', bonus: 'bonus health' },
  attackSpeed: { total: 'attack speed', bonus: 'bonus attack speed' },
};

/**
 * Render a calculation the way the client tooltip reads.
 *
 * Percentage calculations (Vi's W is a share of the target's maximum health)
 * carry a literal ×0.01 in the bin purely to turn "4" into "4 %". That factor
 * is folded into the units here instead of being printed, because "4 % + 3.5 %
 * per 100 bonus AD" is the line the client actually shows.
 */
export function formatCalculation(calc: SpellCalculation | null, rank: number): string | null {
  if (!calc || !calc.complete) return null;
  const percent = calc.displayAsPercent;

  const printedMultipliers: number[] = [];
  for (const part of calc.multipliers) {
    const value = partScalar(part, rank, MAX_LEVEL);
    if (value === null) return null;
    // The percent conversion factor is a unit, not a coefficient worth showing.
    if (percent && Math.abs(value - 0.01) < 1e-9) continue;
    printedMultipliers.push(value);
  }

  const terms: string[] = [];
  for (const part of calc.parts) {
    switch (part.kind) {
      case 'flat': {
        const value = pickRank(part.perRank, rank);
        if (value === null) return null;
        terms.push(percent ? `${num(value)}%` : num(value));
        break;
      }
      case 'stat': {
        const coefficient = pickRank(part.perRank, rank);
        if (coefficient === null) return null;
        const label = STAT_LABELS[part.stat][part.scaling];
        terms.push(
          percent
            ? `${num(coefficient * 100)}% per 100 ${label}`
            : `${num(coefficient * 100)}% ${label}`,
        );
        break;
      }
      case 'byLevel': {
        const low = evaluateByLevel(part, MIN_LEVEL);
        const high = evaluateByLevel(part, MAX_LEVEL);
        terms.push(`${num(low)} → ${num(high)} (level 1 → 18)`);
        break;
      }
      case 'unsupported':
        return null;
    }
  }

  const sum = terms.join(' + ');
  if (printedMultipliers.length === 0) return sum;
  const factors = printedMultipliers.map((value) => num(value)).join(' × ');
  return terms.length > 1 ? `(${sum}) × ${factors}` : `${sum} × ${factors}`;
}
