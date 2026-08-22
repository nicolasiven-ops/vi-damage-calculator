/**
 * Burn, bleed and damage-over-time item passives.
 *
 * Provenance. Every number here is Riot's. Where Data Dragon's resolved text
 * for patch 16.16.1 carries the number, that is the source; where it does not,
 * the number comes from the item's own `mDataValues` and `mItemCalculations`
 * in Riot's item bin, read through the CommunityDragon mirror
 * (`items.cdtb.bin.json`, last modified 2026-08-16). Data Dragon needs that
 * fallback three times over: it writes Immolate as "deal magic damage per
 * second" and Baleful Blaze as "deals bonus magic damage" with the numbers
 * stripped out entirely, and it ships Demonic Embrace's melee/ranged split as
 * the literal placeholder `{{ Item_Melee_Ranged_Split }}`.
 *
 * The wiki appears four times, each quoted verbatim and marked as the wiki's,
 * and only where Riot's own files leave a gap or state a thing twice and not
 * identically:
 *  - Hollow Radiance, where the bin's calculation and the tooltip-only values
 *    beside it disagree and something has to break the tie;
 *  - Liandry's Torment, where Data Dragon abbreviates the trigger to "Damaging
 *    Abilities" and drops the pet-damage half of it;
 *  - Zeke's Convergence, where Riot states a damage *per second* and no tick
 *    frequency at all;
 *  - Immolate, for the full activation condition, which is the sentence the
 *    aura's shorter model here is measured against.
 *
 * Vi is melee, so every melee/ranged split below takes the melee value and says
 * where the ranged one went.
 *
 * Two properties hold for every burn in this file. It is magic damage, and it
 * is not ability damage: the burn is the item's damage rather than the
 * ability's, so it must not feed effects that key on ability hits — which is
 * why none of these pass `isAbilityDamage`. And it is `sourceKind: 'item'`,
 * which the engine refuses to let re-trigger on-hit procs (the gate in
 * `../../engine/simulate.ts` excludes `'rune'` and `'item'`). That rule is what
 * stops an item's own damage from feeding every other proc in the build, and it
 * has a cost at Immolate, stated at that item rather than sold as a benefit.
 *
 * Considered and left out
 * -----------------------
 * Items whose text reads like a burn and is not one, or is one this model
 * cannot deal. Each is named with what is missing, because "absent" and
 * "overlooked" have to be told apart — the same convention `./onhit.ts` uses.
 * The test asserts the absences; the reasoning is here, where the next person
 * editing the family will look.
 *
 *  - Morellonomicon (3165). Grievous Wounds is healing reduction on the target
 *    — Data Dragon: "Dealing magic damage to champions applies 40% Wounds for 3
 *    seconds" — and never produces a damage instance. This model tracks the
 *    damage Vi deals plus her own healing, not the target's, so there is nothing
 *    for a hook to carry. Its stat line still counts through `../items.ts`.
 *  - Thornmail (3075). "When struck by an Attack, deal magic damage to the
 *    attacker": the damage flows from the target to Vi, not from Vi to the
 *    target. The missing capability is retaliation — a hook for damage dealt on
 *    *being* hit, and a model of the target attacking at all, neither of which
 *    exists. Its 40% Wounds half would be out of scope regardless, as above.
 *  - Death's Dance (6333). Ignore Pain — "A percentage of damage taken is dealt
 *    to you over 3 seconds instead" — is a damage-over-time effect on Vi
 *    herself. It defers incoming damage, so it needs the same thing Thornmail
 *    does: a model of the target dealing damage. Defy's healing is gated on a
 *    takedown, which is where this simulation stops.
 *  - Bastionbreaker (2520). Two halves, both out. Shaped Charge's true damage is
 *    an instant rider on ability damage, not a burn, so it belongs to whichever
 *    family models on-ability riders rather than here. Sabotage is true damage
 *    over 3 s, and Data Dragon scopes it: "your next Attack against an Epic
 *    Monster or Turret" — never against the champion this model targets, and
 *    armed only by a takedown.
 *
 * Coverage. Everything in `BURN_ITEMS` reaches `simulate()`: the array is spread
 * into the registry in `../itemEffects.ts`, and `MODELLED_ITEM_IDS` in
 * `../itemDecisions.ts` is read off `REGISTERED_ITEM_IDS`, so every id here
 * already carries a `{kind: 'modelled'}` verdict without a second hand-kept
 * list to fall behind.
 */

