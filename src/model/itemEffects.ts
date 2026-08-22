/**
 * Item passives.
 *
 * Data Dragon gives us an item's stats (see `items.ts`) but its passives exist
 * only as prose. The ones that meaningfully change a damage combo are modelled
 * here by hand, keyed by Data Dragon item id.
 *
 * Any selected item without an entry still contributes its full stat line — it
 * is only the passive that goes unmodelled, and the analysis lists exactly
 * which items that applies to so no damage silently goes missing.
 *
 * Last reviewed against patch 26.16.
 */

import type { SimContext } from '../engine/context';
import type { AbilitySlot, DamageType } from '../engine/types';
import type { StatBlock } from './stats';
import { ABILITY_ITEMS } from './items/ability';
import { BRUISER_ITEMS } from './items/bruiser';
import { BURN_ITEMS } from './items/burn';
import { CRIT_ITEMS } from './items/crit';
import { ONHIT_ITEMS } from './items/onhit';
import { PENETRATION_ITEMS } from './items/penetration';
import type { HitInfo } from './runes';

export interface ItemAttackRider {
  amount: number;
  type: DamageType;
  label: string;
  notes?: string[];
}

export interface ItemRuntime {
  /**
   * A multiplier that depends on state this runtime is keeping.
   *
   * The stateless `ItemEffect.amplify` covers the amplifiers that only read the
   * present — Lord Dominik's compares two health pools and needs no memory. A
   * stacking amplifier does need memory, and memory lives in the runtime, so it
   * amplifies from here. Both are applied; an item that implements both would be
   * counted twice, which is why no item does.
   */
  amplify?(ctx: SimContext, hit: AmplifiableHit): number;
  /** Called after any damage instance the attacker deals. */
  onHitLanded?(ctx: SimContext, hit: HitInfo): void;
  /** Called whenever an ability is cast. */
  onAbilityCast?(ctx: SimContext, slot: AbilitySlot): void;
  /**
   * Extra damage folded into the current basic attack. Called once per attack,
   * so single-use effects may consume themselves here.
   */
  onBasicAttack?(ctx: SimContext): ItemAttackRider | null;
}

/**
 * What an amplifier is allowed to know about the hit it is scaling.
 *
 * The same shape the rune amplifiers get — one vocabulary for both, so a
 * mechanic implemented once works wherever it is bought from.
 */
export type AmplifiableHit = Omit<HitInfo, 'mitigated' | 'targetHealthPercentAfter'>;

export interface ItemEffect {
  id: string;
  name: string;
  modelled: boolean;
  note: string;
  /**
   * Stats the passive grants that Data Dragon's `<stats>` block does not list.
   *
   * Riot writes some stats into the passive text instead: Spear of Shojin's
   * "Gain 25 Basic Ability Haste" is a passive line, not a stat line, so the
   * description parser never sees it. Declaring it here puts it in the item's
   * stat block, where every consumer already looks.
   */
  stats?: Partial<StatBlock>;
  /**
   * A multiplier on one instance of damage, as a fraction (0.08 === +8%).
   *
   * It is told what kind of damage this is, because that is what the game's own
   * amplifiers key off: Spear of Shojin raises ability and passive damage and
   * leaves basic attacks alone, and an amplifier that cannot tell them apart
   * would raise the wrong half of a combo.
   */
  amplify?(ctx: SimContext, hit: AmplifiableHit): number;
  createRuntime?(): ItemRuntime;
}

/* ------------------------------------------------------------------ spellblade */

/**
 * Sheen and its upgrades: after casting an ability, the next basic attack
 * within 10s deals bonus physical damage. 1.5s internal cooldown.
 */
function spellblade(id: string, name: string, baseAdMultiplier: number, note: string): ItemEffect {
  return {
    id,
    name,
    modelled: true,
    note,
    createRuntime() {
      let armedUntil = -Infinity;
      let readyAt = 0;
      return {
        onAbilityCast(ctx) {
          if (ctx.time < readyAt) return;
          armedUntil = ctx.time + 10;
        },
        onBasicAttack(ctx) {
          if (ctx.time > armedUntil) return null;
          armedUntil = -Infinity;
          readyAt = ctx.time + 1.5;
          return {
            amount: baseAdMultiplier * ctx.stats.baseAttackDamage,
            type: 'physical',
            label: `${name} · Spellblade`,
            notes: [`${Math.round(baseAdMultiplier * 100)}% base AD`],
          };
        },
      };
    },
  };
}

/* ----------------------------------------------------------------- definitions */

const BLACK_CLEAVER: ItemEffect = {
  id: '3071',
  name: 'Black Cleaver',
  modelled: true,
  note: 'Physical damage applies a stack: −6% armor per stack, up to 5 stacks (−30%) for 6s.',
  createRuntime() {
    let stacks = 0;
    let expiresAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (hit.type !== 'physical' || hit.mitigated <= 0) return;
        if (ctx.time > expiresAt) stacks = 0;
        if (stacks >= 5) {
          expiresAt = ctx.time + 6;
          return;
        }
        stacks += 1;
        expiresAt = ctx.time + 6;
        ctx.applyArmorShred({
          percent: 0.06 * stacks,
          durationSeconds: 6,
          label: `Black Cleaver · ${stacks}/5`,
        });
      },
    };
  },
};

