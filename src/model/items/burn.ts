/**
 * Burn, bleed and damage-over-time item passives.
 *
 * Provenance. Every number here is Riot's. Where Data Dragon's resolved text
 * for patch 16.16.1 carries the number, that is the source; where it does not,
 * the number comes from the item's own `mDataValues` and `mItemCalculations`
 * in Riot's item bin, read through the CommunityDragon mirror
 * (`items.cdtb.bin.json`, last modified 2026-08-16). Data Dragon needs that
 * fallback twice over: it writes Immolate as "deal magic damage per second"
 * with the number stripped out entirely, and it ships Demonic Embrace's
 * melee/ranged split as the literal placeholder `{{ Item_Melee_Ranged_Split }}`.
 * The wiki appears once only, quoted verbatim and marked as the wiki's, to break
 * a tie where Riot's own file states Hollow Radiance's burn twice and the two
 * statements disagree — see that item.
 *
 * Vi is melee, so every melee/ranged split below takes the melee value and says
 * where the ranged one went.
 *
 * Two properties hold for every burn in this file. It is magic damage, and it
 * is not ability damage: the burn is the item's damage rather than the
 * ability's, so it must not feed effects that key on ability hits — which is
 * why none of these pass `isAbilityDamage`. And it is `sourceKind: 'item'`,
 * which the engine already refuses to let re-trigger on-hit procs; without that
 * rule Immolate's own tick would re-arm Immolate and a three-second aura would
 * last forever.
 */

