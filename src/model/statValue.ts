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
import { PERCENT_STATS, STAT_KEYS, STAT_LABELS, type StatBlock } from './stats';

/**
 * The stats worth probing, in the order the panel shows them.
 *
 * Labels and units come from `stats.ts` — there is one naming of a stat in this
 * codebase and this is not a second one. Health, armour and the rest of the
 * defensive block are absent on purpose: they change what the *attacker*
 * survives, and this simulation only has the attacker hitting, so their row
 * would always read zero.
 */
export const STAT_PROBES: (keyof StatBlock)[] = [
  'attackDamage',
  'abilityPower',
  'critChance',
  'critDamage',
  'attackSpeed',
  'lethality',
  'armorPenPercent',
  'magicPenFlat',
  'magicPenPercent',
  'abilityHaste',
  'basicAbilityHaste',
  'lifesteal',
  'omnivamp',
  'physicalVamp',
];

/** How a stored value becomes the number a player says out loud. */
export function displayFactor(key: keyof StatBlock): number {
  return PERCENT_STATS.has(key) ? 100 : 1;
}

/** The unit printed after an amount: '%' for the fractional stats. */
export function displayUnit(key: keyof StatBlock): string {
  return PERCENT_STATS.has(key) ? '%' : '';
}

export interface StatValueRow {
  key: keyof StatBlock;
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
  gold: {
    perThousand: number;
    amountPerThousand: number;
    /** The base gold value of one displayed unit. */
    goldPerPoint: number;
    sourceName: string;
    /** For a stat never sold alone: what was subtracted to isolate it. */
    derivedFrom?: string;
  } | null;
}

export interface StatGoldRate {
  /** Gold for one displayed unit: 35 for one attack damage, 40 for one % crit. */
  goldPerPoint: number;
  /** The item that set the price. */
  sourceName: string;
  /** For a stat that is never sold alone: what was subtracted to isolate it. */
  derivedFrom?: string;
}

/**
 * Base gold values: what one unit of each stat costs in the shop.
 *
 * Two rules, both the ones the community has used for years, because they are the
 * only ones the shop actually supports.
 *
 * A stat is priced by the CHEAPEST ITEM THAT SELLS IT, not by the best rate on
 * offer. Long Sword is 350 g for 10 attack damage, so attack damage costs 35 g a
 * point - even though B. F. Sword sells it at 32.5. The cheap component is the
 * price of the raw material; the big item's discount is part of what makes the
 * big item good.
 *
 * A stat that is never sold alone is priced BY SUBTRACTION. Serrated Dirk is
 * 1,000 g for 20 attack damage and 10 lethality; the attack damage in it is worth
 * 700 g at the price above, so the lethality is the remaining 300 g - 30 g a
 * point. The panel names what was subtracted, because a derived price is only as
 * good as the prices underneath it.
 *
 * Both fall out of the item file, so they follow Riot's pricing when it moves
 * instead of ageing in a table.
 */
export function statGoldRates(items: ResolvedItem[]): Map<keyof StatBlock, StatGoldRate> {
  const rates = new Map<keyof StatBlock, StatGoldRate>();
  const priceable = items.filter((item) => item.gold > 0).sort((a, b) => a.gold - b.gold);

  const statsOf = (item: ResolvedItem): [keyof StatBlock, number][] =>
    (Object.entries(item.stats) as [keyof StatBlock, number][]).filter(
      ([, value]) => value > 0.0001,
    );

  // Pass one: everything the shop sells on its own, cheapest item first.
  for (const item of priceable) {
    const stats = statsOf(item);
    if (stats.length !== 1) continue;
    const [key, amount] = stats[0]!;
    if (rates.has(key)) continue;
    rates.set(key, {
      goldPerPoint: item.gold / (amount * displayFactor(key)),
      sourceName: item.name,
    });
  }

  /*
   * Then subtraction, repeatedly: an item bundling one unpriced stat with priced
   * ones tells us what the unpriced one costs. Repeating lets a stat priced this
   * way price the next one, and four passes is deeper than the shop goes, so the
   * loop stops on its own.
   */
  for (let pass = 0; pass < 4; pass += 1) {
    let priced = false;
    for (const item of priceable) {
      const stats = statsOf(item);
      if (stats.length < 2) continue;
      const unknown = stats.filter(([key]) => !rates.has(key));
      if (unknown.length !== 1) continue;

      const [key, amount] = unknown[0]!;
      const known = stats.filter(([entry]) => rates.has(entry));
      const spent = known.reduce(
        (sum, [entry, value]) =>
          sum + value * displayFactor(entry) * rates.get(entry)!.goldPerPoint,
        0,
      );
      const residual = item.gold - spent;
      // A non-positive residual means the priced stats already account for the
      // whole item: that is a statement about the item, not a price for the stat.
      if (residual <= 0) continue;

      rates.set(key, {
        goldPerPoint: residual / (amount * displayFactor(key)),
        sourceName: item.name,
        derivedFrom: known
          .map(
            ([entry, value]) =>
              `${Math.round(value * displayFactor(entry))} ${STAT_LABELS[entry].toLowerCase()}`,
          )
          .join(' + '),
      });
      priced = true;
    }
    if (!priced) break;
  }

  return rates;
}

