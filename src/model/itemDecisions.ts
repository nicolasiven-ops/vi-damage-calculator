/**
 * Every shop item, and what has been decided about it.
 *
 * This file exists because the dangerous state for a damage calculator is not
 * "unmodelled" — it is *unexamined*. An item nobody has looked at contributes
 * its stats, says nothing about its passive, and quietly under-reports a build.
 * So every item on Summoner's Rift gets a verdict here, and the coverage test
 * fails when a patch introduces one that has none.
 *
 * Three verdicts, and the difference matters:
 *  - `modelled`: the passive is implemented in `itemEffects.ts`.
 *  - `no-damage-effect`: examined and dismissed. A ward has no damage passive;
 *    saying so is a decision, not an omission.
 *  - `todo`: the passive would change a damage number and does not yet. Carries
 *    the mechanic it belongs to, so the work can be done a mechanic at a time
 *    rather than an item at a time.
 */

/** The shapes almost every item passive in the game reduces to. */
import { REGISTERED_ITEM_IDS } from './itemEffects';

export type ItemMechanic =
  /** Extra damage folded into a basic attack. */
  | 'on-hit-rider'
  /** The next attack after an ability deals bonus damage. */
  | 'spellblade'
  /** A proc gated on a condition or an internal cooldown. */
  | 'first-hit-condition'
  /** Damage that grows while you keep fighting. */
  | 'stacking-amp'
  /** Reduces or ignores resistances. */
  | 'shred-or-pen'
  /** Scales with someone's maximum health. */
  | 'percent-health'
  /** Damage over time. */
  | 'burn-dot'
  /** Changes crit chance, crit damage, or what may crit. */
  | 'crit-modifier'
  /** Lifesteal, omnivamp, shields, heal-and-shield power. */
  | 'vamp-or-shield'
  /** Grievous wounds. */
  | 'antiheal'
  /** Only matters on the receiving end. */
  | 'target-defensive'
  /** Has a button. */
  | 'active'
  /** Not yet examined. */
  | 'unclassified';

export type ItemVerdict =
  | { kind: 'modelled' }
  | { kind: 'no-damage-effect'; why: string }
  | { kind: 'todo'; mechanic: ItemMechanic; why?: string };

/**
 * Every item whose passive is implemented — read off the registry itself.
 *
 * It used to be a hand-kept list checked against the implementation, which was
 * the right shape while thirteen items were modelled by hand in one file. With
 * six families registering their own entries, a hand-kept list is a second
 * source of truth that can only ever fall behind, so the direction is reversed:
 * the registry is the fact and this is the view of it.
 */
export const MODELLED_ITEM_IDS: readonly string[] = REGISTERED_ITEM_IDS;

/** Items whose passive text cannot reach a damage number, and why. */
const NO_DAMAGE: Record<string, string> = {
  '2003': 'Health potion: healing out of combat.',
  '2031': 'Refillable potion: healing out of combat.',
  '2055': 'Control ward: vision.',
  '3330': 'Effigy: vision.',
  '3340': 'Stealth ward: vision.',
  '3363': 'Farsight alteration: vision.',
  '3364': 'Oracle lens: vision.',
  '3599': "Kalista's spear: a bond with an ally, not damage.",
  '3600': "Kalista's spear: a bond with an ally, not damage.",
  '3865': 'World Atlas: gold income and vision.',
  '2141': 'Cappa Juice: healing.',
};

/**
 * The verdicts.
 *
 * Everything not named above starts as `unclassified`, which the coverage test
 * reports as a count. That count is the honest measure of how far the item work
 * has got, and it is meant to reach zero.
 */
export const ITEM_DECISIONS: Record<string, ItemVerdict> = {
  ...Object.fromEntries(
    MODELLED_ITEM_IDS.map((id) => [id, { kind: 'modelled' } as ItemVerdict]),
  ),
  ...Object.fromEntries(
    Object.entries(NO_DAMAGE).map(([id, why]) => [id, { kind: 'no-damage-effect', why } as ItemVerdict]),
  ),
};

export function itemVerdict(id: string): ItemVerdict {
  return ITEM_DECISIONS[id] ?? { kind: 'todo', mechanic: 'unclassified' };
}

/**
 * How far the item work has got.
 *
 * Counted over the items that *can* have a passive worth modelling, not over
 * every line in the shop. A shop dump is 218 entries, but 112 of those are
 * components, consumables and trinkets: a component is a stat line by
 * construction, already handled by the description parser, and counting it as an
 * unmodelled item made the number read far worse than the work is. What is left
 * is the ~104 completed items whose text actually contains a passive — that is
 * the denominator this project is trying to close.
 */
export interface ItemCoverage {
  /** Completed items with a passive: the honest denominator. */
  relevant: number;
  modelled: number;
  dismissed: number;
  todo: number;
  unclassified: number;
  /** Everything in the shop, for context. */
  shopTotal: number;
  /** Components and consumables, which need no passive modelled. */
  statOnly: number;
}

export interface CoverageItem {
  id: string;
  completed: boolean;
  hasPassive: boolean;
}

export function itemCoverage(items: CoverageItem[]): ItemCoverage {
  let modelled = 0;
  let dismissed = 0;
  let todo = 0;
  let unclassified = 0;
  let relevant = 0;
  let statOnly = 0;

  for (const item of items) {
    if (!item.completed || !item.hasPassive) {
      statOnly += 1;
      continue;
    }
    relevant += 1;
    const verdict = itemVerdict(item.id);
    if (verdict.kind === 'modelled') modelled += 1;
    else if (verdict.kind === 'no-damage-effect') dismissed += 1;
    else {
      todo += 1;
      if (verdict.mechanic === 'unclassified') unclassified += 1;
    }
  }

  return {
    relevant,
    modelled,
    dismissed,
    todo,
    unclassified,
    shopTotal: items.length,
    statOnly,
  };
}