import type { AmplifiableHit, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';

/**
 * Riot's data values, kept in one block and named after the fields they came
 * from, so that the numbers can be read against the bin without hunting through
 * the code — and so a test can assert against the same constant the
 * implementation reads instead of a second, drifting copy of it.
 */
export const BURN_VALUES = {
  /**
   * Shared by every Immolate item: `AuraDuration` 3, `TicksPerSecond` 1,
   * `Range` 325. The range is why this model works at all for Vi — a melee
   * champion mid-combo is inside her own aura's radius.
   */
  immolate: { auraDurationSeconds: 3, ticksPerSecond: 1, rangeUnits: 325 },
  /** Sunfire Aegis `DamagePerTick` = 20 + 1.5% bonus health (`mStat` 12, `mStatFormula` 2). */
  sunfire: { flatPerTick: 20, bonusHealthRatioPerTick: 0.015 },
  /** Bami's Cinder `DamagePerTick` = 15, flat: the component has no health scaling. */
  bamisCinder: { flatPerTick: 15, bonusHealthRatioPerTick: 0 },
  /** Hollow Radiance `DamagePerTick` = 15 + 1% bonus health. */
  hollowRadiance: { flatPerTick: 15, bonusHealthRatioPerTick: 0.01 },
  /**
   * Liandry's Torment. `BurnPercentHealthDamage` 0.02 per second over
   * `BurnDuration` 3 s at `TickFrequency` 0.5 s, plus Suffering's
   * `DamageIncreasePerSecond` 0.02 up to `DamageIncreaseMax` 0.06.
   */
  liandrysTorment: {
    burnDurationSeconds: 3,
    tickFrequencySeconds: 0.5,
    maxHealthPerSecond: 0.02,
    damageIncreasePerSecond: 0.02,
    damageIncreaseMax: 0.06,
  },
  /**
   * Blackfire Torch. `BurnDamagePerSecondCalc` =
   * `BurnFlatDamagePerSecond` 20 + `APRatio` 0.02 × AP, over `BurnDuration` 3 s
   * at `TickFrequency` 0.5 s.
   */
  blackfireTorch: {
    burnDurationSeconds: 3,
    tickFrequencySeconds: 0.5,
    flatPerSecond: 20,
    apRatioPerSecond: 0.02,
    /** `APPerStack`: the conditional ability power, which is not modelled — see the item's note. */
    apPerAffectedEnemy: 0.04,
  },
  /**
   * Fated Ashes. `BurnFlatDamagePerSecond` 5 over `BurnDuration` 3 s at
   * `TickFrequency` 0.5 s — which multiplies out to the 15 total that Data
   * Dragon's own resolved text states, so the two sources agree.
   */
  fatedAshes: { burnDurationSeconds: 3, tickFrequencySeconds: 0.5, flatPerSecond: 5 },
  /**
   * Demonic Embrace. `Duration` 4 s, `TickRatePerXSeconds` 1, and the split
   * Data Dragon left as a placeholder: `MeleeMaxHealthDamagePerTick` 0.016
   * against `RangedMaxHealthDamagePerTick` 0.01. Vi takes the melee value.
   */
  demonicEmbrace: {
    durationSeconds: 4,
    tickRateSeconds: 1,
    meleeMaxHealthPerTick: 0.016,
    rangedMaxHealthPerTick: 0.01,
  },
  /** Riftmaker: `EternityDamageIncreasePerSecond` 0.02 up to `EternityDamageIncreaseMax` 0.08. */
  riftmaker: { damageIncreasePerSecond: 0.02, damageIncreaseMax: 0.08 },
} as const;

/**
 * Guard for comparing accumulated times, which is all this file does with
 * floating point: a tick due at 3 s must not be dropped because three additions
 * of 0.5 landed a fraction of a nanosecond past it.
 */
const EPSILON = 1e-9;

/**
 * What a burn asks of the hit that would apply it.
 *
 * Deliberately the amplifier's narrower view of a hit rather than the full
 * `HitInfo`: whether a burn applies depends on where the hit came from and never
 * on how much it hurt. "Did it hurt at all" is a separate question, and the
 * runtime answers that one itself before asking this.
 */
type BurnTrigger = (hit: AmplifiableHit) => boolean;

/** Immolate's trigger is "After taking or dealing damage" — any damage Vi deals arms it. */
const anyDamage: BurnTrigger = () => true;

/** The wording the ability-triggered burns share is "Damaging Abilities". */
const abilityDamage: BurnTrigger = (hit) => hit.isAbilityDamage;

interface BurnSpec {
  /** Data Dragon item id; the ticks are credited to `item:<id>`. */
  id: string;
  name: string;
  /** Riot's name for the passive. It goes into every tick's label. */
  passive: string;
  /** Seconds the burn lasts from the moment it is applied or re-applied. */
  durationSeconds: number;
  /** Seconds between ticks. */
  intervalSeconds: number;
  applies: BurnTrigger;
  /** One tick's pre-mitigation damage, with the sentence that explains it. */
  tick(ctx: SimContext): { amount: number; note: string };
}

/**
 * A damage-over-time passive, expressed as scheduled ticks.
 *
 * Every burn in this family refreshes rather than stacks: re-applying it while
 * it is still running extends the same burn instead of starting a second one.
 * (The wiki notes that Liandry's does stack when *different* holders apply it,
 * which a single-attacker model never sees.) The cadence is therefore kept
 * across a refresh rather than restarted — the burn is one continuous effect
 * whose end moves, and restarting the timer on every application would let a
 * combo that re-applies the burn faster than its interval tick zero times.
 *
 * The ticks have to be scheduled in advance because `scheduleDamage` delivers
 * damage and nothing else: there is no hook that runs at tick time to queue the
 * next one. So each application schedules every tick that now fits inside the
 * window, and `nextTickAt` — always strictly ahead of the window's end — is what
 * keeps a refresh from scheduling a tick twice.
 *
 * A tick's damage is fixed when the tick is scheduled, i.e. by the stats at the
 * moment of application. That is also how Riot's buffs behave, and it is the
 * only choice available here, since the scheduled instance carries a number
 * rather than a formula.
 */
function burnRuntime(spec: BurnSpec): ItemRuntime {
  let expiresAt = -Infinity;
  let nextTickAt = 0;
  let index = 0;
  return {
    onHitLanded(ctx, hit) {
      if (hit.mitigated <= 0 || !spec.applies(hit)) return;
      const now = ctx.time;
      if (now > expiresAt) {
        // A burn that had already run out starts a fresh cadence and fresh
        // numbering; one that is still up keeps both and only moves its end.
        nextTickAt = now + spec.intervalSeconds;
        index = 0;
      }
      expiresAt = now + spec.durationSeconds;
      while (nextTickAt <= expiresAt + EPSILON) {
        index += 1;
        const { amount, note } = spec.tick(ctx);
        ctx.scheduleDamage({
          afterSeconds: nextTickAt - now,
          sourceId: `item:${spec.id}`,
          sourceLabel: `${spec.name} · ${spec.passive} tick ${index}`,
          sourceKind: 'item',
          type: 'magic',
          amount,
          notes: [note, `tick ${index} · every ${spec.intervalSeconds} s for ${spec.durationSeconds} s`],
        });
        nextTickAt += spec.intervalSeconds;
      }
    },
  };
}

interface RampSpec {
  name: string;
  passive: string;
  /** Added per full second spent in combat, as a fraction. */
  perSecond: number;
  /** The cap that ramp reaches, as a fraction. */
  max: number;
}

/**
 * "For each second in combat with enemy champions, deal N% bonus damage."
 *
 * The ramp lives on the runtime rather than on `ItemEffect.amplify` because it
 * has to remember when the fight started, and only the runtime has memory. The
 * engine adds both, so an item may implement one or the other and never both.
 *
 * Combat starts with the first damage this build deals. The simulation has no
 * way to leave combat again — a combo is one continuous fight — so the ramp only
 * ever climbs, which is the right reading of a combo but would overstate an item
 * whose holder disengaged.
 *
 * The stack is earned by whole seconds, so the hit that starts the fight is
 * unamplified and the burn ticks that follow it are amplified by whatever the
 * ramp has reached by the time each one lands.
 */
function combatRamp(spec: RampSpec): ItemRuntime {
  let combatStartedAt: number | null = null;
  let reported = 0;

  const bonusAt = (time: number): number => {
    if (combatStartedAt === null) return 0;
    const seconds = Math.floor(time - combatStartedAt + EPSILON);
    return Math.min(spec.max, Math.max(0, seconds) * spec.perSecond);
  };

  return {
    onHitLanded(ctx) {
      if (combatStartedAt === null) combatStartedAt = ctx.time;
      const bonus = bonusAt(ctx.time);
      // Only a change is news; a line per hit would bury the timeline.
      if (bonus === reported) return;
      reported = bonus;
      ctx.addEvent({
        kind: 'buff',
        label: `${spec.name} · ${spec.passive}`,
        detail: `+${(bonus * 100).toFixed(0)}% damage · caps at +${(spec.max * 100).toFixed(0)}%`,
      });
    },
    amplify(ctx) {
      return bonusAt(ctx.time);
    },
  };
}

/* -------------------------------------------------------------------- immolate */

/**
 * Sunfire Aegis and its relatives.
 *
 * Immolate is an aura rather than a debuff: it damages whatever is within 325
 * units of Vi once a second for three seconds after she deals damage. Modelling
 * it as damage to the combo's target assumes the target stays in that radius,
 * which for a melee champion mid-combo it does. The half of Riot's trigger that
 * reads "after taking damage" is outside an attacker-only model, so the aura here
 * is armed by dealing damage alone — which for any combo that has started is the
 * same thing.
 *
 * The per-tick damage scales with *bonus* health, not maximum health: Riot's
 * formula reads `mStat` 12 with `mStatFormula` 2, the same pair Riftmaker uses
 * for its "2% of your bonus Health" conversion.
 */
function immolateItem(
  id: string,
  name: string,
  values: { flatPerTick: number; bonusHealthRatioPerTick: number },
  note: string,
): ItemEffect {
  return {
    id,
    name,
    modelled: true,
    note,
    createRuntime() {
      return burnRuntime({
        id,
        name,
        passive: 'Immolate',
        durationSeconds: BURN_VALUES.immolate.auraDurationSeconds,
        intervalSeconds: 1 / BURN_VALUES.immolate.ticksPerSecond,
        applies: anyDamage,
        tick(ctx) {
          const fromHealth = values.bonusHealthRatioPerTick * ctx.stats.bonusHealth;
          return {
            amount: values.flatPerTick + fromHealth,
            note:
              values.bonusHealthRatioPerTick > 0
                ? `${values.flatPerTick} + ${(values.bonusHealthRatioPerTick * 100).toFixed(1)}% of ${ctx.stats.bonusHealth.toFixed(0)} bonus health`
                : `${values.flatPerTick} flat`,
          };
        },
      });
    },
  };
}

const SUNFIRE_AEGIS = immolateItem('3068', 'Sunfire Aegis', BURN_VALUES.sunfire, [
  'Immolate: 20 + 1.5% bonus health magic damage per second for 3s to anything within 325 units,',
  'refreshed every time Vi deals damage. Counted against the combo target, which a melee champion keeps in range.',
].join(' '));

const BAMIS_CINDER = immolateItem('6660', "Bami's Cinder", BURN_VALUES.bamisCinder, [
  'Immolate: 15 magic damage per second for 3s to anything within 325 units, refreshed every time Vi deals damage.',
  'The component has no health scaling.',
].join(' '));

/*
 * Hollow Radiance is the one item here where Riot's file contradicts itself.
 * Its `DamagePerTick` calculation reads 15 + 1% bonus health, while the data
 * values sitting beside it — `BaseDamagePerTickTOOLTIPONLY` 10 and
 * `HPRatioPerTickTOOLTIPONLY` 1.75 — describe a different burn altogether. The
 * calculation wins, because the wiki agrees with it (Sunfire's two statements
 * agree with each other, so no such choice arises there).
 *
 * Wiki-sourced, verbatim, from https://wiki.leagueoflegends.com/en-us/Hollow_Radiance:
 * "Deal 15 (+ 1% bonus health) magic damage every second to enemies within 325
 * (+ 100% bonus size) units, with the damage being increased to 125% against
 * minions and monsters."
 *
 * That last clause is the check that the wiki is reading the same file: Hollow
 * Radiance's `MinionMod` and `MonsterMod` are both 0.25, and 125% is what a
 * +25% modifier comes to. Neither applies to a champion target.
 */
const HOLLOW_RADIANCE = immolateItem('6664', 'Hollow Radiance', BURN_VALUES.hollowRadiance, [
  'Immolate: 15 + 1% bonus health magic damage per second for 3s within 325 units.',
  'Desolate is not modelled — it fires on a takedown, which is where this simulation stops.',
].join(' '));

/* ------------------------------------------------------------- ability burns */

/**
 * Liandry's Torment.
 *
 * Both passives are Riot's own resolved text in Data Dragon — "burn enemies for
 * 2% max Health magic damage per second for 3 seconds" and "For each second in
 * combat with enemy champions, deal 2% bonus damage, up to 6%" — and the bin
 * supplies the one thing the text omits, `TickFrequency` 0.5, which turns 2% per
 * second into six ticks of 1% each. Suffering amplifies everything the holder
 * deals, the burn's own ticks included, which is what putting it on the shared
 * amplifier hook gets for free.
 *
 * The bin's `MonsterDamageCap` 40 and `MaxDamageHPThreshold` 1250 clamp the burn
 * against non-champions. This model's target is a champion, so neither applies.
 */
const LIANDRYS_TORMENT: ItemEffect = {
  id: '6653',
  name: "Liandry's Torment",
  modelled: true,
  note: [
    "Torment: damaging abilities burn for 2% of the target's maximum health per second for 3s, ticking every 0.5s.",
    'Suffering: +2% damage per second in combat, up to +6%, on everything including the burn.',
  ].join(' '),
  createRuntime() {
    const burn = burnRuntime({
      id: '6653',
      name: "Liandry's Torment",
      passive: 'Torment',
      durationSeconds: BURN_VALUES.liandrysTorment.burnDurationSeconds,
      intervalSeconds: BURN_VALUES.liandrysTorment.tickFrequencySeconds,
      applies: abilityDamage,
      tick(ctx) {
        const share =
          BURN_VALUES.liandrysTorment.maxHealthPerSecond *
          BURN_VALUES.liandrysTorment.tickFrequencySeconds;
        return {
          amount: share * ctx.targetMaxHealth,
          note: `${(share * 100).toFixed(1)}% of the target's ${ctx.targetMaxHealth.toFixed(0)} maximum health`,
        };
      },
    });
    const ramp = combatRamp({
      name: "Liandry's Torment",
      passive: 'Suffering',
      perSecond: BURN_VALUES.liandrysTorment.damageIncreasePerSecond,
      max: BURN_VALUES.liandrysTorment.damageIncreaseMax,
    });
    return {
      onHitLanded(ctx, hit) {
        burn.onHitLanded?.(ctx, hit);
        ramp.onHitLanded?.(ctx, hit);
      },
      amplify(ctx, hit) {
        return ramp.amplify?.(ctx, hit) ?? 0;
      },
    };
  },
};

/**
 * Blackfire Torch.
 *
 * Data Dragon's text for Baleful Blaze has had its number removed — "Damaging
 * Abilities deals bonus magic damage for 3 seconds" — so the size of the burn
 * comes from Riot's `BurnDamagePerSecondCalc`: 20 flat plus 2% AP per second,
 * `TickFrequency` 0.5, three seconds. Six ticks of 10 + 1% AP.
 *
 * The second passive, 4% ability power per enemy the burn is on, is not
 * modelled: `ItemEffect.stats` is a fixed block and cannot depend on whether a
 * debuff is currently live, and reaching for `applyTemporaryStats` instead would
 * take a share of ability power that already includes the share granted a moment
 * earlier, compounding a flat 4% into something Riot never wrote.
 */
const BLACKFIRE_TORCH: ItemEffect = {
  id: '2503',
  name: 'Blackfire Torch',
  modelled: true,
  note: [
    'Baleful Blaze: damaging abilities burn for 20 + 2% AP per second over 3s, ticking every 0.5s.',
    'The conditional 4% ability power per burning enemy is not modelled.',
  ].join(' '),
  createRuntime() {
    return burnRuntime({
      id: '2503',
      name: 'Blackfire Torch',
      passive: 'Baleful Blaze',
      durationSeconds: BURN_VALUES.blackfireTorch.burnDurationSeconds,
      intervalSeconds: BURN_VALUES.blackfireTorch.tickFrequencySeconds,
      applies: abilityDamage,
      tick(ctx) {
        const share = BURN_VALUES.blackfireTorch.tickFrequencySeconds;
        const flat = BURN_VALUES.blackfireTorch.flatPerSecond * share;
        const fromAp = BURN_VALUES.blackfireTorch.apRatioPerSecond * share * ctx.stats.abilityPower;
        return {
          amount: flat + fromAp,
          note: `${flat} + ${(BURN_VALUES.blackfireTorch.apRatioPerSecond * share * 100).toFixed(1)}% of ${ctx.stats.abilityPower.toFixed(0)} ability power`,
        };
      },
    });
  },
};

/**
 * Fated Ashes.
 *
 * The one item in this family whose burn Data Dragon states outright — "Damaging
 * Abilities deal 15 bonus magic damage over 3 seconds" — and the bin agrees:
 * `BurnFlatDamagePerSecond` 5 at `TickFrequency` 0.5 over three seconds is six
 * ticks of 2.5, which is 15. The monster bonus — `MonsterDamageBonus` 15 per
 * second, which is the "additional 45 magic damage to monsters" Data Dragon
 * states — is out of scope for a champion target.
 */
const FATED_ASHES: ItemEffect = {
  id: '2508',
  name: 'Fated Ashes',
  modelled: true,
  note: 'Inflame: damaging abilities burn for 5 magic damage per second over 3s (15 total), ticking every 0.5s.',
  createRuntime() {
    return burnRuntime({
      id: '2508',
      name: 'Fated Ashes',
      passive: 'Inflame',
      durationSeconds: BURN_VALUES.fatedAshes.burnDurationSeconds,
      intervalSeconds: BURN_VALUES.fatedAshes.tickFrequencySeconds,
      applies: abilityDamage,
      tick() {
        const amount =
          BURN_VALUES.fatedAshes.flatPerSecond * BURN_VALUES.fatedAshes.tickFrequencySeconds;
        return { amount, note: `${amount} per tick, ${BURN_VALUES.fatedAshes.flatPerSecond} per second` };
      },
    });
  },
};

/**
 * Demonic Embrace.
 *
 * Data Dragon leaves the number as `{{ Item_Melee_Ranged_Split }}`, so the two
 * halves come from Riot's data values: `MeleeMaxHealthDamagePerTick` 0.016 and
 * `RangedMaxHealthDamagePerTick` 0.01, over `Duration` 4 at
 * `TickRatePerXSeconds` 1. Vi is melee, so this is four ticks of 1.6% of the
 * target's maximum health. `MonsterCap` 40 governs non-champions and does not
 * apply here.
 *
 * Dark Pact — 2% of bonus health as ability power — is not modelled: it is a
 * stat that depends on another stat, and `ItemEffect.stats` is a fixed block
 * with no view of the build it is added to.
 */
const DEMONIC_EMBRACE: ItemEffect = {
  id: '4637',
  name: 'Demonic Embrace',
  modelled: true,
  note: [
    "Azakana's Gaze: ability damage burns for 1.6% of the target's maximum health per second for 4s (the melee value).",
    'Dark Pact, 2% of bonus health as ability power, is not modelled.',
  ].join(' '),
  createRuntime() {
    return burnRuntime({
      id: '4637',
      name: 'Demonic Embrace',
      passive: "Azakana's Gaze",
      durationSeconds: BURN_VALUES.demonicEmbrace.durationSeconds,
      intervalSeconds: BURN_VALUES.demonicEmbrace.tickRateSeconds,
      applies: abilityDamage,
      tick(ctx) {
        const share = BURN_VALUES.demonicEmbrace.meleeMaxHealthPerTick;
        return {
          amount: share * ctx.targetMaxHealth,
          note: `${(share * 100).toFixed(1)}% of the target's ${ctx.targetMaxHealth.toFixed(0)} maximum health, melee value`,
        };
      },
    });
  },
};

/**
 * Riftmaker.
 *
 * No burn: what it has is Liandry's ramp with a higher ceiling, stated in Data
 * Dragon's own text as "For each second in combat with enemy champions, deal 2%
 * bonus damage, up to 8%", and confirmed by `EternityDamageIncreasePerSecond`
 * 0.02 with `EternityDamageIncreaseMax` 0.08.
 *
 * The other two halves of the item are outside this model. Void Infusion turns
 * 2% of bonus health into ability power — a stat derived from a stat, which the
 * fixed `stats` block cannot express — and the omnivamp granted at full stacks is
 * healing rather than damage.
 */
/*
 * Riftmaker lives in items/bruiser.ts.
 *
 * Its ramp is a combat-duration amplifier rather than a burn, and the bruiser
 * family already models the "in combat with a champion" clock it needs — two
 * copies of one item would have registered twice and silently disagreed the
 * first time one of them was edited.
 */

/*
 * Mode-specific copies of these items are deliberately not aliased onto the
 * Summoner's Rift entries. They are separately balanced and their data values
 * differ: Arena's Blackfire Torch (222503) carries `APRatio` 0.04 against
 * 0.02 here, and Arena's Sunfire Aegis (223068) a different health ratio again.
 * Pointing them at these numbers would report damage the mode does not deal.
 */
export const BURN_ITEMS: ItemEffect[] = [
  SUNFIRE_AEGIS,
  BAMIS_CINDER,
  HOLLOW_RADIANCE,
  LIANDRYS_TORMENT,
  BLACKFIRE_TORCH,
  FATED_ASHES,
  DEMONIC_EMBRACE,
];