const BLADE_OF_THE_RUINED_KING: ItemEffect = {
  id: '3153',
  name: 'Blade of the Ruined King',
  modelled: true,
  note: "On-hit: 8% of the target's current health as physical damage (melee value).",
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        const amount = ctx.targetCurrentHealth * 0.08;
        return {
          amount,
          type: 'physical',
          label: 'Blade of the Ruined King · on-hit',
          notes: ['8% of current health'],
        };
      },
    };
  },
};

const TITANIC_HYDRA: ItemEffect = {
  id: '3748',
  name: 'Titanic Hydra',
  modelled: true,
  note: "On-hit: 3 + 1.5% of Vi's maximum health as physical damage. The cleave damage is irrelevant in a single-target model.",
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        const amount = 3 + 0.015 * ctx.stats.maxHealth;
        return {
          amount,
          type: 'physical',
          label: 'Titanic Hydra · on-hit',
          notes: [`3 + 1.5% of ${ctx.stats.maxHealth.toFixed(0)} health`],
        };
      },
    };
  },
};

const NASHORS_TOOTH: ItemEffect = {
  id: '3115',
  name: "Nashor's Tooth",
  modelled: true,
  note: 'On-hit: 15 + 20% ability power as magic damage.',
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        return {
          amount: 15 + 0.2 * ctx.stats.abilityPower,
          type: 'magic',
          label: "Nashor's Tooth · on-hit",
        };
      },
    };
  },
};

const WITS_END: ItemEffect = {
  id: '3091',
  name: "Wit's End",
  modelled: true,
  note: 'On-hit: 15–80 magic damage, scaling with level.',
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        const t = (Math.min(18, Math.max(1, ctx.stats.level)) - 1) / 17;
        return {
          amount: 15 + (80 - 15) * t,
          type: 'magic',
          label: "Wit's End · on-hit",
        };
      },
    };
  },
};

const LORD_DOMINIKS: ItemEffect = {
  id: '3036',
  name: "Lord Dominik's Regards",
  modelled: true,
  note: 'Giant Slayer: up to +15% physical damage against targets with more maximum health than Vi.',
  amplify(ctx, hit) {
    if (hit.type !== 'physical') return 0;
    const excess = ctx.targetMaxHealth - ctx.stats.maxHealth;
    if (excess <= 0) return 0;
    // Ramps to the cap at +2000 max health difference.
    return Math.min(0.15, (excess / 2000) * 0.15);
  },
};

const ECLIPSE: ItemEffect = {
  id: '6692',
  name: 'Eclipse',
  modelled: true,
  note: 'Every 2nd separate attack or ability hit on the same champion deals 4% of maximum health as physical damage. 6s cooldown.',
  createRuntime() {
    let hits = 0;
    let readyAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (hit.mitigated <= 0 || ctx.time < readyAt) return;
        hits += 1;
        if (hits % 2 !== 0) return;
        ctx.dealDamage({
          sourceId: 'item:6692',
          sourceLabel: 'Eclipse',
          sourceKind: 'item',
          type: 'physical',
          amount: ctx.targetMaxHealth * 0.04,
          notes: ["4% of the target's maximum health"],
        });
        readyAt = ctx.time + 6;
      },
    };
  },
};

const SUNDERED_SKY: ItemEffect = {
  id: '6610',
  name: 'Sundered Sky',
  modelled: true,
  note: 'Lightshield Strike: the first attack against a champion is guaranteed to critically strike. The healing portion feeds into the total healing.',
  createRuntime() {
    let used = false;
    let readyAt = 0;
    return {
      onBasicAttack(ctx) {
        if (used || ctx.time < readyAt) return null;
        used = true;
        readyAt = ctx.time + 8;
        // Modelled as the crit portion of one attack: the difference between a
        // normal and a critical strike.
        const bonus = ctx.stats.totalAttackDamage * (ctx.stats.critMultiplier - 1);
        return {
          amount: bonus,
          type: 'physical',
          label: 'Sundered Sky · guaranteed critical strike',
          notes: [
            `+${((ctx.stats.critMultiplier - 1) * 100).toFixed(0)}% bonus critical strike damage`,
          ],
        };
      },
    };
  },
};

const VOLTAIC_CYCLOSWORD: ItemEffect = {
  id: '6699',
  name: 'Voltaic Cyclosword',
  modelled: true,
  note: 'Firmament: the energized attack deals 100 bonus physical damage. Counted as once per combo.',
  createRuntime() {
    let used = false;
    return {
      onBasicAttack() {
        if (used) return null;
        used = true;
        return {
          amount: 100,
          type: 'physical',
          label: 'Voltaic Cyclosword · Firmament',
        };
      },
    };
  },
};