import type { AmplifiableHit, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';

/**
 * Riot's data values, kept in one block and named after the fields they came
 * from, so the numbers can be read against the bin without hunting through the
 * code.
 *
 * The tests deliberately do *not* read this object where a magnitude is at
 * stake. A test that derives its expectation from the same constant the
 * implementation reads moves both sides of the comparison together and can
 * never catch a typo; so each item's expected damage is written out in
 * `test/items.burn.test.ts` as arithmetic on Riot literals, with the source
 * named. Drift between the two is the signal, not a defect.
 */
export const BURN_VALUES = {
  /**
   * Shared by every Immolate item: `AuraDuration` 3, `TicksPerSecond` 1,
   * `Range` 325. The range is why this model works at all for Vi — a melee
   * champion mid-combo is inside her own aura's radius. It is documentation
   * only: the simulation has no positions, so nothing checks it. It is a
   * constant rather than a literal in three note strings so that the number a
   * reader sees is the number the bin states, in one place.
   */
  immolate: { auraDurationSeconds: 3, ticksPerSecond: 1, rangeUnits: 325 },
  /**
   * Sunfire Aegis `DamagePerTick` = 20 + 1.5% bonus health, from
   * `mItemCalculations.DamagePerTick`: a `NumberCalculationPart` of 20 plus a
   * `StatByCoefficientCalculationPart` with `mStat` 12, `mStatFormula` 2 and
   * `mCoefficient` 0.015. The tooltip-only pair beside it agrees
   * (`BaseDamagePerTickTOOLTIPONLY` 20, `HPRatioPerTickTOOLTIPONLY` 1.5).
   */
  sunfire: { flatPerTick: 20, bonusHealthRatioPerTick: 0.015 },
  /** Bami's Cinder `DamagePerTick` = 15, flat: the component has no health scaling. */
  bamisCinder: { flatPerTick: 15, bonusHealthRatioPerTick: 0 },
  /** Hollow Radiance `DamagePerTick` = 15 + 1% bonus health. See the item for the tie-break. */
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
   * Blackfire Torch. `BurnFlatDamagePerSecond` 20 + `APRatio` 0.02 × AP, over
   * `BurnDuration` 3 s at `TickFrequency` 0.5 s.
   */
  blackfireTorch: {
    burnDurationSeconds: 3,
    tickFrequencySeconds: 0.5,
    flatPerSecond: 20,
    apRatioPerSecond: 0.02,
  },
  /**
   * Fated Ashes. `BurnFlatDamagePerSecond` 5 over `BurnDuration` 3 s at
   * `TickFrequency` 0.5 s — which multiplies out to the 15 total that Data
   * Dragon's own resolved text states, so the two sources agree.
   */
  fatedAshes: { burnDurationSeconds: 3, tickFrequencySeconds: 0.5, flatPerSecond: 5 },
  /**
   * Demonic Embrace. `Duration` 4 s, `TickRatePerXSeconds` 1, and the melee half
   * of the split Data Dragon left as a placeholder:
   * `MeleeMaxHealthDamagePerTick` 0.016. Vi is melee, so the ranged half —
   * `RangedMaxHealthDamagePerTick` 0.01 — is stated here as prose rather than
   * carried as a constant nothing reads; the test pins it as a literal to prove
   * the model is not using it.
   */
  demonicEmbrace: {
    durationSeconds: 4,
    tickRateSeconds: 1,
    meleeMaxHealthPerTick: 0.016,
  },
  /**
   * Zeke's Convergence. `Duration` 5, `DamagePerSecond` 30, `Cooldown` 45,
   * `StormRadius` 350, `SlowAmount` 0.3. `tickSeconds` is the one number Riot's
   * file does not state — see the item for the wiki quote it comes from.
   */
  zekesConvergence: {
    durationSeconds: 5,
    damagePerSecond: 30,
    tickSeconds: 0.25,
    cooldownSeconds: 45,
    radiusUnits: 350,
    slowFraction: 0.3,
  },
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

/**
 * "Damaging Abilities", which is Data Dragon's wording for Blackfire Torch,
 * Fated Ashes and Demonic Embrace — and the wiki agrees for all three ("Dealing
 * ability damage burns enemies…", with no pet clause). Liandry's is the one item
 * in the family whose trigger is wider, and it has its own predicate below.
 */
const abilityDamage: BurnTrigger = (hit) => hit.isAbilityDamage;

/**
 * Liandry's trigger alone.
 *
 * Data Dragon abbreviates it to "Damaging Abilities burn enemies", which drops
 * half the condition. Wiki-sourced, verbatim, from
 * https://wiki.leagueoflegends.com/en-us/Liandry%27s_Torment: "Dealing ability
 * damage or pet damage burns enemies, causing them to take 1% of the target's
 * maximum health magic damage every 0.5 seconds over 3 seconds, capped at 20 per
 * tick against monsters."
 *
 * The pet half is reachable in this codebase rather than hypothetical:
 * `../petEffects.ts` schedules Scorchclaw's Slash as `sourceId: 'pet:scorchclaw'`
 * with `sourceKind: 'summoner'`, and the engine's proc gate excludes only
 * `'rune'` and `'item'`, so that damage does arrive at `onHitLanded`. A Vi build
 * running offensive Smite alongside Liandry's would otherwise lose the burn.
 *
 * The test is the `pet:` id prefix and not `sourceKind === 'summoner'`, because
 * Ignite (`summoner:ignite`) and Smite (`summoner:<id>`) are `'summoner'` too and
 * neither of those is a pet — neither applies Torment.
 */
const abilityOrPetDamage: BurnTrigger = (hit) =>
  hit.isAbilityDamage || hit.sourceId.startsWith('pet:');

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
 * Two conditions on what starts the clock, both taken from Riot's wording and
 * both held here rather than left to the fact that the current model has one
 * champion target and no damage-immune phases:
 *  - the hit has to have hurt (`hit.mitigated > 0`), the same guard
 *    `burnRuntime` applies. A fully blocked instance is not combat damage.
 *  - the target has to be a champion. Riot's condition is "in combat with enemy
 *    *champions*"; `../petEffects.ts` gates on `ctx.target.unitType` the same
 *    way. Against a minion or monster the ramp therefore stays at zero, which is
 *    what the game does.
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
    onHitLanded(ctx, hit) {
      if (hit.mitigated <= 0) return;
      if (ctx.target.unitType !== 'champion') return;
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
 *
 * Re-arming, and where this model is shorter than the game. Riot's activation
 * condition is any damage, with no carve-out for the aura's own ticks —
 * wiki-sourced, verbatim, from
 * https://wiki.leagueoflegends.com/en-us/Sunfire_Aegis: "Taking or dealing
 * damage activates this passive for 3 seconds. Deal 20 (+ 1.5% bonus health)
 * magic damage every second to enemies within 325 (+ 100% bonus size) units".
 * Immolate's own tick is damage dealt, so in game the aura re-arms itself and
 * stays lit for as long as an enemy is in range. Here it cannot: the engine
 * refuses to let `sourceKind: 'item'` damage re-trigger on-hit procs, so the
 * aura is re-armed only by Vi's attacks and abilities. That exclusion is kept —
 * letting the tick back in would feed every other proc in the build, a far
 * larger error than a short aura — and the shorter aura is accepted
 * deliberately. It costs nothing for a combo in which Vi keeps attacking, since
 * each of her hits re-arms the aura anyway; the divergence needs a gap longer
 * than 3 s in which she deals no damage at all while the target stays inside
 * 325 units.
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

const IMMOLATE_RANGE = BURN_VALUES.immolate.rangeUnits;

const SUNFIRE_AEGIS = immolateItem('3068', 'Sunfire Aegis', BURN_VALUES.sunfire, [
  `Immolate: 20 + 1.5% bonus health magic damage per second for 3s to anything within ${IMMOLATE_RANGE} units,`,
  'refreshed every time Vi deals damage. Counted against the combo target, which a melee champion keeps in range.',
].join(' '));

const BAMIS_CINDER = immolateItem('6660', "Bami's Cinder", BURN_VALUES.bamisCinder, [
  `Immolate: 15 magic damage per second for 3s to anything within ${IMMOLATE_RANGE} units,`,
  'refreshed every time Vi deals damage. The component has no health scaling.',
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
 * +25% modifier comes to. Neither applies to a champion target. (Sunfire's own
 * pair are 0.5 and 0.8, i.e. 150% and 180%, which is again what its wiki page
 * says — the same cross-check, on the item where no tie-break was needed.)
 */
const HOLLOW_RADIANCE = immolateItem('6664', 'Hollow Radiance', BURN_VALUES.hollowRadiance, [
  `Immolate: 15 + 1% bonus health magic damage per second for 3s within ${IMMOLATE_RANGE} units.`,
  'Desolate is not modelled — it fires on a takedown, which is where this simulation stops.',
].join(' '));

/* ------------------------------------------------------------- ability burns */

/**
 * Liandry's Torment.
 *
 * Suffering is Riot's own resolved text in Data Dragon — "For each second in
 * combat with enemy champions, deal 2% bonus damage, up to 6%" — and it
 * amplifies everything the holder deals, the burn's own ticks included, which is
 * what putting it on the shared amplifier hook gets for free.
 *
 * Torment's size is Riot's too — "burn enemies for 2% max Health magic damage
 * per second for 3 seconds" — and the bin supplies the one thing the text omits,
 * `TickFrequency` 0.5, which turns 2% per second into six ticks of 1% each. Its
 * *trigger* is the one thing Data Dragon states incompletely; see
 * `abilityOrPetDamage` above for the wiki's full wording and why this item does
 * not share the family's ability-only predicate.
 *
 * The bin's `MonsterDamageCap` 40 and `MaxDamageHPThreshold` 1250 clamp the burn
 * against non-champions. This model's target is a champion, so neither applies.
 */
const LIANDRYS_TORMENT: ItemEffect = {
  id: '6653',
  name: "Liandry's Torment",
  modelled: true,
  note: [
    "Torment: ability damage and pet damage burn for 2% of the target's maximum health per second for 3s, ticking every 0.5s.",
    'Suffering: +2% damage per second in combat with a champion, up to +6%, on everything including the burn.',
  ].join(' '),
  createRuntime() {
    const burn = burnRuntime({
      id: '6653',
      name: "Liandry's Torment",
      passive: 'Torment',
      durationSeconds: BURN_VALUES.liandrysTorment.burnDurationSeconds,
      intervalSeconds: BURN_VALUES.liandrysTorment.tickFrequencySeconds,
      applies: abilityOrPetDamage,
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
 * comes from Riot's `mDataValues`: `BurnFlatDamagePerSecond` 20 plus `APRatio`
 * 0.02 × ability power, at `TickFrequency` 0.5 over `BurnDuration` 3. Six ticks
 * of 10 + 1% AP.
 *
 * The second passive is not modelled, and its number is stated here as prose
 * rather than carried as a constant, because a constant nothing reads cannot
 * drift detectably and reads like a live value: Riot's `APPerStack` is
 * 0.04 (Data Dragon: "For each enemy champion, epic and large monster affected
 * by your Baleful Blaze, gain 4% Ability Power"). It is left out because
 * `ItemEffect.stats` is a fixed block and cannot depend on whether a debuff is
 * currently live, and reaching for `applyTemporaryStats` instead would take a
 * share of ability power that already includes the share granted a moment
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
 * target's maximum health, and the ranged 1% appears in this file only in this
 * sentence and in the test that asserts the model does not use it.
 * `MonsterCap` 40 governs non-champions and does not apply here.
 *
 * Dark Pact — 2% of bonus health as ability power, Riot's
 * `HealthToAPConversionPercent` 0.02 — is not modelled: it is a stat that
 * depends on another stat, and `ItemEffect.stats` is a fixed block with no view
 * of the build it is added to.
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

/* ----------------------------------------------------------- ultimate aura */

/**
 * Zeke's Convergence.
 *
 * The only per-second damage aura in the shop that Immolate does not cover, and
 * the only entry in this family armed by a cast rather than by damage: Data
 * Dragon states it outright — "Casting your Ultimate summons a storm around you
 * for 5 seconds. The storm deals 30 magic damage per second to enemy champions
 * and Slows them by 30%" — and `Items/3050` in the bin agrees, with `Duration`
 * 5, `DamagePerSecond` 30, `Cooldown` 45, `StormRadius` 350 and `SlowAmount`
 * 0.3. It therefore hangs off `onAbilityCast` for slot `R`, not off a burn
 * trigger.
 *
 * Riot states a damage per second and no tick frequency anywhere, so the
 * cadence is the wiki's. Wiki-sourced, verbatim, from
 * https://wiki.leagueoflegends.com/en-us/Zeke%27s_Convergence: the storm "deals
 * damage every 0.25 seconds (7.5 magic damage per tick, totaling 150 maximum
 * magic damage)". Twenty ticks of 7.5 is the same 150 that 30 per second for 5 s
 * comes to, so the choice of cadence changes no total — only where the damage
 * lands on the timeline, and the finer cadence is the one Riot's client uses.
 *
 * Two clauses of Riot's own text are simplified, both stated rather than hidden:
 *  - the storm arms "once an enemy champion is within Frostfire Tempest's radius
 *    or after 5 seconds otherwise" (`ReadyDuration` 5). A combo's target is by
 *    construction the champion Vi is fighting, so the storm is taken to start at
 *    the cast; a model with positions would have to delay it.
 *  - `StormRadius` 350 is documentation only, like Immolate's 325 — the
 *    simulation has no positions to check it against.
 *
 * `UltimateHaste` 15 is not modelled: the stat block has flat and basic-ability
 * haste and no field for ultimate-only haste, the same gap `./bruiser.ts` names
 * for Experimental Hexplate.
 */
const ZEKES_CONVERGENCE: ItemEffect = {
  id: '3050',
  name: "Zeke's Convergence",
  modelled: true,
  note: [
    `Frostfire Tempest: the ultimate summons a storm for ${BURN_VALUES.zekesConvergence.durationSeconds}s`,
    `dealing ${BURN_VALUES.zekesConvergence.damagePerSecond} magic damage per second`,
    `to enemy champions within ${BURN_VALUES.zekesConvergence.radiusUnits} units, on a ${BURN_VALUES.zekesConvergence.cooldownSeconds}s cooldown.`,
    `The ${(BURN_VALUES.zekesConvergence.slowFraction * 100).toFixed(0)}% slow is recorded and changes no number;`,
    'the 15 ultimate ability haste is not modelled.',
  ].join(' '),
  createRuntime() {
    const values = BURN_VALUES.zekesConvergence;
    const ticks = Math.round(values.durationSeconds / values.tickSeconds);
    const perTick = values.damagePerSecond * values.tickSeconds;
    let readyAt = 0;
    return {
      onAbilityCast(ctx, slot) {
        if (slot !== 'R' || ctx.time < readyAt) return;
        // Riot scopes the damage to enemy champions; against a minion or monster
        // the storm exists and deals nothing, so the cooldown is not spent here
        // either — there is no storm to have summoned.
        if (ctx.target.unitType !== 'champion') return;
        readyAt = ctx.time + values.cooldownSeconds;
        for (let tick = 1; tick <= ticks; tick += 1) {
          ctx.scheduleDamage({
            afterSeconds: tick * values.tickSeconds,
            sourceId: 'item:3050',
            sourceLabel: `Zeke's Convergence · Frostfire Tempest tick ${tick}`,
            sourceKind: 'item',
            type: 'magic',
            amount: perTick,
            notes: [
              `${perTick} per tick · ${values.damagePerSecond} per second for ${values.durationSeconds} s`,
              `tick ${tick} of ${ticks} · every ${values.tickSeconds} s`,
            ],
          });
        }
        ctx.applyCrowdControl({
          label: `Zeke's Convergence · slowed ${(values.slowFraction * 100).toFixed(0)}%`,
          durationSeconds: values.durationSeconds,
          detail: 'movement only, while inside the storm',
        });
      },
    };
  },
};

/*
 * Mode-specific copies of these items are deliberately not aliased onto the
 * Summoner's Rift entries. They are separately balanced and their data values
 * differ: Arena's Blackfire Torch (222503) carries `APRatio` 0.04 against
 * 0.02 here, and Arena's Sunfire Aegis (223068) a different health ratio again.
 * Pointing them at these numbers would report damage the mode does not deal.
 *
 * Riftmaker (4633) is not here either, and is not an omission: its ramp is a
 * combat-duration amplifier rather than a burn, and `./bruiser.ts` already
 * models the "in combat with a champion" clock it needs. Two copies of one item
 * would have registered twice — which `test/itemRegistry.test.ts` now fails on —
 * and silently disagreed the first time one of them was edited.
 */
export const BURN_ITEMS: ItemEffect[] = [
  SUNFIRE_AEGIS,
  BAMIS_CINDER,
  HOLLOW_RADIANCE,
  LIANDRYS_TORMENT,
  BLACKFIRE_TORCH,
  FATED_ASHES,
  DEMONIC_EMBRACE,
  ZEKES_CONVERGENCE,
];
