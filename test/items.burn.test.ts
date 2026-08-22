import { describe, expect, it } from 'vitest';
import { BURN_ITEMS } from '../src/model/items/burn';
import { type AmplifiableHit, type ItemEffect, type ItemRuntime } from '../src/model/itemEffects';
import type { DealDamageArgs, SimContext } from '../src/engine/context';
import type { HitInfo } from '../src/model/runes';
import {
  DEFAULT_TIMINGS,
  type AbilitySlot,
  type DamageInstance,
  type DamageType,
  type SourceKind,
  type TargetConfig,
} from '../src/engine/types';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

/**
 * The runtimes are driven against a stand-in context rather than through
 * `simulate()`.
 *
 * They *are* registered — `BURN_ITEMS` is spread into the registry in
 * `itemEffects.ts` — so `itemMechanics.test.ts` could reach them by id. It is
 * still worth driving them directly: a burn's whole behaviour is a cadence, and
 * a stand-in clock lets a test say "these ticks, at these times, in this order"
 * without a combo's cast times and attack timers moving the answer.
 *
 * The stand-in reproduces the parts of the engine's contract this family depends
 * on, and nothing else:
 *
 *  - `scheduleDamage` queues; the clock delivers in time order, which is what
 *    makes a burn's cadence observable at all.
 *  - amplifiers run before the hit they scale, and stack multiplicatively, in
 *    the same order `applyDamage` uses.
 *  - damage the item itself deals never re-triggers `onHitLanded`. That is the
 *    engine's rule (`sourceKind === 'item'` is excluded), and burn.ts's Immolate
 *    note explains what it costs there.
 *
 * Every hook the family must *not* need throws instead of returning, so a burn
 * that starts reaching for shreds or temporary stats fails loudly here.
 * `applyCrowdControl` is recorded rather than refused: Zeke's Convergence slows,
 * and a slow that changes no number is still a thing the timeline shows.
 *
 * On the numbers. Nothing here reads `BURN_VALUES`. A test that derives its
 * expectation from the constant the implementation reads moves both sides of the
 * comparison together and cannot catch a typo, so every magnitude below is
 * written out as arithmetic on Riot's own literals with the source named. If a
 * constant in burn.ts is edited to something Riot does not say, these fail.
 *
 * The target carries far more health than these combos deal, so nothing depends
 * on the engine's refusal to damage a corpse.
 */
const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 3000,
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

/** One recorded damage instance: what was asked for, and what it became. */
interface Recorded {
  time: number;
  sourceId: string;
  label: string;
  type: DamageType;
  /** Pre-amplification, as the item asked for it. */
  raw: number;
  /** After this build's amplifiers, evaluated at the moment it landed. */
  amplified: number;
  notes: string[];
}

const unused = (hook: string) => (): never => {
  throw new Error(`a burn item reached for ctx.${hook}(), which this family has no business calling`);
};

