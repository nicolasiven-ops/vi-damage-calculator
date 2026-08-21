/**
 * What each item in the build is actually doing, and what it cost to do it.
 *
 * Measured, not reasoned: take the item out, run the same combo against the same
 * target, and the difference is the item's contribution. That catches everything
 * an argument about stats misses — the attack speed that fits one more auto into
 * the window, the haste that brings an ability back before the combo ends, the
 * shred that makes every later hit land harder, the proc that only fires because
 * something else in the build slowed the target down.
 *
 * Two numbers come out and they are worth the same amount:
 *
 *   contribution — damage the item is responsible for, in this combo
 *   value        — that damage per 1,000 gold, which is the only way to compare
 *                  a 1,300 g component with a 3,300 g legendary
 *
 * Both are honest about one thing: an item's contribution depends on the rest of
 * the build. Removing Black Cleaver makes Lord Dominik's worth *more*, so the
 * contributions do not add up to the total, and this deliberately does not
 * pretend otherwise. Each row answers "what does removing this cost me", which
 * is the question you ask in the shop.
 */

import type { ComboAnalysis } from '../engine/analysis';

export interface ItemValueRow {
  id: string;
  name: string;
  imageFile: string;
  /** What the item costs to buy outright. */
  gold: number;
  /** Damage the combo does as it stands. */
  damageWith: number;
  /** Damage the same combo does with this one item taken out. */
  damageWithout: number;
  /** The difference: what this item is responsible for. */
  contribution: number;
  /** Contribution as a share of the whole combo's damage. */
  share: number;
  /** Contribution per 1,000 gold — null for items that cost nothing. */
  perThousandGold: number | null;
  /** Does the combo still kill without it? */
  killsWithout: boolean;
  /** Does it kill with it? (If not, nothing here is a kill decision.) */
  killsWith: boolean;
  /**
   * True when this item's passive is modelled.
   *
   * A false here does not make the number wrong — the stats are real and their
   * effect is measured — but it does make it a floor rather than the whole
   * story, and the panel says so rather than quietly presenting a stat stick as
   * the finished answer.
   */
  passiveModelled: boolean;
}

export interface ItemValueInputs {
  /** The items in the build, in slot order, empty slots already dropped. */
  items: { id: string; name: string; imageFile: string; gold: number }[];
  /** The build as it stands. */
  base: ComboAnalysis;
  /** Runs the same build with exactly these items. */
  runWithout: (itemId: string) => ComboAnalysis | null;
  /** Which items have their passive modelled. */
  isModelled: (itemId: string) => boolean;
}

export function itemValues(inputs: ItemValueInputs): ItemValueRow[] {
  const damageWith = inputs.base.totalMitigated;
  const killsWith = inputs.base.killTime !== null;

  const rows: ItemValueRow[] = [];
  for (const item of inputs.items) {
    const without = inputs.runWithout(item.id);
    if (!without) continue;

    const contribution = damageWith - without.totalMitigated;
    rows.push({
      id: item.id,
      name: item.name,
      imageFile: item.imageFile,
      gold: item.gold,
      damageWith,
      damageWithout: without.totalMitigated,
      contribution,
      share: damageWith > 0 ? contribution / damageWith : 0,
      // Gold of zero happens for starter rewards and quest completions; a
      // division there would print Infinity and call it value.
      perThousandGold: item.gold > 0 ? (contribution / item.gold) * 1000 : null,
      killsWithout: without.killTime !== null,
      killsWith,
      passiveModelled: inputs.isModelled(item.id),
    });
  }

  /*
   * Ranked by contribution, because the ranking is the point: the first row is
   * the item this combo leans on. Ties break on value, so the cheaper of two
   * equal contributors sits above the dearer one.
   */
  return rows.sort(
    (a, b) => b.contribution - a.contribution || (b.perThousandGold ?? 0) - (a.perThousandGold ?? 0),
  );
}

/** The one item whose removal breaks the kill, if there is exactly one. */
export function killCarriedBy(rows: ItemValueRow[]): ItemValueRow | null {
  const breakers = rows.filter((row) => row.killsWith && !row.killsWithout);
  return breakers.length === 1 ? breakers[0]! : null;
}
