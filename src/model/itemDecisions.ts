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
 * The passives already implemented in `itemEffects.ts`.
 *
 * Kept as a list rather than derived, so the coverage test can check the two
 * against each other: a decision claiming "modelled" for an item with no
 * implementation is a lie the test catches.
 */
export const MODELLED_ITEM_IDS = [
  '3057', // Sheen
  '3078', // Trinity Force
  '3508', // Essence Reaver
  '3071', // Black Cleaver
  '3153', // Blade of the Ruined King
  '3748', // Titanic Hydra
  '3115', // Nashor's Tooth
  '3091', // Wit's End
  '3036', // Lord Dominik's Regards
  '6692', // Eclipse
  '6610', // Sundered Sky
  '6699', // Voltaic Cyclosword
  '3161', // Spear of Shojin
] as const;

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

/** How far the item work has got, for the notes panel and for the test. */
export function itemCoverage(shopIds: string[]): {
  modelled: number;
  dismissed: number;
  todo: number;
  unclassified: number;
} {
  let modelled = 0;
  let dismissed = 0;
  let todo = 0;
  let unclassified = 0;
  for (const id of shopIds) {
    const verdict = itemVerdict(id);
    if (verdict.kind === 'modelled') modelled += 1;
    else if (verdict.kind === 'no-damage-effect') dismissed += 1;
    else {
      todo += 1;
      if (verdict.mechanic === 'unclassified') unclassified += 1;
    }
  }
  return { modelled, dismissed, todo, unclassified };
}