function harness(
  effect: ItemEffect,
  options: { bonusStats?: Partial<StatBlock>; target?: Partial<TargetConfig> } = {},
) {
  const bonus: StatBlock = { ...emptyStats(), ...options.bonusStats };
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonus);
  const target: TargetConfig = { ...TARGET, ...options.target };
  const runtime: ItemRuntime = effect.createRuntime?.() ?? {};

  let time = 0;
  let currentHealth = target.maxHealth;
  let counter = 0;
  const queue: { at: number; run: () => void }[] = [];
  const instances: Recorded[] = [];
  const events: { time: number; label: string; detail: string }[] = [];
  const crowdControl: { time: number; label: string; durationSeconds: number }[] = [];

  function amplification(hit: AmplifiableHit): number {
    let factor = 1;
    if (effect.amplify) factor *= 1 + effect.amplify(ctx, hit);
    if (runtime.amplify) factor *= 1 + runtime.amplify(ctx, hit);
    return factor;
  }

  function record(args: DealDamageArgs): DamageInstance {
    const factor = amplification({
      sourceId: args.sourceId,
      sourceKind: args.sourceKind,
      type: args.type,
      isAbilityDamage: args.isAbilityDamage ?? false,
      triggersOnHit: args.triggersOnHit ?? false,
    });
    const amplified = args.amount * factor;
    currentHealth = Math.max(0, currentHealth - amplified);
    counter += 1;
    instances.push({
      time,
      sourceId: args.sourceId,
      label: args.sourceLabel,
      type: args.type,
      raw: args.amount,
      amplified,
      notes: args.notes ?? [],
    });
    return {
      id: `h${counter}`,
      seq: counter,
      time,
      sourceId: args.sourceId,
      sourceLabel: args.sourceLabel,
      sourceKind: args.sourceKind,
      type: args.type,
      raw: args.amount,
      mitigated: amplified,
      crit: false,
      targetHpAfter: currentHealth,
      notes: args.notes ?? [],
    };
  }

  const ctx: SimContext = {
    get time() {
      return time;
    },
    get timings() {
      return DEFAULT_TIMINGS;
    },
    get stats() {
      return stats;
    },
    get target() {
      return target;
    },
    get targetMaxHealth() {
      return target.maxHealth;
    },
    get targetCurrentHealth() {
      return currentHealth;
    },
    rank: () => 5,
    dealDamage: (args) => record(args),
    scheduleDamage: ({ afterSeconds, ...damage }) => {
      queue.push({ at: time + Math.max(0, afterSeconds), run: () => record(damage) });
    },
    addEvent: (event) => {
      events.push({ time, label: event.label, detail: event.detail });
    },
    warn: (message) => {
      throw new Error(`unexpected warning: ${message}`);
    },
    applyArmorShred: unused('applyArmorShred'),
    applyMagicResistShred: unused('applyMagicResistShred'),
    grantShield: unused('grantShield'),
    applyTemporaryStats: unused('applyTemporaryStats'),
    clearTemporaryStats: unused('clearTemporaryStats'),
    applyTargetAmplification: unused('applyTargetAmplification'),
    applyCrowdControl: (args) => {
      crowdControl.push({ time, label: args.label, durationSeconds: args.durationSeconds });
    },
  };

  /**
   * One hit of damage, reported to the item the way the engine does.
   *
   * `sourceId` and `sourceKind` are open rather than fixed to attack/ability
   * because a trigger can turn on either: Liandry's reads the id (`pet:` versus
   * `summoner:`), so a test has to be able to hand it both.
   */
  function land(
    options: {
      raw?: number;
      isAbilityDamage?: boolean;
      sourceId?: string;
      sourceKind?: SourceKind;
      type?: DamageType;
      label?: string;
    } = {},
  ): DamageInstance {
    const ability = options.isAbilityDamage ?? false;
    const instance = record({
      sourceId: options.sourceId ?? (ability ? 'ability:Q' : 'attack'),
      sourceLabel: options.label ?? (ability ? 'Vault Breaker' : 'Basic attack'),
      sourceKind: options.sourceKind ?? (ability ? 'ability' : 'attack'),
      type: options.type ?? 'physical',
      amount: options.raw ?? 100,
      isAbilityDamage: ability,
      triggersOnHit: !ability,
    });
    const hit: HitInfo = {
      sourceId: instance.sourceId,
      sourceKind: instance.sourceKind,
      type: instance.type,
      isAbilityDamage: ability,
      triggersOnHit: !ability,
      mitigated: instance.mitigated,
      targetHealthPercentAfter: instance.targetHpAfter / target.maxHealth,
    };
    runtime.onHitLanded?.(ctx, hit);
    return instance;
  }

  function advanceTo(to: number): void {
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > to) break;
      queue.shift();
      time = Math.max(time, next.at);
      // Deliberately no `onHitLanded`: this is the item's own damage.
      next.run();
    }
    time = Math.max(time, to);
  }

  return {
    stats,
    target,
    instances,
    events,
    crowdControl,
    land,
    attack: () => land(),
    cast: () => land({ isAbilityDamage: true }),
    /** A cast with no damage attached — what `onAbilityCast` alone is told. */
    castAbility: (slot: AbilitySlot) => runtime.onAbilityCast?.(ctx, slot),
    advanceTo,
    /** Only the item's own instances — the burn, not what triggered it. */
    ticks: (): Recorded[] => instances.filter((entry) => entry.sourceId.startsWith('item:')),
  };
}

function effectFor(id: string): ItemEffect {
  const effect = BURN_ITEMS.find((entry) => entry.id === id);
  if (!effect) throw new Error(`burn.ts does not model item ${id}`);
  return effect;
}

