/**
 * What a stat is worth to this combo, per point and per gold.
 *
 * The same measurement as the item ledger, one level down: add some of a stat,
 * re-run the identical combo, and the difference is what that stat did. Nothing
 * about it is theoretical — the attack speed that fits one more auto into the
 * window shows up here, and so does the ability haste that brings E back before
 * the last press, because both change the run rather than the arithmetic.
 *
 * Two readings, and the second is the one that decides a purchase:
 *
 *   per point   — how much one more point is worth right now
 *   per 1,000 g — how much a thousand gold spent on *only* that stat is worth
 *
 * The gold rate comes from the shop itself: for each stat, the cheapest item that
 * sells nothing but that stat. Long Sword prices attack damage, Dagger prices
 * attack speed, Cloak of Agility prices crit. Where the shop has no single-stat
 * source — lethality is the notable one, it always arrives bundled — the row says
 * so instead of inventing a price.
 *
 * One honest limit, and it is the same one the item ledger has: this measures a
 * stat in isolation, and the shop does not sell stats in isolation. It answers
 * "what would more of this be worth", which is the question you ask *before*
 * looking at what an item bundles alongside it.
 */

import type { ComboAnalysis } from '../engine/analysis';
import type { ResolvedItem } from './items';
import type { StatBlock } from './stats';

/** A stat worth probing, and the step size the per-point column reports. */
export interface StatProbe {
  key: keyof StatBlock;
  label: string;
  /** Printed after the amount: '' for flat stats, '%' for the percentage ones. */
  unit: string;
  /**
   * The increment measured for the per-point column, in the engine's own units.
   *
   * The engine keeps the percentage stats as fractions — crit chance 0.25, attack
   * speed 0.35 — so the step is written in those units and `factor` turns it back
   * into the number a player says out loud.
   */
  step: number;
  /** Multiply by this to display: 100 for the fractional stats, 1 for the rest. */
  factor: number;
}

/**
 * The stats that can change a damage number, in the order they are shown.
 *
 * Health, armour and the rest of the defensive block are deliberately absent:
 * they change what the *attacker* survives, and this simulation only has the
 * attacker hitting. A row that always reads zero teaches nothing.
 */
export const STAT_PROBES: StatProbe[] = [
  { key: 'attackDamage', label: 'Attack damage', unit: '', step: 10, factor: 1 },
  { key: 'abilityPower', label: 'Ability power', unit: '', step: 20, factor: 1 },
  { key: 'critChance', label: 'Critical strike', unit: '%', step: 0.1, factor: 100 },
  { key: 'critDamage', label: 'Critical damage', unit: '%', step: 0.1, factor: 100 },
  { key: 'attackSpeed', label: 'Attack speed', unit: '%', step: 0.1, factor: 100 },
  { key: 'lethality', label: 'Lethality', unit: '', step: 5, factor: 1 },
  { key: 'armorPenPercent', label: 'Armour penetration', unit: '%', step: 0.05, factor: 100 },
  { key: 'magicPenFlat', label: 'Magic penetration', unit: '', step: 5, factor: 1 },
  { key: 'magicPenPercent', label: 'Magic penetration', unit: '%', step: 0.05, factor: 100 },
  { key: 'abilityHaste', label: 'Ability haste', unit: '', step: 10, factor: 1 },
  { key: 'basicAbilityHaste', label: 'Basic ability haste', unit: '', step: 10, factor: 1 },
];

export interface StatValueRow {
  key: keyof StatBlock;
  label: string;
  unit: string;
  /** The increment that was measured for the per-point reading. */
  step: number;
  /** Multiply amounts by this to display them. */
  factor: number;
  /** Damage gained by adding `step` of this stat. */
  perStep: number;
  /**
   * Seconds the combo gets shorter for a thousand gold of this stat.
   *
   * Attack speed and ability haste buy *time*, not damage: with a fixed list of
   * steps, every hit still lands, just sooner. Dropping those rows for reading
   * zero damage would hide the two stats a player most expects to see, so the
   * clock is reported as its own quantity — and a shorter combo is a real
   * advantage, because the target has less of it to answer in.
   */
  secondsSaved: number;
  /**
   * What a thousand gold buys of this stat, and what that is worth.
   *
   * Null when the shop has no item that sells this stat on its own — the
   * measurement is still real, it just cannot be priced honestly.
   */
  gold: { perThousand: number; amountPerThousand: number; sourceName: string } | null;
}

