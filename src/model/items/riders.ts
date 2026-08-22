/**
 * Conditional damage riders: items that add damage to one particular press.
 *
 * These are the items whose passive is neither a burn, an on-hit, nor an
 * amplifier, but a *condition*: after being unseen, on the first ability, on the
 * attack that discharges your movement, after your ultimate. Each one is armed by
 * something and spends itself on a single hit, which makes the arming rule the
 * interesting half of the model — the damage number is usually the easy part.
 *
 * Data Dragon ships these with the numbers stripped out ("deals an additional
 * true damage", with nothing where the value should be), so every figure below
 * comes from the item's own bin under `Items/<id>` in CommunityDragon's
 * `items.cdtb.bin.json`, read for patch 16.16.1, and each is named where it is
 * used. `mStat 29` is lethality: Umbral's tooltip in game reads 50 + 150 %
 * lethality, and its formula is `50 + 1.5 × mStat 29`, which pins the mapping.
 */

import type { SimContext } from '../../engine/context';
import type { AmplifiableHit, ItemEffect, ItemRuntime } from '../itemEffects';

export const RIDER_CONSTANTS = {
  /** Umbral Glaive — Nightstalker. Items/3179. */
  umbral: {
    id: '3179',
    /** ProcDamage = 50 + 1.5 × lethality. */
    flat: 50,
    lethalityRatio: 1.5,
    cooldownSeconds: 90,
    /** How long you must be unseen for it to arm (OutOfVisionDuration). */
    unseenSeconds: 1,
    /** The armed attack has this long to land (AttackReadyDuration). */
    armedSeconds: 4,
  },
  /** Bastionbreaker — Shaped Charge. Items/2520. */
  bastionbreaker: {
    id: '2520',
    /** AbilityDamageCalc = 50 + 1.5 × lethality. */
    flat: 50,
    lethalityRatio: 1.5,
    cooldownSeconds: 20,
    /** Ranged champions get half; Vi is melee, so this is unused for her. */
    rangedMultiplier: 0.5,
  },
  /** Dead Man's Plate — Shipwrecker. Items/3742. */
  deadMansPlate: {
    id: '3742',
    /** MaxDamageCalc = base AD × MaxStacksADRatio + BonusDamagePerStack × 100. */
    baseAdRatio: 1,
    flatAtFullStacks: 40,
    maxStacks: 100,
    secondsToFullStacks: 4,
  },
  /** Fiendhunter Bolts — Opening Barrage. Items/2512. */
  fiendhunter: {
    id: '2512',
    attacks: 3,
    durationSeconds: 8,
    cooldownSeconds: 45,
    bonusAttackSpeed: 0.5,
    /** A guaranteed crit, but at 80 % of your normal crit damage. */
    critModifier: 0.8,
    /** If the attack would have crit anyway, it adds this much true damage. */
    bonusTrueDamage: 0.15,
  },
  /** Hexoptics C44 — Magnification. Items/2523. */
  hexoptics: {
    id: '2523',
    maxAmp: 0.1,
    maxRange: 500,
  },
  /** Bloodletter's Curse — Vile Decay. Items/8010. */
  bloodletter: {
    id: '8010',
    shredPerStack: 0.075,
    maxStacks: 4,
    durationSeconds: 6,
    internalCooldownSeconds: 0.3,
  },
} as const;

/** 50 + 150 % lethality, the shape both lethality riders use. */
function lethalityRider(ctx: SimContext, flat: number, ratio: number): number {
  return flat + ratio * ctx.stats.lethality;
}

/**
 * Umbral Glaive — Nightstalker.
 *
 * Armed at the start of the combo, and that is an assumption worth stating: the
 * simulation has no vision model, and one second out of sight is the whole
 * requirement. A combo that starts from the fog — which is what a Vi engage is —
 * has it up; one that starts mid-trade does not. It fires once per 90 s, so at
 * most once in any combo this app simulates.
 */
const UMBRAL_GLAIVE: ItemEffect = {
  id: RIDER_CONSTANTS.umbral.id,
  name: 'Umbral Glaive',
  modelled: true,
  note: 'Nightstalker: the first attack deals 50 (+150% lethality) bonus true damage. Assumed armed at the start of the combo, since there is no vision model.',
  createRuntime(): ItemRuntime {
    let spent = false;
    return {
      onBasicAttack(ctx) {
        if (spent) return null;
        // Champions only: Riot's text says "against a champion".
        if (ctx.target.unitType !== 'champion') return null;
        spent = true;
        const { flat, lethalityRatio } = RIDER_CONSTANTS.umbral;
        return {
          amount: lethalityRider(ctx, flat, lethalityRatio),
          type: 'true',
          label: 'Umbral Glaive · Nightstalker',
          notes: [`50 + 150% of ${ctx.stats.lethality.toFixed(0)} lethality`],
        };
      },
    };
  },
};

/**
 * Bastionbreaker — Shaped Charge.
 *
 * Fires on ability damage to a champion, once every 20 s. Sabotage is left out:
 * it needs a takedown and then only pays out against epic monsters and turrets,
 * neither of which this simulation has.
 */