/** The tick number each label claims, so the claim itself can be checked. */
function tickIndices(ticks: Recorded[]): number[] {
  return ticks.map((tick) => {
    const match = /tick (\d+)$/.exec(tick.label);
    if (!match) throw new Error(`a burn tick's label does not say which tick it is: ${tick.label}`);
    return Number(match[1]);
  });
}

function sum(ticks: Recorded[], pick: (tick: Recorded) => number): number {
  return ticks.reduce((total, tick) => total + pick(tick), 0);
}

/**
 * The bonus health every Immolate assertion below is written against.
 *
 * `resolveChampionStats` maps `bonus.hp` straight onto `bonusHealth`, so asking
 * for 1000 bonus health yields exactly 1000 — which is what lets the expected
 * damage be a literal.
 */
const BONUS_HEALTH = 1000;

describe('Immolate (Sunfire Aegis, Bami\'s Cinder, Hollow Radiance)', () => {
  it('ticks once a second for three seconds after Vi deals damage', () => {
    const result = harness(effectFor('3068'), { bonusStats: { hp: BONUS_HEALTH } });
    expect(result.stats.bonusHealth).toBe(BONUS_HEALTH);
    result.attack();
    result.advanceTo(6);

    const ticks = result.ticks();
    expect(ticks.map((tick) => tick.time)).toEqual([1, 2, 3]);
    for (const tick of ticks) {
      // Riot's `Items/3068` `mItemCalculations.DamagePerTick`: a flat 20 plus
      // mCoefficient 0.015 on bonus health (mStat 12, mStatFormula 2).
      expect(tick.raw).toBeCloseTo(20 + 0.015 * 1000, 9);
      expect(tick.type).toBe('magic');
    }
    // Three ticks of 35 is the whole aura: `AuraDuration` 3 at `TicksPerSecond` 1.
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(3 * (20 + 0.015 * 1000), 9);
    // The label has to name the tick, not just the item.
    expect(ticks.map((tick) => tick.label)).toEqual([
      'Sunfire Aegis · Immolate tick 1',
      'Sunfire Aegis · Immolate tick 2',
      'Sunfire Aegis · Immolate tick 3',
    ]);
  });

  it('scales Sunfire and Hollow Radiance with bonus health and leaves Bami flat', () => {
    const first = (id: string): number => {
      const result = harness(effectFor(id), { bonusStats: { hp: BONUS_HEALTH } });
      result.attack();
      result.advanceTo(1);
      const [tick] = result.ticks();
      expect(tick).toBeDefined();
      return tick!.raw;
    };

    // Sunfire Aegis: 20 + 1.5% bonus health.
    expect(first('3068')).toBeCloseTo(20 + 0.015 * 1000, 9);
    /*
     * Hollow Radiance: 15 + 1% bonus health, from `Items/6664`'s
     * `DamagePerTick` calculation. Pinned as a literal precisely because the
     * tooltip-only values beside it in the bin say 10 + 1.75% — this assertion
     * is what makes the tie-break burn.ts documents a testable claim rather than
     * a comment, and it fails if the losing pair is ever pasted in.
     */
    expect(first('6664')).toBeCloseTo(15 + 0.01 * 1000, 9);
    expect(first('6664')).not.toBeCloseTo(10 + 0.0175 * 1000, 6);
    // Bami's `DamagePerTick` is a lone NumberCalculationPart of 15: a thousand
    // bonus health must not move it.
    expect(first('6660')).toBeCloseTo(15, 9);
  });

  /*
   * The radius is documentation only — the simulation has no positions, so
   * nothing in the model can check it. It is still Riot's number (`Range` 325 on
   * all three items) and it is still shown to the user, so it is pinned here as
   * a literal: an unread constant cannot drift detectably, and this is the only
   * place a wrong 325 would surface.
   */
  it('tells the user the 325-unit radius it is assuming', () => {
    for (const id of ['3068', '6660', '6664']) {
      expect(effectFor(id).note, id).toContain('325 units');
    }
  });

  it('refreshes on the next hit instead of stacking a second aura', () => {
    const result = harness(effectFor('6660'));
    result.attack();
    result.advanceTo(2.4);
    result.attack();
    result.advanceTo(12);

    const ticks = result.ticks();
    // One continuous aura from 0 to 5.4 s on a one-second cadence: five ticks.
    // Two stacked three-second auras would have produced six, two of them at
    // the same instant.
    expect(ticks.map((tick) => tick.time)).toEqual([1, 2, 3, 4, 5]);
    expect(tickIndices(ticks)).toEqual([1, 2, 3, 4, 5]);
    // Five ticks of Bami's flat 15.
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(5 * 15, 9);
  });

  it('stops when nothing renews it', () => {
    const result = harness(effectFor('3068'));
    result.attack();
    result.advanceTo(60);
    const ticks = result.ticks();
    // `AuraDuration` 3 × `TicksPerSecond` 1.
    expect(ticks).toHaveLength(3);
    expect(Math.max(...ticks.map((tick) => tick.time))).toBe(3);
  });
});

