/**
 * Items with a button, pressed as a combo step.
 *
 * The combo builder has had an `item` step since long before anything could use
 * it — pressing it warned that actives were not modelled and dropped the step.
 * These are the three the current Rift shop sells whose damage sits entirely on
 * the button, so they were unreachable in the most literal way: the number was in
 * Riot's files and the press did nothing.
 *
 * Every figure comes from the item's bin (`Items/<id>` in CommunityDragon's
 * `items.cdtb.bin.json`, patch 16.16.1). Cast times are the one thing those bins
 * do not carry for item actives, so each is stated as an assumption below rather
 * than implied by a number that looks measured.
 */

import type { ItemActiveResult, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';

export const ACTIVE_CONSTANTS = {
  /** Hextech Rocketbelt — Supersonic. Items/3152. */
  rocketbelt: {
    id: '3152',
    baseDamage: 100,
    apRatio: 0.1,
    cooldownSeconds: 50,
    /**
     * The dash and the missiles, as time on the clock.
     *
     * Riot ships no cast time for item actives, and this one moves the champion,
     * so it cannot be free. A quarter of a second is the same figure the app uses
     * for a dash cast elsewhere (Vi's ultimate) — an assumption, and the honest
     * place for it is here where it is visible rather than folded into the damage.
     */
    castSeconds: 0.25,
  },
  /** Hextech Gunblade — Lightning Bolt. Items/3146. */
  gunblade: {
    id: '3146',
    /** ByCharLevelInterpolation from 175 at level 1 to 253 at level 18. */
    damageAtLevel1: 175,
    damageAtLevel18: 253,
    apRatio: 0.3,
    slowPercent: 0.25,
    slowSeconds: 1.5,
    cooldownSeconds: 60,
    /** A targeted bolt, no movement: the app's own input delay is the whole cost. */
    castSeconds: 0,
  },
  /** Actualizer — Mana Made Real. Items/2522. */
  actualizer: {
    id: '2522',
    durationSeconds: 8,
    cooldownSeconds: 60,
    /**
     * The amplification while mana is Empowered.
     *
     * Riot's resolved text says "you gain increased Ability damage" and ships no
     * number for it: `ManaCalc` in the bin computes the *mana* the empowerment
     * costs, not the damage it adds. So the item is pressed, the window is drawn,
     * and the damage is left at zero rather than guessed — a marked gap is worth
     * more than a plausible invention.
     */
    abilityAmp: null as number | null,
    castSeconds: 0,
  },
} as const;

/** Level 1 → 18 interpolation, the shape Riot's ByCharLevel parts describe. */
function byLevel(atLevel1: number, atLevel18: number, level: number): number {
  const clamped = Math.min(18, Math.max(1, level));
  return atLevel1 + ((atLevel18 - atLevel1) * (clamped - 1)) / 17;
}

/** A cooldown that survives between presses, shared with the item's passive. */
function withCooldown(
  cooldownSeconds: number,
  press: (ctx: SimContext) => ItemActiveResult,
): ItemRuntime['onActive'] {
  let readyAt = 0;
  return (ctx) => {
    if (ctx.time < readyAt) return null;
    readyAt = ctx.time + cooldownSeconds;
    return press(ctx);
  };
}

const HEXTECH_ROCKETBELT: ItemEffect = {
  id: ACTIVE_CONSTANTS.rocketbelt.id,
  name: 'Hextech Rocketbelt',
  modelled: true,
  note: 'Supersonic: a dash that fires missiles for 100 (+10% AP) magic damage, every 50s. The dash is counted as 0.25s of cast time; Riot ships no cast time for item actives.',
  createRuntime(): ItemRuntime {
    const { baseDamage, apRatio, cooldownSeconds, castSeconds, id } = ACTIVE_CONSTANTS.rocketbelt;
    return {
      onActive: withCooldown(cooldownSeconds, (ctx) => {
        const amount = baseDamage + apRatio * ctx.stats.abilityPower;
        ctx.dealDamage({
          sourceId: `item:${id}`,
          sourceLabel: 'Hextech Rocketbelt · Supersonic',
          sourceKind: 'item',
          type: 'magic',
          amount,
          notes: [`100 + 10% of ${ctx.stats.abilityPower.toFixed(0)} AP`],
        });
        return {
          castSeconds,
          label: 'Rocketbelt · Supersonic',
          detail: `${Math.round(amount)} magic damage`,
        };
      }),
    };
  },
};

const HEXTECH_GUNBLADE: ItemEffect = {
  id: ACTIVE_CONSTANTS.gunblade.id,
  name: 'Hextech Gunblade',
  modelled: true,
  note: 'Lightning Bolt: 175–253 by level (+30% AP) magic damage and a 25% slow for 1.5s, every 60s.',
  createRuntime(): ItemRuntime {
    const {
      damageAtLevel1,
      damageAtLevel18,
      apRatio,
      slowPercent,
      slowSeconds,
      cooldownSeconds,
      castSeconds,
      id,
    } = ACTIVE_CONSTANTS.gunblade;
    return {
      onActive: withCooldown(cooldownSeconds, (ctx) => {
        const amount =
          byLevel(damageAtLevel1, damageAtLevel18, ctx.stats.level) + apRatio * ctx.stats.abilityPower;
        ctx.dealDamage({
          sourceId: `item:${id}`,
          sourceLabel: 'Hextech Gunblade · Lightning Bolt',
          sourceKind: 'item',
          type: 'magic',
          amount,
          notes: [
            `${Math.round(byLevel(damageAtLevel1, damageAtLevel18, ctx.stats.level))} at level ${ctx.stats.level} + 30% of ${ctx.stats.abilityPower.toFixed(0)} AP`,
          ],
        });
        ctx.applyCrowdControl({
          label: 'Gunblade · Lightning Bolt',
          durationSeconds: slowSeconds,
          detail: `${(slowPercent * 100).toFixed(0)}% slow`,
        });
        return {
          castSeconds,
          label: 'Gunblade · Lightning Bolt',
          detail: `${Math.round(amount)} magic damage`,
        };
      }),
    };
  },
};

const ACTUALIZER: ItemEffect = {
  id: ACTIVE_CONSTANTS.actualizer.id,
  name: 'Actualizer',
  modelled: true,
  note: 'Mana Made Real: 8s of Empowered mana, every 60s. Riot publishes no number for the ability-damage increase it grants, so the window is drawn and the amplification is left at zero rather than invented.',
  createRuntime(): ItemRuntime {
    const { durationSeconds, cooldownSeconds, castSeconds } = ACTIVE_CONSTANTS.actualizer;
    return {
      onActive: withCooldown(cooldownSeconds, (ctx) => {
        /*
         * The window is recorded even though it multiplies nothing: a combo built
         * around pressing this deserves to show that the eight seconds were spent
         * here, and the day Riot resolves the number the only change is the
         * amplifier.
         */
        ctx.applyTemporaryStats({
          stats: {},
          durationSeconds,
          label: 'Actualizer · Mana Made Real',
        });
        ctx.warn(
          "Actualizer's ability-damage increase is not published by Riot — the window is shown, the amplification is not counted.",
        );
        return {
          castSeconds,
          label: 'Actualizer · Mana Made Real',
          detail: `${durationSeconds}s empowered`,
        };
      }),
    };
  },
};

export const ACTIVE_ITEMS: ItemEffect[] = [HEXTECH_ROCKETBELT, HEXTECH_GUNBLADE, ACTUALIZER];