export interface StatValueInputs {
  base: ComboAnalysis;
  /** Runs the same build with these stats added on top. */
  run: (bonus: Partial<StatBlock>) => ComboAnalysis | null;
  rates: Map<keyof StatBlock, StatGoldRate>;
  probes?: (keyof StatBlock)[];
  /** The budget the gold column is normalised to. */
  budget?: number;
}

export function statValues(inputs: StatValueInputs): StatValueRow[] {
  const probes = inputs.probes ?? STAT_PROBES;
  const budget = inputs.budget ?? 1000;
  const baseDamage = inputs.base.totalMitigated;
  const rows: StatValueRow[] = [];

  for (const key of probes) {
    // One displayed unit: 1 attack damage, 1 % crit, 1 lethality.
    const unit = 1 / displayFactor(key);
    const stepRun = inputs.run({ [key]: unit } as Partial<StatBlock>);
    if (!stepRun) continue;
    const perStep = stepRun.totalMitigated - baseDamage;

    const rate = inputs.rates.get(key);
    let gold: StatValueRow['gold'] = null;
    let secondsSaved = 0;
    if (rate && rate.goldPerPoint > 0) {
      // The rate is per displayed unit, so what a budget buys is too — and the
      // engine wants it back in its own units.
      const amount = (budget / rate.goldPerPoint) * unit;
      const budgetRun = inputs.run({ [key]: amount } as Partial<StatBlock>);
      if (budgetRun) {
        gold = {
          perThousand: budgetRun.totalMitigated - baseDamage,
          amountPerThousand: amount,
          goldPerPoint: rate.goldPerPoint,
          sourceName: rate.sourceName,
          ...(rate.derivedFrom ? { derivedFrom: rate.derivedFrom } : {}),
        };
        secondsSaved = inputs.base.duration - budgetRun.duration;
      }
    }

    /*
     * A stat this combo cannot use is not a row worth a line — crit on a
     * pure-ability combo is the honest example, and ten zeroes bury the four
     * stats that do something. A stat that only moves the clock stays: that is a
     * finding, not a nothing.
     */
    if (
      Math.abs(perStep) < 0.005 &&
      (!gold || Math.abs(gold.perThousand) < 0.05) &&
      Math.abs(secondsSaved) < 0.02
    ) {
      continue;
    }

    rows.push({ key, perStep, secondsSaved, gold });
  }

  /*
   * Ranked by what a thousand gold buys, because that is the decision. Stats
   * that cannot be priced sort last rather than first — they are not free, they
   * are unpriceable, and putting them at the top would read as an endorsement.
   */
  return rows.sort((a, b) => (b.gold?.perThousand ?? -1) - (a.gold?.perThousand ?? -1));
}

/**
 * Every stat the shop puts a price on, for the reference table.
 *
 * The whole StatBlock rather than the damage-relevant slice: a table of base gold
 * values is a reference, and a reference with holes in it sends the reader
 * somewhere else. Stats the shop never prices are listed as unpriced instead of
 * being left out, because "nothing sells this on its own" is itself the answer.
 */
export interface StatPriceRow {
  key: keyof StatBlock;
  label: string;
  unit: string;
  rate: StatGoldRate | null;
}

export function statPriceTable(rates: Map<keyof StatBlock, StatGoldRate>): StatPriceRow[] {
  return STAT_KEYS.map((key) => ({
    key,
    label: STAT_LABELS[key],
    unit: displayUnit(key),
    rate: rates.get(key) ?? null,
  }));
}