describe("Liandry's Torment", () => {
  it('burns for six ticks of 1% maximum health after ability damage', () => {
    const result = harness(effectFor('6653'));
    result.cast();
    result.advanceTo(6);

    const ticks = result.ticks();
    expect(ticks.map((tick) => tick.time)).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
    expect(tickIndices(ticks)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const tick of ticks) {
      // `BurnPercentHealthDamage` 0.02 per second at `TickFrequency` 0.5 is 1%
      // of the target's 3000 maximum health per tick.
      expect(tick.raw).toBeCloseTo(0.02 * 0.5 * 3000, 9);
    }
    // 2% per second over `BurnDuration` 3, however it is sliced.
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(0.02 * 3 * 3000, 9);
  });

  it('is not applied by a basic attack', () => {
    const result = harness(effectFor('6653'));
    result.attack();
    result.advanceTo(6);
    expect(result.ticks()).toHaveLength(0);
  });

  /*
   * The pet half of Riot's trigger, which Data Dragon's shop text omits: the
   * wiki's "Dealing ability damage or pet damage burns enemies". Scorchclaw's
   * Slash is the instance that exists in this repo — `src/model/petEffects.ts`
   * schedules it as `pet:scorchclaw` / `sourceKind: 'summoner'` / true damage,
   * with no `isAbilityDamage` — and the engine's proc gate lets it through to
   * `onHitLanded`.
   */
  it("burns on a pet's damage, and not on a summoner spell that only looks like one", () => {
    const pet = harness(effectFor('6653'));
    pet.land({ sourceId: 'pet:scorchclaw', sourceKind: 'summoner', type: 'true', raw: 37.5 });
    pet.advanceTo(6);
    expect(pet.ticks().map((tick) => tick.time)).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
    for (const tick of pet.ticks()) expect(tick.raw).toBeCloseTo(0.02 * 0.5 * 3000, 9);

    // Ignite and Smite are `sourceKind: 'summoner'` too and neither is a pet.
    const ignite = harness(effectFor('6653'));
    ignite.land({ sourceId: 'summoner:ignite', sourceKind: 'summoner', type: 'true', raw: 60 });
    ignite.land({ sourceId: 'summoner:SummonerSmite', sourceKind: 'summoner', type: 'true', raw: 20 });
    ignite.advanceTo(6);
    expect(ignite.ticks()).toHaveLength(0);
  });

  it('ramps Suffering by whole seconds in combat, onto its own burn', () => {
    const result = harness(effectFor('6653'));
    const opener = result.cast();
    // The hit that starts the fight has no seconds behind it yet.
    expect(opener.mitigated).toBeCloseTo(opener.raw, 9);

    result.advanceTo(6);
    const base = 0.02 * 0.5 * 3000;
    for (const tick of result.ticks()) {
      // `DamageIncreasePerSecond` 0.02, `DamageIncreaseMax` 0.06.
      const bonus = Math.min(0.06, Math.floor(tick.time) * 0.02);
      expect(tick.amplified).toBeCloseTo(base * (1 + bonus), 9);
    }
    // Spot-check one tick against a fully written-out number: the 3 s tick is
    // 30 damage at the +6% cap.
    const last = result.ticks().at(-1)!;
    expect(last.time).toBe(3);
    expect(last.amplified).toBeCloseTo(30 * 1.06, 9);
  });

  it('caps Suffering at +6% however long the fight runs', () => {
    const result = harness(effectFor('6653'));
    result.cast();
    result.advanceTo(30);
    const late = result.land({ raw: 100 });
    expect(late.mitigated).toBeCloseTo(100 * 1.06, 9);
  });

  /*
   * Both guards `combatRamp` shares with `burnRuntime`. Riot's condition is "in
   * combat with enemy champions": a blocked hit is not combat damage, and a
   * minion is not a champion. Without them the clock starts at the zero-damage
   * hit and the real hit five seconds later arrives already at the cap.
   */
  it('does not start the Suffering clock on a hit that dealt nothing', () => {
    const result = harness(effectFor('6653'));
    result.land({ raw: 0 });
    result.advanceTo(5);
    const real = result.land({ raw: 100 });
    expect(real.mitigated).toBeCloseTo(100, 9);
  });

  it('never ramps Suffering against a target that is not a champion', () => {
    const result = harness(effectFor('6653'), { target: { unitType: 'minion' } });
    result.land({ raw: 100 });
    result.advanceTo(10);
    const late = result.land({ raw: 100 });
    expect(late.mitigated).toBeCloseTo(100, 9);
    expect(result.events).toEqual([]);
  });
});

