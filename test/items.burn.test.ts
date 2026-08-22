import { describe, expect, it } from 'vitest';
import { BURN_ITEMS, BURN_VALUES } from '../src/model/items/burn';
import { type AmplifiableHit, type ItemEffect, type ItemRuntime } from '../src/model/itemEffects';
import type { DealDamageArgs, SimContext } from '../src/engine/context';
import type { HitInfo } from '../src/model/runes';
import { DEFAULT_TIMINGS, type DamageInstance, type DamageType, type TargetConfig } from '../src/engine/types';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

/**
 * These items are not registered in `itemEffects.ts`, so `simulate()` cannot be
 * handed their ids the way `itemMechanics.test.ts` does. The runtimes are
 * therefore driven against a stand-in context that reproduces the parts of the
 * engine's contract this family depends on, and nothing else:
 *
 *  - `scheduleDamage` queues; the clock delivers in time order, which is what
 *    makes a burn's cadence observable at all.
 *  - amplifiers run before the hit they scale, and stack multiplicatively, in
 *    the same order `applyDamage` uses.
 *  - damage the item itself deals never re-triggers `onHitLanded`. That is the
 *    engine's rule (`sourceKind === 'item'` is excluded), and Immolate leans on
 *    it: its own tick is damage dealt, and re-arming on it would make a
 *    three-second aura permanent.
 *
 * Every hook the family must *not* need throws instead of returning, so a burn
 * that starts reaching for shreds or temporary stats fails loudly here.
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
    grantShield: unused('grantShield'),
    applyTemporaryStats: unused('applyTemporaryStats'),
    clearTemporaryStats: unused('clearTemporaryStats'),
    applyTargetAmplification: unused('applyTargetAmplification'),
    applyCrowdControl: unused('applyCrowdControl'),
  };

  /** One hit of Vi's own damage, reported to the item the way the engine does. */
  function land(options: { raw?: number; isAbilityDamage?: boolean } = {}): DamageInstance {
    const ability = options.isAbilityDamage ?? false;
    const instance = record({
      sourceId: ability ? 'ability:Q' : 'attack',
      sourceLabel: ability ? 'Vault Breaker' : 'Basic attack',
      sourceKind: ability ? 'ability' : 'attack',
      type: 'physical',
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
    land,
    attack: () => land(),
    cast: () => land({ isAbilityDamage: true }),
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

describe('Immolate (Sunfire Aegis, Bami\'s Cinder, Hollow Radiance)', () => {
  it('ticks once a second for three seconds after Vi deals damage', () => {
    const result = harness(effectFor('3068'), { bonusStats: { hp: 1000 } });
    result.attack();
    result.advanceTo(6);

    const ticks = result.ticks();
    const perTick =
      BURN_VALUES.sunfire.flatPerTick +
      BURN_VALUES.sunfire.bonusHealthRatioPerTick * result.stats.bonusHealth;

    expect(ticks.map((tick) => tick.time)).toEqual([1, 2, 3]);
    for (const tick of ticks) {
      expect(tick.raw).toBeCloseTo(perTick, 9);
      expect(tick.type).toBe('magic');
    }
    // The label has to name the tick, not just the item.
    expect(ticks.map((tick) => tick.label)).toEqual([
      'Sunfire Aegis · Immolate tick 1',
      'Sunfire Aegis · Immolate tick 2',
      'Sunfire Aegis · Immolate tick 3',
    ]);
  });

  it('scales Sunfire and Hollow Radiance with bonus health and leaves Bami flat', () => {
    const bonusStats = { hp: 1000 };
    const first = (id: string): number => {
      const result = harness(effectFor(id), { bonusStats });
      result.attack();
      result.advanceTo(1);
      const [tick] = result.ticks();
      expect(tick).toBeDefined();
      return tick!.raw;
    };
    const bonusHealth = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, {
      ...emptyStats(),
      ...bonusStats,
    }).bonusHealth;

    expect(first('3068')).toBeCloseTo(
      BURN_VALUES.sunfire.flatPerTick +
        BURN_VALUES.sunfire.bonusHealthRatioPerTick * bonusHealth,
      9,
    );
    expect(first('6664')).toBeCloseTo(
      BURN_VALUES.hollowRadiance.flatPerTick +
        BURN_VALUES.hollowRadiance.bonusHealthRatioPerTick * bonusHealth,
      9,
    );
    // Bami's has no health scaling at all: a thousand bonus health must not move it.
    expect(first('6660')).toBeCloseTo(BURN_VALUES.bamisCinder.flatPerTick, 9);
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
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(5 * BURN_VALUES.bamisCinder.flatPerTick, 9);
  });

  it('stops when nothing renews it', () => {
    const result = harness(effectFor('3068'));
    result.attack();
    result.advanceTo(60);
    const ticks = result.ticks();
    expect(ticks).toHaveLength(
      BURN_VALUES.immolate.auraDurationSeconds * BURN_VALUES.immolate.ticksPerSecond,
    );
    expect(Math.max(...ticks.map((tick) => tick.time))).toBe(
      BURN_VALUES.immolate.auraDurationSeconds,
    );
  });
});

describe("Liandry's Torment", () => {
  const values = BURN_VALUES.liandrysTorment;
  const perTickShare = values.maxHealthPerSecond * values.tickFrequencySeconds;

  it('burns for six ticks of 1% maximum health after ability damage', () => {
    const result = harness(effectFor('6653'));
    result.cast();
    result.advanceTo(6);

    const ticks = result.ticks();
    expect(ticks.map((tick) => tick.time)).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
    expect(tickIndices(ticks)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const tick of ticks) {
      expect(tick.raw).toBeCloseTo(perTickShare * result.target.maxHealth, 9);
    }
    // 2% per second for three seconds, however it is sliced.
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(
      values.maxHealthPerSecond * values.burnDurationSeconds * result.target.maxHealth,
      9,
    );
  });

  it('is not applied by a basic attack', () => {
    const result = harness(effectFor('6653'));
    result.attack();
    result.advanceTo(6);
    expect(result.ticks()).toHaveLength(0);
  });

  it('ramps Suffering by whole seconds in combat, onto its own burn', () => {
    const result = harness(effectFor('6653'));
    const opener = result.cast();
    // The hit that starts the fight has no seconds behind it yet.
    expect(opener.mitigated).toBeCloseTo(opener.raw, 9);

    result.advanceTo(6);
    const base = perTickShare * result.target.maxHealth;
    for (const tick of result.ticks()) {
      const bonus = Math.min(
        values.damageIncreaseMax,
        Math.floor(tick.time) * values.damageIncreasePerSecond,
      );
      expect(tick.amplified).toBeCloseTo(base * (1 + bonus), 9);
    }
  });

  it('caps Suffering at +6% however long the fight runs', () => {
    const result = harness(effectFor('6653'));
    result.cast();
    result.advanceTo(30);
    const late = result.land({ raw: 100 });
    expect(late.mitigated).toBeCloseTo(100 * (1 + values.damageIncreaseMax), 9);
  });
});

describe('Blackfire Torch', () => {
  it('burns for half of 20 + 2% AP every half second', () => {
    const values = BURN_VALUES.blackfireTorch;
    const result = harness(effectFor('2503'), { bonusStats: { abilityPower: 200 } });
    result.cast();
    result.advanceTo(6);

    const ticks = result.ticks();
    const perTick =
      (values.flatPerSecond + values.apRatioPerSecond * result.stats.abilityPower) *
      values.tickFrequencySeconds;

    expect(ticks).toHaveLength(values.burnDurationSeconds / values.tickFrequencySeconds);
    expect(tickIndices(ticks)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const tick of ticks) expect(tick.raw).toBeCloseTo(perTick, 9);
    // 200 ability power is the whole reason this differs from the flat 10.
    expect(perTick).toBeGreaterThan(values.flatPerSecond * values.tickFrequencySeconds);
  });
});

describe('Fated Ashes', () => {
  it('adds up to the 15 total damage Riot states outright', () => {
    const values = BURN_VALUES.fatedAshes;
    const result = harness(effectFor('2508'), { bonusStats: { abilityPower: 500 } });
    result.cast();
    result.advanceTo(6);

    const ticks = result.ticks();
    expect(ticks).toHaveLength(values.burnDurationSeconds / values.tickFrequencySeconds);
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(
      values.flatPerSecond * values.burnDurationSeconds,
      9,
    );
    // Data Dragon's own resolved text: "deal 15 bonus magic damage over 3
    // seconds", and it does not scale with ability power.
    expect(sum(ticks, (tick) => tick.raw)).toBeCloseTo(15, 9);
  });
});

describe('Demonic Embrace', () => {
  it("takes the melee half of Riot's split, four times over four seconds", () => {
    const values = BURN_VALUES.demonicEmbrace;
    const result = harness(effectFor('4637'));
    result.cast();
    result.advanceTo(8);

    const ticks = result.ticks();
    expect(ticks.map((tick) => tick.time)).toEqual([1, 2, 3, 4]);
    for (const tick of ticks) {
      expect(tick.raw).toBeCloseTo(values.meleeMaxHealthPerTick * result.target.maxHealth, 9);
      // Vi is melee: the ranged number must not be the one in play.
      expect(tick.raw).not.toBeCloseTo(values.rangedMaxHealthPerTick * result.target.maxHealth, 6);
    }
  });
});

describe('the family as a whole', () => {
  it('labels every tick of every burn with its own number', () => {
    for (const effect of BURN_ITEMS) {
      const result = harness(effect, { bonusStats: { hp: 800, abilityPower: 120 } });
      result.cast();
      result.attack();
      result.advanceTo(20);
      const ticks = result.ticks();
      const indices = tickIndices(ticks);
      expect(indices).toEqual(indices.map((_, position) => position + 1));
      for (const tick of ticks) {
        expect(tick.label.startsWith(`${effect.name} · `)).toBe(true);
        expect(tick.notes.length).toBeGreaterThan(0);
      }
    }
  });


  it('leaves out the two items whose passive is not attacker damage', () => {
    // Morellonomicon's Grievous Wounds is healing reduction, and Thornmail
    // damages whoever hit Vi — neither is damage this model can deal.
    expect(BURN_ITEMS.some((effect) => effect.id === '3165')).toBe(false);
    expect(BURN_ITEMS.some((effect) => effect.id === '3075')).toBe(false);
  });
});