const BASTIONBREAKER: ItemEffect = {
  id: RIDER_CONSTANTS.bastionbreaker.id,
  name: 'Bastionbreaker',
  modelled: true,
  note: 'Shaped Charge: ability damage to a champion adds 50 (+150% lethality) true damage, every 20s. Sabotage needs a takedown and only pays against monsters and turrets, so it is out.',
  createRuntime(): ItemRuntime {
    let readyAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (!hit.isAbilityDamage || hit.mitigated <= 0) return;
        if (ctx.target.unitType !== 'champion') return;
        if (ctx.time < readyAt) return;
        readyAt = ctx.time + RIDER_CONSTANTS.bastionbreaker.cooldownSeconds;

        const { flat, lethalityRatio } = RIDER_CONSTANTS.bastionbreaker;
        ctx.dealDamage({
          sourceId: `item:${RIDER_CONSTANTS.bastionbreaker.id}`,
          sourceLabel: 'Bastionbreaker · Shaped Charge',
          sourceKind: 'item',
          type: 'true',
          amount: lethalityRider(ctx, flat, lethalityRatio),
          notes: [`50 + 150% of ${ctx.stats.lethality.toFixed(0)} lethality`],
        });
      },
    };
  },
};

/**
 * Dead Man's Plate — Shipwrecker.
 *
 * Assumed fully stacked on the first attack: the stacks build in four seconds of
 * walking and a fight is entered by walking into it. After it discharges, the
 * combo is standing still hitting something, so it does not come back — which is
 * the honest reading and the conservative one.
 */
const DEAD_MANS_PLATE: ItemEffect = {
  id: RIDER_CONSTANTS.deadMansPlate.id,
  name: "Dead Man's Plate",
  modelled: true,
  note: "Shipwrecker: the first attack discharges 100 stacks for 40 (+100% base AD) physical damage. Assumed full at the start, since the stacks build in 4s of walking.",
  createRuntime(): ItemRuntime {
    let spent = false;
    return {
      onBasicAttack(ctx) {
        if (spent) return null;
        spent = true;
        const { baseAdRatio, flatAtFullStacks } = RIDER_CONSTANTS.deadMansPlate;
        const amount = flatAtFullStacks + baseAdRatio * ctx.stats.baseAttackDamage;
        return {
          amount,
          type: 'physical',
          label: "Dead Man's Plate · Shipwrecker",
          notes: [`40 + 100% of ${ctx.stats.baseAttackDamage.toFixed(0)} base AD`],
        };
      },
    };
  },
};

/**
 * Hexoptics C44 — Magnification.
 *
 * Up to +10 % attack damage, scaling with how far away the target is, maxed at
 * 500 range. There are no positions in this simulation, so the distance used is
 * the champion's own attack range: a melee attack lands at melee range, which for
 * Vi's 125 is a quarter of the way to the cap. That is a floor rather than a
 * guess — she cannot attack from further than she can reach — and it is stated
 * rather than rounded to nothing.
 */
const HEXOPTICS_C44: ItemEffect = {
  id: RIDER_CONSTANTS.hexoptics.id,
  name: 'Hexoptics C44',
  modelled: true,
  note: 'Magnification: up to +10% attack damage by distance, maxed at 500 range. Scaled by the champion\'s own attack range, because the simulation has no positions.',
  amplify(ctx: SimContext, hit: AmplifiableHit): number {
    // Attacks only: Riot's text says "damage with Attacks".
    if (hit.isAbilityDamage || !hit.triggersOnHit) return 0;
    const { maxAmp, maxRange } = RIDER_CONSTANTS.hexoptics;
    const reach = Math.min(1, ctx.stats.attackRange / maxRange);
    return maxAmp * reach;
  },
};

/**
 * Bloodletter's Curse — Vile Decay.
 *
 * The first item in this project to shred magic resistance, which the engine
 * could not express until `applyMagicResistShred` existed. Shred is the target's
 * loss and is shared by everyone hitting them; penetration is the attacker's
 * alone. Modelling this as penetration would have been right for one attacker and
 * wrong for the duel this engine is heading towards.
 */
const BLOODLETTERS_CURSE: ItemEffect = {
  id: RIDER_CONSTANTS.bloodletter.id,
  name: "Bloodletter's Curse",
  modelled: true,
  note: "Vile Decay: magic damage from abilities and passives shreds 7.5% magic resist per stack, up to 4 stacks for 6s, with a 0.3s internal cooldown.",
  createRuntime(): ItemRuntime {
    let stacks = 0;
    let expiresAt = 0;
    let readyAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (hit.type !== 'magic' || hit.mitigated <= 0) return;
        // Riot's text scopes it to abilities and passives, not basic attacks.
        if (hit.triggersOnHit && !hit.isAbilityDamage) return;
        if (ctx.time < readyAt) return;
        if (ctx.time > expiresAt) stacks = 0;

        const { shredPerStack, maxStacks, durationSeconds, internalCooldownSeconds } =
          RIDER_CONSTANTS.bloodletter;
        stacks = Math.min(maxStacks, stacks + 1);
        expiresAt = ctx.time + durationSeconds;
        readyAt = ctx.time + internalCooldownSeconds;

        ctx.applyMagicResistShred({
          percent: shredPerStack * stacks,
          durationSeconds,
          label: `Bloodletter's Curse · ${stacks}/${maxStacks}`,
        });
      },
    };
  },
};

export const RIDER_ITEMS: ItemEffect[] = [
  UMBRAL_GLAIVE,
  BASTIONBREAKER,
  DEAD_MANS_PLATE,
  HEXOPTICS_C44,
  BLOODLETTERS_CURSE,
];