describe('Blackfire Torch', () => {
  it('burns for half of 20 + 2% AP every half second', () => {
    const result = harness(effectFor('2503'), { bonusStats: { abilityPower: 200 } });
    expect(result.stats.abilityPower).toBe(200);
    result.cast();
    result.advanceTo(6);

    const ticks = result.ticks();
    // `BurnDuration` 3 at `TickFrequency` 0.5.
    expect(ticks).toHaveLength(6);
    expect(tickIndices(ticks)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const tick of ticks) {
      // `BurnFlatDamagePerSecond` 20 + `APRatio` 0.02 × 200 AP = 24 per second,
      // halved by the 0.5 s tick: 12.
      expect(tick.raw).toBeCloseTo((20 + 0.02 * 200) * 0.5, 9);
    }
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo((20 + 0.02 * 200) * 3, 9);
    // 200 ability power is the whole reason this differs from the flat half of 20.
    expect(ticks[0]!.raw).toBeGreaterThan(10);
  });

  it('falls back to the flat half of 20 with no ability power at all', () => {
    const result = harness(effectFor('2503'));
    result.cast();
    result.advanceTo(6);
    // Six ticks of 10 is the 60 that 20 per second over 3 s comes to.
    for (const tick of result.ticks()) expect(tick.raw).toBeCloseTo(10, 9);
    expect(sum(result.ticks(), (tick) => tick.raw)).toBeCloseTo(60, 9);
  });
});

describe('Fated Ashes', () => {
  it('adds up to the 15 total damage Riot states outright', () => {
    const result = harness(effectFor('2508'), { bonusStats: { abilityPower: 500 } });
    result.cast();
    result.advanceTo(6);

    const ticks = result.ticks();
    // `BurnDuration` 3 at `TickFrequency` 0.5.
    expect(ticks).toHaveLength(6);
    // Data Dragon's own resolved text: "deal 15 bonus magic damage over 3
    // seconds", and it does not scale with ability power — 500 AP is here to
    // prove that.
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(15, 9);
    for (const tick of ticks) expect(tick.raw).toBeCloseTo(5 * 0.5, 9);
  });
});

describe('Demonic Embrace', () => {
  it("takes the melee half of Riot's split, four times over four seconds", () => {
    const result = harness(effectFor('4637'));
    result.cast();
    result.advanceTo(8);

    const ticks = result.ticks();
    // `Duration` 4 at `TickRatePerXSeconds` 1.
    expect(ticks.map((tick) => tick.time)).toEqual([1, 2, 3, 4]);
    for (const tick of ticks) {
      // `MeleeMaxHealthDamagePerTick` 0.016 of the target's 3000 maximum health.
      expect(tick.raw).toBeCloseTo(0.016 * 3000, 9);
      // Vi is melee: `RangedMaxHealthDamagePerTick` 0.01 must not be the one in play.
      expect(tick.raw).not.toBeCloseTo(0.01 * 3000, 6);
    }
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(0.016 * 4 * 3000, 9);
  });
});