const MURAMANA: ItemEffect = {
  id: '3042',
  name: 'Muramana',
  modelled: true,
  note: 'Shock: abilities deal an additional 3.5% of maximum mana as physical damage.',
  createRuntime() {
    return {
      onHitLanded(ctx, hit) {
        if (!hit.isAbilityDamage || hit.mitigated <= 0) return;
        ctx.dealDamage({
          sourceId: 'item:3042',
          sourceLabel: 'Muramana · Shock',
          sourceKind: 'item',
          type: 'physical',
          amount: ctx.stats.maxMana * 0.035,
          notes: [`3.5% of ${ctx.stats.maxMana.toFixed(0)} mana`],
        });
      },
    };
  },
};

/**
 * Spear of Shojin.
 *
 * Two passives, and only one of them is a number this simulation can hold. The
 * haste is exact and belongs in the stat block; the stacking amplifier needs to
 * know whether a hit came from an ability, which the amplify hook is not told,
 * so it is named as missing rather than approximated.
 */
const SPEAR_OF_SHOJIN: ItemEffect = {
  id: '3161',
  name: 'Spear of Shojin',
  modelled: true,
  note: 'Dragonforce: 25 basic ability haste, counted for Q/W/E and not for R. Focused Will: +3% ability and passive damage per stack, up to four.',
  stats: { basicAbilityHaste: 25 },
  /*
   * "Focused Will: Dealing damage with Abilities increases your Champion's
   * Ability and Passive damage by 3% for 6 seconds. (stacks 4 times)"
   *
   * The stack is earned by the hit and spent on the ones after it: the engine
   * computes amplification before it reports the hit, so a stack never inflates
   * the hit that granted it.
   */
  createRuntime() {
    let stacks = 0;
    let expiresAt = -Infinity;
    const live = (ctx: SimContext): number => (ctx.time <= expiresAt ? stacks : 0);
    return {
      onHitLanded(ctx, hit) {
        if (!hit.isAbilityDamage) return;
        stacks = Math.min(4, live(ctx) + 1);
        expiresAt = ctx.time + 6;
        ctx.addEvent({
          kind: 'buff',
          label: 'Focused Will',
          detail: `${stacks}/4 · +${(stacks * 3).toFixed(0)}% ability damage for 6 s`,
        });
      },
      amplify(ctx, hit) {
        if (!hit.isAbilityDamage) return 0;
        return 0.03 * live(ctx);
      },
    };
  },
};

const ALL: ItemEffect[] = [
  SPEAR_OF_SHOJIN,
  // The Arena variant is the same passive with a smaller stat line.
  { ...SPEAR_OF_SHOJIN, id: '223161' },
  spellblade('3057', 'Sheen', 1.0, 'Spellblade: 100% base AD on the next basic attack.'),
  spellblade('3078', 'Trinity Force', 2.0, 'Spellblade: 200% base AD on the next basic attack.'),
  spellblade('3508', 'Essence Reaver', 1.0, 'Spellblade: 100% base AD on the next basic attack.'),
  spellblade('6632', 'Divine Sunderer', 1.25, 'Spellblade, counted here as 125% base AD.'),
  BLACK_CLEAVER,
  BLADE_OF_THE_RUINED_KING,
  TITANIC_HYDRA,
  NASHORS_TOOTH,
  WITS_END,
  LORD_DOMINIKS,
  ECLIPSE,
  SUNDERED_SKY,
  VOLTAIC_CYCLOSWORD,
  MURAMANA,
  /*
   * The families, each in its own file under items/.
   *
   * They live apart because a hundred passives in one file is a file nobody
   * reads, and because each family shares a shape: the burns all schedule ticks,
   * the energised items all count charges, the penetration items all argue with
   * the resistance pipeline. Grouping them puts the shared reasoning next to the
   * items that depend on it.
   */
  ...PENETRATION_ITEMS,
  ...CRIT_ITEMS,
  ...ONHIT_ITEMS,
  ...BURN_ITEMS,
  ...ABILITY_ITEMS,
  ...BRUISER_ITEMS,
];

const BY_ID = new Map<string, ItemEffect>(ALL.map((effect) => [effect.id, effect]));

/**
 * Every id the registry knows, in registration order.
 *
 * Exported so a test can check the list against itself: two families modelling
 * the same item would otherwise collapse into the Map with the later one winning
 * silently, and a silent winner is the kind of thing that is only discovered when
 * a number is already wrong.
 */
export const REGISTERED_ITEM_IDS: string[] = ALL.map((effect) => effect.id);

export function getItemEffect(id: string): ItemEffect | undefined {
  return BY_ID.get(id);
}

export function hasModelledEffect(id: string): boolean {
  return BY_ID.has(id);
}

export function itemRuntimes(ids: string[]): { id: string; runtime: ItemRuntime }[] {
  return ids
    .map((id) => ({ id, effect: BY_ID.get(id) }))
    .filter((entry): entry is { id: string; effect: ItemEffect } =>
      Boolean(entry.effect?.createRuntime),
    )
    .map((entry) => ({ id: entry.id, runtime: entry.effect.createRuntime!() }));
}

export function itemAmplifiers(ids: string[]): ItemEffect[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((effect): effect is ItemEffect => Boolean(effect?.amplify));
}

/** Item ids whose passive this calculator does not model. */
export function unmodelledItemIds(ids: string[]): string[] {
  return ids.filter((id) => !BY_ID.has(id));
}
