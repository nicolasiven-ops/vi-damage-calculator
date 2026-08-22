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
  /** Needs to shorten a running cooldown, which no hook can reach. */
  | 'needs-cooldown-hook'
  /** Needs the attacker's own current or missing health, which is not simulated. */
  | 'needs-own-health'
  /** Only puts crowd control on the timeline; changes no number. */
  | 'crowd-control'
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

/**
 * Items whose passive cannot reach a damage number, and why.
 *
 * Every line here has been read against Riot's own text. That is the whole
 * point of the entry: an item nobody has looked at and an item that has been
 * looked at and cannot matter are both 'not modelled', and only one of them is
 * work left to do.
 *
 * The recurring reasons are worth naming, because they are properties of *this*
 * simulation rather than of the items: there is one attacker and one target, so
 * everything ally-facing is out; the attacker's own health is not simulated, so
 * lifelines are out; the target is never healed or shielded, so anti-heal and
 * shield-shred have nothing to act on; and area damage that lands beside the
 * target is real damage that never reaches it.
 */
const NO_DAMAGE: Record<string, string> = {
  '2065': "Shurelya's Battlesong: movement speed for nearby allies.",
  '2504': "Kaenic Rookern: a magic shield out of combat.",
  '2524': "Bandlepipes: movement speed after immobilising something.",
  '2525': "Protoplasm Harness: a lifeline that grants health below 30%.",
  '3026': "Guardian Angel: revives; nothing about damage dealt.",
  '3033': "Mortal Reminder: Grievous Wounds, and the target is never healed here.",
  '3041': "Mejai's Soulstealer: stacks come from takedowns before the fight, and the app asks for no stack count.",
  '3046': "Phantom Dancer: ghosting, and nothing else.",
  '3065': "Spirit Visage: raises healing and shielding on the wearer.",
  '3072': "Bloodthirster: turns excess lifesteal into a shield.",
  '3074': "Ravenous Hydra: Cleave hits enemies *around* the target; the active needs the active hook.",
  '3075': "Thornmail: damages whoever attacks *you*, which is nobody in this model.",
  '3083': "Warmog's Armor: out-of-combat health regeneration.",
  '3085': "Runaan's Hurricane: bolts fly at other enemies, not the one you hit.",
  '3102': "Banshee's Veil: a spell shield.",
  '3107': "Redemption: an ally heal on an area active; its true damage needs the active hook.",
  '3109': "Knight's Vow: redirects damage from an ally, who does not exist here.",
  '3110': "Frozen Heart: lowers the attack speed of enemies near you, not your own damage.",
  '3137': "Cryptbloom: a healing nova when a champion you damaged dies.",
  '3139': "Mercurial Scimitar: cleanses crowd control and grants movement speed.",
  '3142': "Youmuu's Ghostblade: out-of-combat movement speed and ghosting.",
  '3143': "Randuin's Omen: reduces critical damage taken, and slows.",
  '3156': "Maw of Malmortius: a lifeline shield against magic damage.",
  '3157': "Zhonya's Hourglass: stasis.",
  '3165': "Morellonomicon: the same, on magic damage.",
  '3190': "Locket of the Iron Solari: a shield for nearby allies.",
  '3222': "Mikael's Blessing: cleanses and heals an ally.",
  '3504': "Ardent Censer: arms itself by healing an ally, which never happens here.",
  '3814': "Edge of Night: a spell shield.",
  '4005': "Imperial Mandate: pays out when an ally hits the marked target.",
  '4401': "Force of Nature: magic resistance and movement speed after being hit.",
  '4628': "Horizon Focus: Riot's resolved text for Hypershot and Focus is reveal-only; the damage the bin once carried is not in the live text.",
  '4629': "Cosmic Drive: movement speed after dealing damage.",
  '6333': "Death's Dance: defers damage taken; nothing outgoing.",
  '6609': "Chempunk Chainsword: the same, on physical damage.",
  '6616': "Staff of Flowing Water: triggered by healing or shielding an ally.",
  '6617': "Moonstone Renewer: chains an ally heal to another ally.",
  '6620': "Echoes of Helia: converts damage into ally healing.",
  '6621': "Dawncore: scales heal and shield power, which no attacker uses.",
  '6631': "Stridebreaker: Cleave is off-target, and Breaking Shockwave is an active.",
  '6657': "Rod of Ages: stacks over ten minutes, which no combo spans, and the app asks for no stack count.",
  '6665': "Jak'Sho, The Protean: grows the wearer's resistances in a long fight.",
  '6673': "Immortal Shieldbow: a lifeline shield below 30% health.",
  '6695': "Serpent's Fang: reduces shields the target gains, and the target gains none.",
  '6696': "Axiom Arc: refunds ultimate cooldown on a takedown, after the combo is over.",
  '6697': "Hubris: attack damage on a takedown, and the combo ends at the kill.",
  '6698': "Profane Hydra: Cleave is off-target, and Heretical Cleave is an active.",
};

/**
 * Items whose passive *would* reach a damage number, and what is in the way.
 *
 * These are the honest to-do list: the numbers are known and read out of Riot's
 * own files, and the engine cannot yet express them. Each one names the missing
 * capability, so the next engine feature can be chosen by how many of these it
 * unblocks rather than by whichever item came to mind.
 */
const BLOCKED: Record<string, { mechanic: ItemMechanic; why: string }> = {
  '2501': { mechanic: 'needs-own-health', why: "Overlord's Bloodmail: Tyranny is modelled; Retribution ramps to +12% attack damage below 70% of the attacker's own health." },
  '2512': { mechanic: 'crit-modifier', why: "Fiendhunter Bolts: after the ultimate, three attacks crit at 80% of normal crit damage, or add 15% true damage if they would have crit anyway." },
  '3053': { mechanic: 'needs-own-health', why: "Sterak's Gage: the attack damage is modelled; the Lifeline shield needs the attacker's own health." },
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
  ...Object.fromEntries(
    Object.entries(BLOCKED).map(([id, entry]) => [
      id,
      { kind: 'todo', mechanic: entry.mechanic, why: entry.why } as ItemVerdict,
    ]),
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
