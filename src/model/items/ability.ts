/**
 * Ability-power items and ability-proc items.
 *
 * Same contract as `../itemEffects`: an entry here is a passive that reaches a
 * damage number through the `SimContext` hooks, keyed by Data Dragon item id.
 * Items whose passive cannot reach one are deliberately absent rather than
 * approximated — an item with no entry still contributes its whole stat line,
 * and the analysis names it as unmodelled, which is a truthful answer. A
 * plausible-looking invented number would not be.
 *
 * Sourcing rules followed for every constant below:
 *  - Data Dragon `item.json` for patch 16.16.1 is the first source, but it ships
 *    these passives with the numbers stripped out ("deals bonus magic damage"),
 *    so it settles only the prose and the stat lines.
 *  - The numbers therefore come from Riot's own item bin — CommunityDragon's
 *    `game/items.cdtb.bin.json` — where every one of them is a named
 *    `ItemDataValue` or `GameCalculation` on the item itself. Each constant
 *    below names the bin key it was read from.
 *  - The wiki is quoted only where it is cited as such, and only for prose that
 *    tells us what Riot's own numbers mean.
 *
 * Vi is melee. Where an effect has separate melee and ranged values the melee
 * value is used and the comment says so.
 */

import type { AmplifiableHit, ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';

/* --------------------------------------------------------------- Lich Bane */

/*
 * Riot bin, `Items/3100`:
 *   mDataValues  SpellbladeADRatio = 0.75, LichBaneAPValue = 0.45,
 *                SpellBladeDuration = 10, SpellbladeCooldown = 1.5
 *   mItemCalculations.SpellbladeDamage
 *     = base attack damage (mStat 2 / mStatFormula 1) × SpellbladeADRatio
 *     + ability power × LichBaneAPValue
 *
 * `mStat 2 / mStatFormula 1` is confirmed as *base* attack damage by Sheen
 * (`Items/3057`), whose identical formula part with coefficient 1 is the 100%
 * base AD the calculator already models for it.
 *
 * The wiki's prose for the same passive, quoted verbatim and marked as
 * wiki-sourced, is what tells us the window and the cooldown apply the way they
 * are implemented below: "After using an ability, your next basic attack within
 * 10 seconds gains 50% bonus attack speed and deals 75% base AD (+ 45% AP)
 * bonus magic damage on-hit (1.5 second cooldown, starts after using the
 * empowered attack)."
 */
const LICH_BANE_BASE_AD_RATIO = 0.75;
const LICH_BANE_AP_RATIO = 0.45;
const LICH_BANE_WINDOW_SECONDS = 10;
const LICH_BANE_COOLDOWN_SECONDS = 1.5;

function lichBaneRuntime(): ItemRuntime {
  let armedUntil = -Infinity;
  let readyAt = 0;
  return {
    onAbilityCast(ctx) {
      // The cooldown gates arming, not swinging: an ability cast during it
      // leaves the spellblade unarmed rather than queueing a second charge.
      if (ctx.time < readyAt) return;
      armedUntil = ctx.time + LICH_BANE_WINDOW_SECONDS;
    },
    onBasicAttack(ctx): ItemAttackRider | null {
      if (ctx.time > armedUntil) return null;
      armedUntil = -Infinity;
      // The wiki text above is explicit that the cooldown starts when the
      // empowered attack is spent, not when the ability was cast.
      readyAt = ctx.time + LICH_BANE_COOLDOWN_SECONDS;
      const fromBaseAd = LICH_BANE_BASE_AD_RATIO * ctx.stats.baseAttackDamage;
      const fromAp = LICH_BANE_AP_RATIO * ctx.stats.abilityPower;
      return {
        amount: fromBaseAd + fromAp,
        type: 'magic',
        label: 'Lich Bane · Spellblade',
        notes: [
          `${(LICH_BANE_BASE_AD_RATIO * 100).toFixed(0)}% of ${ctx.stats.baseAttackDamage.toFixed(0)} base AD` +
            ` + ${(LICH_BANE_AP_RATIO * 100).toFixed(0)}% of ${ctx.stats.abilityPower.toFixed(0)} AP`,
        ],
      };
    },
  };
}

const LICH_BANE: ItemEffect = {
  id: '3100',
  name: 'Lich Bane',
  modelled: true,
  note:
    'Spellblade: after an ability, the next basic attack within 10 s deals 75% base AD (+45% AP) bonus magic damage. ' +
    '1.5 s cooldown, starting when the empowered attack is spent. ' +
    'The 50% bonus attack speed on that one attack is not modelled: an item runtime is first asked for its rider ' +
    'after the wind-up has already been paid, so there is no hook that could put the buff in place in time for the ' +
    'attack it belongs to.',
  createRuntime: lichBaneRuntime,
};

/* -------------------------------------------------------------- Shadowflame */

/*
 * Riot bin, `Items/4645`:
 *   mDataValues  HealthThreshold = 0.4, SpellItemDamageAmp = 0.2,
 *                DamageOverTimeAmp = 0.2
 *
 * Data Dragon's resolved text for 16.16.1 agrees and is unambiguous about which
 * damage types it covers: "Magic and true damage Critically Strike enemies
 * below 40% Health, dealing 20% increased damage."
 *
 * Cinderbloom's "critical strike" is a fixed 120% and does not read Vi's crit
 * damage, so it is a plain amplifier rather than anything routed through
 * `critMultiplier`. The engine already stacks amplifiers multiplicatively, which
 * is how the wiki says this one combines with other critical-damage modifiers.
 *
 * `DamageOverTimeAmp` is the same 20% for damage over time, so one amplifier
 * covers both cases and no separate branch is needed.
 */
const SHADOWFLAME_HEALTH_THRESHOLD = 0.4;
const SHADOWFLAME_DAMAGE_AMP = 0.2;

function cinderbloomAmp(ctx: SimContext, hit: AmplifiableHit): number {
  if (hit.type !== 'magic' && hit.type !== 'true') return 0;
  // "below 40% Health" is strict, so a target sitting exactly on the threshold
  // does not qualify.
  if (ctx.targetCurrentHealth >= ctx.targetMaxHealth * SHADOWFLAME_HEALTH_THRESHOLD) return 0;
  return SHADOWFLAME_DAMAGE_AMP;
}

const SHADOWFLAME: ItemEffect = {
  id: '4645',
  name: 'Shadowflame',
  modelled: true,
  note:
    'Cinderbloom: magic and true damage deals 20% more against a target below 40% of its maximum health. ' +
    'The 15 magic penetration is a stat line Data Dragon already ships.',
  amplify: cinderbloomAmp,
};

/* -------------------------------------------------------------- Luden's Echo */

/*
 * Riot bin, `Items/6655`:
 *   mDataValues  BaseDamage = 75, APRatio = 0.05, MaxCharges = 6,
 *                RepeatDamageReduction = 0.2, Cooldown = 12
 *   mItemCalculations.Damage          = BaseDamage + ability power × APRatio
 *   mItemCalculations.SingleTargetMax = Damage × 2
 *
 * `SingleTargetMax` is Riot's own arithmetic for exactly the case this
 * calculator simulates, and it is worth spelling out because it is the whole
 * reason no echo-counting is needed here: Data Dragon says the echoes that have
 * no second target "fire on the primary target, dealing 20% damage", so one
 * full echo plus five at 20% is 1 + 5 × 0.2 = 2 echoes' worth. Riot ships that
 * product as a named calculation, so the multiplier below is data, not algebra
 * invented here.
 *
 * Data Dragon 16.16.1 still calls item 6655 "Luden's Echo"; the name used here
 * is Riot's current one rather than any of the item's earlier names.
 */
const LUDENS_ECHO_BASE_DAMAGE = 75;
const LUDENS_ECHO_AP_RATIO = 0.05;
const LUDENS_SINGLE_TARGET_ECHOES = 2;
const LUDENS_COOLDOWN_SECONDS = 12;

function ludensRuntime(): ItemRuntime {
  let readyAt = 0;
  return {
    onHitLanded(ctx, hit) {
      // "Damaging Abilities": the engine's own flag for that is
      // `isAbilityDamage`, which is what Muramana's Shock already keys off, so
      // both items agree on what counts as an ability.
      if (!hit.isAbilityDamage || hit.mitigated <= 0) return;
      if (ctx.time < readyAt) return;
      readyAt = ctx.time + LUDENS_COOLDOWN_SECONDS;
      const perEcho = LUDENS_ECHO_BASE_DAMAGE + LUDENS_ECHO_AP_RATIO * ctx.stats.abilityPower;
      ctx.dealDamage({
        sourceId: 'item:6655',
        sourceLabel: "Luden's Echo · Echo",
        sourceKind: 'item',
        type: 'magic',
        amount: perEcho * LUDENS_SINGLE_TARGET_ECHOES,
        notes: [
          `${LUDENS_SINGLE_TARGET_ECHOES} × (${LUDENS_ECHO_BASE_DAMAGE} + ` +
            `${(LUDENS_ECHO_AP_RATIO * 100).toFixed(0)}% of ${ctx.stats.abilityPower.toFixed(0)} AP)`,
          'six echoes, one at full damage and five at 20% into the same target',
        ],
      });
    },
  };
}

const LUDENS_ECHO: ItemEffect = {
  id: '6655',
  name: "Luden's Echo",
  modelled: true,
  note:
    "Echo: a damaging ability fires six echoes of 75 (+5% AP) magic damage each. Against a single target that is " +
    'one full echo plus five at 20%, which is Riot\'s own "SingleTargetMax" of twice one echo. 12 s cooldown.',
  createRuntime: ludensRuntime,
};

/* --------------------------------------------------------------- Malignance */

/*
 * Riot bin, `Items/3118`:
 *   mDataValues  BaseDamage = 60, APRatio = 0.05, GroundDuration = 3,
 *                UltimateHaste = 20
 *   mItemCalculations.GroundBurnDamagePerTickTooltipOnly
 *     = BaseDamage + ability power × APRatio          (this is per second)
 *   mItemCalculations.{8e8f7a34}
 *     = 0.25 × (BaseDamage + ability power × APRatio) (this is per 0.25 s tick)
 *   mItemCalculations.MagicResistanceShred = 10
 *
 * The two calculations pin the tick rate without any guesswork: the burn deals
 * 60 (+5% AP) per second and resolves in quarter-second ticks, so 3 s comes to
 * twelve ticks of 15 (+1.25% AP). The true tick rate is modelled rather than one
 * lump per second because the ticks are what decide whether the burn finishes
 * before the target dies, and the calculator stops counting damage at the kill.
 *
 * Two parts of this item are named here and left out rather than approximated:
 *  - The −10 magic resist. `SimContext` exposes `applyArmorShred` and nothing
 *    equivalent for magic resist, and the mitigation step reads the target's
 *    magic resist with `flatReduction: 0` hard-wired, so there is no honest way
 *    to apply it.
 *  - Scorn's 20 ultimate ability haste. `StatBlock` has `abilityHaste` and
 *    `basicAbilityHaste` (everything that is not the ultimate) but no
 *    ultimate-only channel. It could be faked as +20 haste and −20 basic haste,
 *    which would even produce the right cooldowns, but it would put a negative
 *    stat in front of the reader in the stat sheet, so it is reported as missing
 *    instead.
 *
 * Wiki-sourced, for a rule Riot's bin does not ship as a data value on this
 * item: the wiki gives Hatefog "a 3-second cooldown per target starting on zone
 * creation". Nothing is implemented for it — Vi's ultimate is on a 90 s
 * cooldown, so a 3 s gate cannot be reached twice inside one combo — and it is
 * recorded here so the omission is a decision rather than an oversight.
 */
const MALIGNANCE_BURN_SECONDS = 3;
const MALIGNANCE_TICK_SECONDS = 0.25;
const MALIGNANCE_DAMAGE_PER_SECOND = 60;
const MALIGNANCE_AP_RATIO_PER_SECOND = 0.05;
const MALIGNANCE_TICKS = Math.round(MALIGNANCE_BURN_SECONDS / MALIGNANCE_TICK_SECONDS);

function malignanceRuntime(): ItemRuntime {
  return {
    onHitLanded(ctx, hit) {
      /*
       * "Damaging a champion with your Ultimate."
       *
       * `HitInfo` carries no ability slot, so the ultimate has to be recognised
       * by its `sourceId`. Every champion module in this project uses the slot
       * letter as the source id of an ability's damage — Vi's Cease and Desist
       * deals its damage as `sourceId: 'R', slot: 'R'` — so that is the
       * identifier available here, and `isAbilityDamage` is required alongside
       * it so nothing else that happens to be called R could trigger the burn.
       */
      if (hit.sourceId !== 'R' || !hit.isAbilityDamage || hit.mitigated <= 0) return;
      if (ctx.target.unitType !== 'champion') return;

      const perSecond =
        MALIGNANCE_DAMAGE_PER_SECOND + MALIGNANCE_AP_RATIO_PER_SECOND * ctx.stats.abilityPower;
      const perTick = perSecond * MALIGNANCE_TICK_SECONDS;

      ctx.addEvent({
        kind: 'info',
        label: 'Malignance · Hatefog',
        detail:
          `${(perSecond * MALIGNANCE_BURN_SECONDS).toFixed(0)} magic damage over ` +
          `${MALIGNANCE_BURN_SECONDS} s · magic resist reduction not modelled`,
      });

      for (let tick = 1; tick <= MALIGNANCE_TICKS; tick += 1) {
        ctx.scheduleDamage({
          afterSeconds: tick * MALIGNANCE_TICK_SECONDS,
          sourceId: 'item:3118',
          sourceLabel: `Malignance · Hatefog (tick ${tick}/${MALIGNANCE_TICKS})`,
          sourceKind: 'item',
          type: 'magic',
          amount: perTick,
        });
      }
    },
  };
}

const MALIGNANCE: ItemEffect = {
  id: '3118',
  name: 'Malignance',
  modelled: true,
  note:
    'Hatefog: ultimate damage to a champion burns the ground for 3 s, dealing 60 (+5% AP) magic damage per second ' +
    'in twelve quarter-second ticks. The −10 magic resist is not modelled (the context can shred armor only), and ' +
    "Scorn's 20 ultimate ability haste is not modelled (the stat block has no ultimate-only haste).",
  createRuntime: malignanceRuntime,
};

/* --------------------------------------------------------------- Stormsurge */

/*
 * Riot bin, `Items/4646`:
 *   mDataValues  BaseDamage = 125, APRatio = 0.1, DamageThreshold = 0.25,
 *                WindowDuration = 2.5, DelayDuration = 2, Cooldown = 30,
 *                RangedProcDamageMod = 1
 *   mItemCalculations.MeleeItemCalcValue  = BaseDamage + ability power × APRatio
 *   mItemCalculations.RangedItemCalcValue = MeleeItemCalcValue × RangedProcDamageMod
 *   mItemCalculations.SquallDamage        = BaseDamage + ability power × APRatio
 *
 * The melee value is the one used, as it is for every melee/ranged split in this
 * project — though here the two are equal, because Riot's own ranged modifier is
 * 1 in this patch.
 */
const STORMSURGE_BASE_DAMAGE = 125;
const STORMSURGE_AP_RATIO = 0.1;
const STORMSURGE_HEALTH_THRESHOLD = 0.25;
const STORMSURGE_WINDOW_SECONDS = 2.5;
const STORMSURGE_DELAY_SECONDS = 2;
const STORMSURGE_COOLDOWN_SECONDS = 30;

function stormsurgeRuntime(): ItemRuntime {
  let windowStartedAt = -Infinity;
  let accumulated = 0;
  let readyAt = 0;
  return {
    onHitLanded(ctx, hit) {
      if (hit.mitigated <= 0) return;
      // Squall is a champion-only debuff, so nothing accrues against anything
      // else and the counter is left alone rather than filled up in vain.
      if (ctx.target.unitType !== 'champion') return;
      if (ctx.time < readyAt) return;

      /*
       * The rolling 2.5 s window is modelled as a bucket that empties once it
       * is older than the window, which is the same simplification Electrocute
       * already uses in `runes.ts` for its 3 s window. It can undercount at the
       * seam — damage falling just before a reset is forgotten rather than
       * sliding out one hit at a time — and it never overcounts, so a reported
       * proc is always one the player would really get.
       *
       * The accumulator sees only what the engine reports as a landed hit, and
       * the engine deliberately does not report item and rune procs as hits.
       * Damage from other items therefore does not count towards the threshold
       * here, where in game it would.
       */
      if (ctx.time - windowStartedAt > STORMSURGE_WINDOW_SECONDS) {
        windowStartedAt = ctx.time;
        accumulated = 0;
      }
      accumulated += hit.mitigated;

      const threshold = ctx.targetMaxHealth * STORMSURGE_HEALTH_THRESHOLD;
      if (accumulated < threshold) return;

      readyAt = ctx.time + STORMSURGE_COOLDOWN_SECONDS;
      accumulated = 0;
      windowStartedAt = -Infinity;

      // Riot's calculation reads ability power when the strike resolves; this
      // reads it when Squall is applied, two seconds earlier. The two differ
      // only if ability power changes inside those two seconds, which no item
      // or rune this calculator models does.
      const amount = STORMSURGE_BASE_DAMAGE + STORMSURGE_AP_RATIO * ctx.stats.abilityPower;

      ctx.addEvent({
        kind: 'info',
        label: 'Stormsurge · Squall',
        detail:
          `${(STORMSURGE_HEALTH_THRESHOLD * 100).toFixed(0)}% of maximum health dealt · ` +
          `strikes for ${amount.toFixed(0)} in ${STORMSURGE_DELAY_SECONDS} s`,
      });

      ctx.scheduleDamage({
        afterSeconds: STORMSURGE_DELAY_SECONDS,
        sourceId: 'item:4646',
        sourceLabel: 'Stormsurge · Squall',
        sourceKind: 'item',
        type: 'magic',
        amount,
        notes: [
          `${STORMSURGE_BASE_DAMAGE} + ${(STORMSURGE_AP_RATIO * 100).toFixed(0)}% of ` +
            `${ctx.stats.abilityPower.toFixed(0)} AP`,
        ],
      });
    },
  };
}

const STORMSURGE: ItemEffect = {
  id: '4646',
  name: 'Stormsurge',
  modelled: true,
  note:
    'Stormraider: dealing 25% of a champion\'s maximum health within 2.5 s applies Squall, which strikes 2 s later ' +
    'for 125 (+10% AP) magic damage. 30 s cooldown. The threshold counts only damage the engine reports as a landed ' +
    'hit, which excludes other items\' procs.',
  createRuntime: stormsurgeRuntime,
};

/* ---------------------------------------------------------------- the family */

/**
 * The sourced numbers, exposed for the tests.
 *
 * A test that types a damage figure a second time only proves that two copies
 * of a number agree with each other. Reading the constants back means the test
 * asserts the *shape* of each formula — 75% base AD plus 45% AP, twice one echo,
 * twelve ticks of a quarter second — against the one place the numbers live.
 */
export const ABILITY_ITEM_NUMBERS = {
  lichBane: {
    baseAdRatio: LICH_BANE_BASE_AD_RATIO,
    apRatio: LICH_BANE_AP_RATIO,
    windowSeconds: LICH_BANE_WINDOW_SECONDS,
    cooldownSeconds: LICH_BANE_COOLDOWN_SECONDS,
  },
  shadowflame: {
    healthThreshold: SHADOWFLAME_HEALTH_THRESHOLD,
    damageAmp: SHADOWFLAME_DAMAGE_AMP,
  },
  ludens: {
    baseDamage: LUDENS_ECHO_BASE_DAMAGE,
    apRatio: LUDENS_ECHO_AP_RATIO,
    singleTargetEchoes: LUDENS_SINGLE_TARGET_ECHOES,
    cooldownSeconds: LUDENS_COOLDOWN_SECONDS,
  },
  malignance: {
    damagePerSecond: MALIGNANCE_DAMAGE_PER_SECOND,
    apRatioPerSecond: MALIGNANCE_AP_RATIO_PER_SECOND,
    burnSeconds: MALIGNANCE_BURN_SECONDS,
    tickSeconds: MALIGNANCE_TICK_SECONDS,
    ticks: MALIGNANCE_TICKS,
  },
  stormsurge: {
    baseDamage: STORMSURGE_BASE_DAMAGE,
    apRatio: STORMSURGE_AP_RATIO,
    healthThreshold: STORMSURGE_HEALTH_THRESHOLD,
    windowSeconds: STORMSURGE_WINDOW_SECONDS,
    delaySeconds: STORMSURGE_DELAY_SECONDS,
    cooldownSeconds: STORMSURGE_COOLDOWN_SECONDS,
  },
} as const;

export const ABILITY_ITEMS: ItemEffect[] = [
  LICH_BANE,
  SHADOWFLAME,
  LUDENS_ECHO,
  MALIGNANCE,
  STORMSURGE,
];