export interface StatGoldRate {
  goldPerPoint: number;
  sourceName: string;
}

/**
 * The shop's own price for one point of each stat.
 *
 * Derived rather than tabulated, so it follows Riot's pricing when it moves: the
 * cheapest purchasable item whose stat block contains exactly one non-zero entry
 * for this stat *is* the market price of that stat.
 */
export function statGoldRates(items: ResolvedItem[]): Map<keyof StatBlock, StatGoldRate> {
  const out = new Map<keyof StatBlock, StatGoldRate>();

  for (const item of items) {
    if (item.gold <= 0) continue;
    const nonZero = (Object.entries(item.stats) as [keyof StatBlock, number][]).filter(
      ([, value]) => Math.abs(value) > 0.0001,
    );
    if (nonZero.length !== 1) continue;

    const [key, amount] = nonZero[0]!;
    if (amount <= 0) continue;
    const rate = item.gold / amount;
    const seen = out.get(key);
    if (!seen || rate < seen.goldPerPoint) {
      out.set(key, { goldPerPoint: rate, sourceName: item.name });
    }
  }

  return out;
}

export interface StatValueInputs {
  base: ComboAnalysis;
  /** Runs the same build with these stats added on top. */
  run: (bonus: Partial<StatBlock>) => ComboAnalysis | null;
  rates: Map<keyof StatBlock, StatGoldRate>;
  probes?: StatProbe[];
  /** The budget the gold column is normalised to. */
  budget?: number;
}

export function statValues(inputs: StatValueInputs): StatValueRow[] {
  const probes = inputs.probes ?? STAT_PROBES;
  const budget = inputs.budget ?? 1000;
  const baseDamage = inputs.base.totalMitigated;
  const rows: StatValueRow[] = [];

  for (const probe of probes) {
    const stepRun = inputs.run({ [probe.key]: probe.step } as Partial<StatBlock>);
    if (!stepRun) continue;
    const perStep = stepRun.totalMitigated - baseDamage;

    const rate = inputs.rates.get(probe.key);
    let gold: StatValueRow['gold'] = null;
    let secondsSaved = 0;
    if (rate && rate.goldPerPoint > 0) {
      const amount = budget / rate.goldPerPoint;
      const budgetRun = inputs.run({ [probe.key]: amount } as Partial<StatBlock>);
      if (budgetRun) {
        gold = {
          perThousand: budgetRun.totalMitigated - baseDamage,
          amountPerThousand: amount,
          sourceName: rate.sourceName,
        };
        secondsSaved = inputs.base.duration - budgetRun.duration;
      }
    }

    // A stat this combo cannot use at all is not a row worth a line — crit on a
    // pure-ability combo is the honest example, and printing "0" ten times
    // buries the four stats that do something. A stat that only moves the clock
    // stays: that is a finding, not a nothing.
    if (
      Math.abs(perStep) < 0.05 &&
      (!gold || Math.abs(gold.perThousand) < 0.05) &&
      Math.abs(secondsSaved) < 0.02
    ) {
      continue;
    }

    rows.push({
      key: probe.key,
      label: probe.label,
      unit: probe.unit,
      step: probe.step,
      factor: probe.factor,
      perStep,
      secondsSaved,
      gold,
    });
  }

  /*
   * Ranked by what a thousand gold buys, because that is the decision. Stats
   * that cannot be priced sort last rather than first — they are not free, they
   * are unpriceable, and putting them at the top would read as an endorsement.
   */
  return rows.sort((a, b) => (b.gold?.perThousand ?? -1) - (a.gold?.perThousand ?? -1));
}