describe("Zeke's Convergence", () => {
  /*
   * `Items/3050`: `Duration` 5, `DamagePerSecond` 30, `Cooldown` 45. The 0.25 s
   * cadence is the wiki's — Riot's file states no tick frequency — and the wiki
   * states the consequence too, "7.5 magic damage per tick, totaling 150
   * maximum magic damage", which is what is pinned here.
   */
  it('summons twenty ticks of 7.5 on the ultimate, totalling 150', () => {
    const result = harness(effectFor('3050'));
    result.castAbility('R');
    result.advanceTo(10);

    const ticks = result.ticks();
    expect(ticks).toHaveLength(5 / 0.25);
    expect(tickIndices(ticks)).toEqual(
      Array.from({ length: 20 }, (_, position) => position + 1),
    );
    expect(ticks[0]!.time).toBeCloseTo(0.25, 9);
    expect(ticks.at(-1)!.time).toBeCloseTo(5, 9);
    for (const tick of ticks) {
      expect(tick.raw).toBeCloseTo(30 * 0.25, 9);
      expect(tick.type).toBe('magic');
    }
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(150, 9);
    // The 30% slow is on the timeline for the storm's whole duration.
    expect(result.crowdControl).toHaveLength(1);
    expect(result.crowdControl[0]!.durationSeconds).toBe(5);
    expect(result.crowdControl[0]!.label).toContain('30%');
    // `StormRadius` 350, documentation only for the same reason Immolate's 325 is.
    expect(effectFor('3050').note).toContain('350 units');
  });

  it('is armed by the ultimate alone, not by damage and not by Q/W/E', () => {
    const result = harness(effectFor('3050'));
    result.cast();
    result.attack();
    result.castAbility('Q');
    result.castAbility('W');
    result.castAbility('E');
    result.advanceTo(10);
    expect(result.ticks()).toHaveLength(0);
    expect(result.crowdControl).toEqual([]);
  });

  it('holds the storm to one per 45 seconds', () => {
    const result = harness(effectFor('3050'));
    result.castAbility('R');
    result.advanceTo(30);
    // `Cooldown` 45: a second ultimate at 30 s summons nothing.
    result.castAbility('R');
    result.advanceTo(44);
    expect(result.ticks()).toHaveLength(20);

    result.advanceTo(45);
    result.castAbility('R');
    result.advanceTo(60);
    expect(result.ticks()).toHaveLength(40);
    expect(sum(result.ticks(), (tick) => tick.raw)).toBeCloseTo(300, 9);
  });

  it('summons nothing against a target that is not a champion', () => {
    // Data Dragon scopes the damage: "30 magic damage per second to enemy
    // champions".
    const result = harness(effectFor('3050'), { target: { unitType: 'monster' } });
    result.castAbility('R');
    result.advanceTo(10);
    expect(result.ticks()).toHaveLength(0);
  });
});

describe('the family as a whole', () => {
  it('labels every tick of every burn with its own number', () => {
    for (const effect of BURN_ITEMS) {
      const result = harness(effect, { bonusStats: { hp: 800, abilityPower: 120 } });
      result.cast();
      result.attack();
      result.castAbility('R');
      result.advanceTo(20);
      const ticks = result.ticks();
      expect(ticks.length, `${effect.name} produced no damage at all`).toBeGreaterThan(0);
      const indices = tickIndices(ticks);
      expect(indices).toEqual(indices.map((_, position) => position + 1));
      for (const tick of ticks) {
        expect(tick.label.startsWith(`${effect.name} · `)).toBe(true);
        expect(tick.notes.length).toBeGreaterThan(0);
        expect(tick.type).toBe('magic');
        expect(tick.sourceId).toBe(`item:${effect.id}`);
      }
    }
  });

  it('leaves out the items whose damage-over-time this model cannot deal', () => {
    /*
     * The reasoning lives in burn.ts's "Considered and left out" header block,
     * where the next person editing the family will look; this only holds the
     * absences that block claims, so removing the prose without removing the
     * item cannot pass unnoticed.
     */
    for (const id of ['3165', '3075', '6333', '2520']) {
      expect(
        BURN_ITEMS.some((effect) => effect.id === id),
        `${id} is named as left out in burn.ts's header but is registered here`,
      ).toBe(false);
    }
  });
});
