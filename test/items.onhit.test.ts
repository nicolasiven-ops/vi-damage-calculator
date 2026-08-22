import { describe, expect, it } from 'vitest';
import { ONHIT_CONSTANTS, ONHIT_ITEMS } from '../src/model/items/onhit';
import type { DealDamageArgs, SimContext } from '../src/engine/context';
import { type ItemEffect, type ItemRuntime } from '../src/model/itemEffects';
import {
  DEFAULT_TIMINGS,
  type DamageInstance,
  type TargetConfig,
} from '../src/engine/types';
import { resolveChampionStats, sumStats, type ChampionStats, type StatBlock } from '../src/model/stats';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

/**
 * These items live outside the effect registry in `src/model/itemEffects.ts`,
 * so `simulate()` cannot be handed them by id the way `itemMechanics.test.ts`
 * hands it Spear of Shojin. They are driven directly instead, through a context
 * that reproduces the part of the engine they actually touch:
 *
 *  - the attack path of `performAttack` — the attack's own damage first, then
 *    each item's `onBasicAttack` rider as its own instance (simulate.ts:890-980);
 *  - `scheduleDamage`, delivered when the clock passes it, as `advanceTo` does;
 *  - `applyTemporaryStats`, which replaces the stats held under a label rather
 *    than adding to them and keys the label on the text before the ' · ';
 *  - expiry by `expiresAt <= now`, matching the engine's `dropExpired`.
 *
 * Two things it deliberately does not do. It applies no resistances, so every
 * assertion below is on raw damage — mitigation is the engine's own business and
 * is covered in `damage.test.ts` and `simulate.test.ts`. And it does not stop at
 * the kill, which is what lets a test look at the far end of Kraken Slayer's
 * missing-health ramp without arranging a target that survives it.
 *
 * Any hook this family does not use throws rather than silently accepting the
 * call, so an item that grows a new behaviour fails here with an instruction
 * instead of passing on an untested path.
 */

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 0, // set per harness; the item code reads the two health getters
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

interface HarnessOptions {
  level?: number;
  targetMaxHealth?: number;
  /** Target health when the sequence starts, as a fraction of the maximum. */
  targetHealthPercent?: number;
}

interface Harness {
  instances: DamageInstance[];
  warnings: string[];
  attack(): void;
  /** Idle time, which is how a stack window is allowed to run out. */
  wait(seconds: number): void;
  /** Live temporary buffs, newest state first, as the item applied them. */
  buffs(): { label: string; attackSpeed: number }[];
  stats(): ChampionStats;
}

function harness(effect: ItemEffect, options: HarnessOptions = {}): Harness {
  const level = options.level ?? 11;
  const targetMaxHealth = options.targetMaxHealth ?? 1_000_000;
  const runtime: ItemRuntime = effect.createRuntime!();

  let time = 0;
  let nextAttackAt = 0;
  let seq = 0;
  let targetHealth = targetMaxHealth * (options.targetHealthPercent ?? 1);

  const instances: DamageInstance[] = [];
  const warnings: string[] = [];
  const temp: { label: string; stats: Partial<StatBlock>; expiresAt: number }[] = [];
  const scheduled: { at: number; run: () => void }[] = [];

  const unsupported = (hook: string) => (): never => {
    throw new Error(`${hook} is unused by the on-hit family; extend the harness before using it`);
  };

  function live(): { label: string; stats: Partial<StatBlock>; expiresAt: number }[] {
    return temp.filter((entry) => entry.expiresAt > time);
  }

  function currentStats(): ChampionStats {
    return resolveChampionStats(
      FIXTURE_CHAMPION_STATS,
      level,
      sumStats(live().map((entry) => entry.stats)),
    );
  }

  function deal(args: DealDamageArgs): DamageInstance {
    seq += 1;
    targetHealth = Math.max(0, targetHealth - args.amount);
    const instance: DamageInstance = {
      id: `h${seq}`,
      seq,
      time,
      sourceId: args.sourceId,
      sourceLabel: args.sourceLabel,
      sourceKind: args.sourceKind,
      slot: args.slot,
      type: args.type,
      raw: args.amount,
      mitigated: args.amount,
      crit: false,
      targetHpAfter: targetHealth,
      notes: args.notes ?? [],
    };
    instances.push(instance);
    return instance;
  }

  function advanceTo(target: number): void {
    while (scheduled.length > 0) {
      scheduled.sort((a, b) => a.at - b.at);
      const next = scheduled[0]!;
      if (next.at > target) break;
      scheduled.shift();
      time = Math.max(time, next.at);
      next.run();
    }
    time = Math.max(time, target);
  }

  const ctx: SimContext = {
    get time() {
      return time;
    },
    get timings() {
      return DEFAULT_TIMINGS;
    },
    get stats() {
      return currentStats();
    },
    get target() {
      return { ...TARGET, maxHealth: targetMaxHealth };
    },
    get targetMaxHealth() {
      return targetMaxHealth;
    },
    get targetCurrentHealth() {
      return targetHealth;
    },
    rank: () => 0,
    dealDamage: deal,
    scheduleDamage({ afterSeconds, ...damage }) {
      scheduled.push({ at: time + Math.max(0, afterSeconds), run: () => deal(damage) });
    },
    applyTemporaryStats({ stats, durationSeconds, label }) {
      const identity = label.split(' · ')[0];
      const existing = temp.find((entry) => entry.label.split(' · ')[0] === identity);
      if (existing) {
        existing.stats = stats;
        existing.label = label;
        existing.expiresAt = time + durationSeconds;
      } else {
        temp.push({ stats, label, expiresAt: time + durationSeconds });
      }
    },
    applyArmorShred: unsupported('applyArmorShred'),
    grantShield: unsupported('grantShield'),
    clearTemporaryStats: unsupported('clearTemporaryStats'),
    applyTargetAmplification: unsupported('applyTargetAmplification'),
    applyCrowdControl: unsupported('applyCrowdControl'),
    addEvent: unsupported('addEvent'),
    warn(message) {
      if (!warnings.includes(message)) warnings.push(message);
    },
  };

  return {
    instances,
    warnings,
    attack() {
      advanceTo(Math.max(time, nextAttackAt));
      deal({
        sourceId: 'AA',
        sourceLabel: 'Basic attack',
        sourceKind: 'attack',
        type: 'physical',
        amount: currentStats().totalAttackDamage,
      });
      const rider = runtime.onBasicAttack?.(ctx) ?? null;
      if (rider && rider.amount > 0) {
        deal({
          sourceId: `item:${effect.id}`,
          sourceLabel: rider.label,
          sourceKind: 'item',
          type: rider.type,
          amount: rider.amount,
          notes: rider.notes,
        });
      }
      /*
       * One full cycle at the attack speed the attack left behind. The engine
       * rescales only the part of the cycle still ahead, which shifts a timer by
       * a fraction of a wind-up; nothing here depends on that, and every stack
       * window in this family is seconds wide.
       */
      nextAttackAt = time + 1 / Math.max(0.1, currentStats().totalAttackSpeed);
    },
    wait(seconds) {
      advanceTo(time + Math.max(0, seconds));
    },
    buffs() {
      return live().map((entry) => ({
        label: entry.label,
        attackSpeed: entry.stats.attackSpeed ?? 0,
      }));
    },
    stats: currentStats,
  };
}

function item(id: string): ItemEffect {
  const found = ONHIT_ITEMS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id} in ONHIT_ITEMS`);
  return found;
}

const ridersOf = (result: Harness, label: string): DamageInstance[] =>
  result.instances.filter((entry) => entry.sourceLabel === label);

const attacksOf = (result: Harness): DamageInstance[] =>
  result.instances.filter((entry) => entry.sourceKind === 'attack');

/* ------------------------------------------------------------------- the family */

describe('the on-hit family', () => {
  /**
   * The behavioural tests below derive their expected damage from
   * `ONHIT_CONSTANTS`, so that the formula is written once. That makes this test
   * the one place where the constants themselves are held against their source:
   * every number here was read out of Riot's data, and a patch that moves one
   * has to fail here rather than quietly agree with itself everywhere else.
   */
  it('carries the numbers Riot ships', () => {
    // Data Dragon prints these two as resolved text.
    expect(ONHIT_CONSTANTS.recurveBow.onHitDamage).toBe(15); // "15 bonus physical damage"
    expect(ONHIT_CONSTANTS.guinsoo.wrathDamage).toBe(30); // "30 bonus magic damage"

    // `Items/6677`: OnHitDamage 20, AttackSpeedPerStack 0.05, MaxStacks 3, BuffDuration 3.
    expect(ONHIT_CONSTANTS.rageknife).toMatchObject({
      wrathDamage: 20,
      attackSpeedPerStack: 0.05,
      maxStacks: 3,
      stackSeconds: 3,
    });

    // `Items/3124`: OnHitDamage 30, AttackSpeedPerStack 0.08, MaxStacks 4, BuffDuration 3.
    // The phantom values are the wiki's — 2 stacks, 6 s, 0.15 s of delay.
    expect(ONHIT_CONSTANTS.guinsoo).toMatchObject({
      attackSpeedPerStack: 0.08,
      maxStacks: 4,
      stackSeconds: 3,
      phantomStacks: 2,
      phantomStackSeconds: 6,
      phantomDelaySeconds: 0.15,
    });

    // `Items/6672`: AttackCount 3, BuffDuration 4, MaxAmpNumber 1.75, and a
    // DamageAmount of 150 at level 1 with a level-9 breakpoint worth 5.
    expect(ONHIT_CONSTANTS.kraken).toMatchObject({
      attackCount: 3,
      stackSeconds: 4,
      baseAtLevel1: 150,
      breakpointLevel: 9,
      bonusPerLevelFromBreakpoint: 5,
      maxMissingHealthMultiplier: 1.75,
    });
  });

  it('is a set of basic-attack riders and nothing else', () => {
    expect(ONHIT_ITEMS.length).toBeGreaterThan(0);
    for (const entry of ONHIT_ITEMS) {
      expect(entry.modelled).toBe(true);
      expect(entry.note.length).toBeGreaterThan(20);
      const runtime = entry.createRuntime!();
      expect(runtime.onBasicAttack).toBeDefined();
      /*
       * The harness above drives the attack path only. That is sound exactly as
       * long as nothing here reacts elsewhere, so the claim is a test rather
       * than a comment.
       */
      expect(runtime.onHitLanded).toBeUndefined();
      expect(runtime.onAbilityCast).toBeUndefined();
      expect(runtime.amplify).toBeUndefined();
      expect(entry.amplify).toBeUndefined();
    }
    const ids = ONHIT_ITEMS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* --------------------------------------------------------------- Recurve Bow */

describe('Recurve Bow · Sting', () => {
  it('adds its flat damage to every attack, with no cooldown between them', () => {
    const result = harness(item('1043'));
    result.attack();
    result.attack();
    result.attack();

    const stings = ridersOf(result, 'Recurve Bow · Sting');
    expect(stings).toHaveLength(3);
    for (const sting of stings) {
      expect(sting.raw).toBeCloseTo(ONHIT_CONSTANTS.recurveBow.onHitDamage, 10);
      expect(sting.type).toBe('physical');
    }
    // Each rider lands with the attack that carried it, not on its own timer.
    expect(stings.map((entry) => entry.time)).toEqual(attacksOf(result).map((entry) => entry.time));
  });
});

/* ----------------------------------------------------------------- Rageknife */

describe('Rageknife · Wrath and Seething Strike', () => {
  const { wrathDamage, attackSpeedPerStack, maxStacks, stackSeconds } = ONHIT_CONSTANTS.rageknife;

  it('deals its magic damage on every attack', () => {
    const result = harness(item('6677'));
    result.attack();
    result.attack();

    const wrath = ridersOf(result, 'Rageknife · Wrath');
    expect(wrath).toHaveLength(2);
    expect(wrath[0]!.raw).toBeCloseTo(wrathDamage, 10);
    expect(wrath[0]!.type).toBe('magic');
  });

  it('stacks attack speed up to its maximum and no further', () => {
    const result = harness(item('6677'));
    const seen: number[] = [];
    for (let index = 0; index < maxStacks + 2; index += 1) {
      result.attack();
      seen.push(result.buffs()[0]?.attackSpeed ?? 0);
    }

    expect(seen.slice(0, maxStacks)).toEqual(
      Array.from({ length: maxStacks }, (_, index) => attackSpeedPerStack * (index + 1)),
    );
    // Two attacks past the cap change nothing but the window they sit in.
    expect(seen[maxStacks]).toBeCloseTo(attackSpeedPerStack * maxStacks, 10);
    expect(seen[maxStacks + 1]).toBeCloseTo(attackSpeedPerStack * maxStacks, 10);
    expect(result.buffs()[0]!.label).toContain(`${maxStacks}/${maxStacks}`);
  });

  it('drops the stacks when the window runs out, and rebuilds from one', () => {
    const result = harness(item('6677'));
    result.attack();
    result.attack();
    expect(result.buffs()[0]!.attackSpeed).toBeCloseTo(attackSpeedPerStack * 2, 10);

    result.wait(stackSeconds + 1);
    expect(result.buffs()).toHaveLength(0);

    result.attack();
    expect(result.buffs()[0]!.attackSpeed).toBeCloseTo(attackSpeedPerStack, 10);
    expect(result.buffs()[0]!.label).toContain(`1/${maxStacks}`);
  });

  it('never produces a phantom hit, however long the sequence runs', () => {
    const result = harness(item('6677'));
    for (let index = 0; index < 12; index += 1) result.attack();
    result.wait(1);

    expect(result.instances.some((entry) => entry.sourceLabel.includes('Phantom'))).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

/* --------------------------------------------------------- Guinsoo's Rageblade */

describe("Guinsoo's Rageblade · Wrath, Seething Strike and the Phantom Hit", () => {
  const guinsoo = ONHIT_CONSTANTS.guinsoo;
  const WRATH = "Guinsoo's Rageblade · Wrath";
  const PHANTOM = "Guinsoo's Rageblade · Phantom Hit";

  it('deals its magic damage on every attack', () => {
    const result = harness(item('3124'));
    result.attack();
    result.attack();

    const wrath = ridersOf(result, WRATH);
    expect(wrath).toHaveLength(2);
    expect(wrath[0]!.raw).toBeCloseTo(guinsoo.wrathDamage, 10);
    expect(wrath[0]!.type).toBe('magic');
  });

  it('stacks attack speed per attack, which shortens the attacks that follow', () => {
    const result = harness(item('3124'));
    for (let index = 0; index < guinsoo.maxStacks + 2; index += 1) result.attack();

    expect(result.buffs()[0]!.attackSpeed).toBeCloseTo(
      guinsoo.attackSpeedPerStack * guinsoo.maxStacks,
      10,
    );

    // The buff is not a number in a table: each gap is shorter than the one
    // before it until the stacks cap out, and equal from then on.
    const times = attacksOf(result).map((entry) => entry.time);
    const gaps = times.slice(1).map((value, index) => value - times[index]!);
    for (let index = 1; index < guinsoo.maxStacks - 1; index += 1) {
      expect(gaps[index]!).toBeLessThan(gaps[index - 1]!);
    }
    expect(gaps[gaps.length - 1]!).toBeCloseTo(gaps[guinsoo.maxStacks - 1]!, 10);
  });

  /**
   * Data Dragon's rule is "while fully stacked, every third Attack applies
   * On-Hit effects twice". With four Seething stacks earned on the first four
   * attacks and two phantom stacks needed after that, the first repeat is the
   * sixth attack and the second is the ninth.
   */
  it('repeats its own on-hit on every third attack once fully stacked', () => {
    const result = harness(item('3124'));
    for (let index = 0; index < 9; index += 1) result.attack();
    // The repeat is scheduled, so the clock has to reach it.
    result.wait(guinsoo.phantomDelaySeconds * 2);

    const phantoms = ridersOf(result, PHANTOM);
    const attacks = attacksOf(result);
    expect(phantoms).toHaveLength(2);
    expect(phantoms[0]!.raw).toBeCloseTo(guinsoo.wrathDamage, 10);
    expect(phantoms[0]!.type).toBe('magic');
    expect(phantoms[0]!.time).toBeCloseTo(attacks[5]!.time + guinsoo.phantomDelaySeconds, 10);
    expect(phantoms[1]!.time).toBeCloseTo(attacks[8]!.time + guinsoo.phantomDelaySeconds, 10);

    // Nine attacks: nine Wrath riders plus the two repeats.
    expect(ridersOf(result, WRATH)).toHaveLength(9);
  });

  it('produces no repeat before the stacks are full', () => {
    const result = harness(item('3124'));
    for (let index = 0; index < 5; index += 1) result.attack();
    result.wait(1);

    expect(ridersOf(result, PHANTOM)).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });

  /**
   * The half that is not modelled has to be said out loud: a Phantom Hit
   * re-applies every on-hit effect in the build, and one item cannot re-trigger
   * another item's rider. The warning is the only thing standing between that
   * and a silent under-count.
   */
  it('warns that only its own on-hit is repeated', () => {
    const result = harness(item('3124'));
    for (let index = 0; index < 6; index += 1) result.attack();
    result.wait(1);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Phantom Hit');
    expect(result.warnings[0]).toContain('on-hit');
  });
});

/* -------------------------------------------------------------- Kraken Slayer */

describe('Kraken Slayer · Bring It Down', () => {
  const kraken = ONHIT_CONSTANTS.kraken;
  const PROC = 'Kraken Slayer · Bring It Down';

  /** The base damage Riot's item bin describes, at three telling levels. */
  const BASE_BY_LEVEL: [level: number, damage: number][] = [
    // 150 up to the level-9 breakpoint …
    [8, 150],
    // … then +5 for each level from there on …
    [9, 155],
    // … which lands on 200 at 18, not the wiki's 210.
    [18, 200],
  ];

  it('procs on every third attack and on no other', () => {
    const result = harness(item('6672'));
    for (let index = 0; index < 6; index += 1) result.attack();

    const procs = result.instances.filter((entry) => entry.sourceLabel === PROC);
    const attacks = attacksOf(result);
    expect(procs).toHaveLength(2);
    expect(procs[0]!.time).toBeCloseTo(attacks[2]!.time, 10);
    expect(procs[1]!.time).toBeCloseTo(attacks[5]!.time, 10);
    expect(procs[0]!.type).toBe('physical');
  });

  it.each(BASE_BY_LEVEL)('deals %i-level base damage of %i against a full-health target', (level, expected) => {
    // A target this large is still all but untouched by three attacks, so the
    // missing-health ramp contributes nothing measurable and the base shows.
    const result = harness(item('6672'), { level, targetMaxHealth: 1_000_000_000 });
    result.attack();
    result.attack();
    result.attack();

    const proc = result.instances.find((entry) => entry.sourceLabel === PROC);
    expect(proc).toBeDefined();
    expect(proc!.raw).toBeCloseTo(expected, 3);
  });

  it('starts its level table at the value Riot ships as the level-1 damage', () => {
    // Ties the table above to the constant the runtime reads, so a patch that
    // moves one of them cannot leave the other standing.
    expect(BASE_BY_LEVEL[0]![1]).toBe(kraken.baseAtLevel1);
    expect(BASE_BY_LEVEL[1]![1]).toBe(
      kraken.baseAtLevel1 + kraken.bonusPerLevelFromBreakpoint,
    );
    expect(BASE_BY_LEVEL[1]![0]).toBe(kraken.breakpointLevel);
  });

  it('scales linearly with the missing health, up to Riot maximum multiplier', () => {
    const base = 150 + kraken.bonusPerLevelFromBreakpoint * (11 - (kraken.breakpointLevel - 1));

    const threeAttacks = (percent: number) => {
      const result = harness(item('6672'), {
        level: 11,
        targetMaxHealth: 1_000_000_000,
        targetHealthPercent: percent,
      });
      result.attack();
      result.attack();
      result.attack();
      return result.instances.find((entry) => entry.sourceLabel === PROC)!.raw;
    };

    const span = kraken.maxMissingHealthMultiplier - 1;
    // A fifth of the health left is four fifths missing: four fifths of the ramp.
    expect(threeAttacks(0.2)).toBeCloseTo(base * (1 + span * 0.8), 2);
    // Half missing is half the ramp — the linear reading, stated as a check.
    expect(threeAttacks(0.5)).toBeCloseTo(base * (1 + span * 0.5), 2);
    // And at the bottom it reaches exactly Riot's MaxAmpNumber, no further.
    expect(threeAttacks(0.000001)).toBeCloseTo(base * kraken.maxMissingHealthMultiplier, 2);
  });

  it('forgets the attack count when the window runs out', () => {
    const result = harness(item('6672'));
    result.attack();
    result.attack();
    // Longer than the stack window: those two attacks no longer count.
    result.wait(kraken.stackSeconds + 1);
    result.attack();
    expect(result.instances.filter((entry) => entry.sourceLabel === PROC)).toHaveLength(0);

    // Counting starts over, so the proc comes two attacks later.
    result.attack();
    result.attack();
    expect(result.instances.filter((entry) => entry.sourceLabel === PROC)).toHaveLength(1);
  });
});

/* ----------------------------------------------------- the family's omissions */

describe('what the on-hit family deliberately leaves out', () => {
  /**
   * An item can be absent for two reasons, and only one of them is acceptable:
   * because it was decided against, or because it was forgotten. This is where
   * the decisions are written down, so a later patch that adds one of these ids
   * has to come past a failing test and a stated reason.
   */
  const OMITTED: [id: string, name: string, reason: string][] = [
    // Riot ships 20 AD and 20% attack speed and no passive block at all; the
    // bin entry has no data values, no calculations and no spell.
    ['3051', 'Hearthbound Axe', 'stat-only'],
    ['3006', "Berserker's Greaves", 'stat-only'],
    // Cleave hits "other enemies ... centered around the target" — never the
    // target itself, so it is worth nothing against one enemy. The actives do
    // hit it, and no hook exists by which an item active could be pressed.
    ['3077', 'Tiamat', 'cleave misses the only target; active has no hook'],
    ['3074', 'Ravenous Hydra', 'cleave misses the only target; active has no hook'],
    ['6631', 'Stridebreaker', 'cleave misses the only target; active has no hook'],
    ['3085', "Runaan's Hurricane", 'bolts go to additional enemies only'],
    // Terminus is an on-hit item modelled in ./penetration, where its
    // Juxtaposition penetration stacks are. Entering it here as well would
    // double its Shadow damage for any build that owns it.
    ['3302', 'Terminus', 'modelled in the penetration family'],
  ];

  it.each(OMITTED)('has no entry for %s (%s): %s', (id) => {
    expect(ONHIT_ITEMS.some((entry) => entry.id === id)).toBe(false);
  });


  it('declares no static stats, because every stat here is conditional', () => {
    /*
     * Seething Strike's attack speed is earned per attack and expires, so it is
     * applied through `applyTemporaryStats` at the moment it is earned. An
     * `ItemEffect.stats` block is added to the item's parsed stat line instead
     * and would grant it permanently, from the first second of the combo.
     */
    for (const entry of ONHIT_ITEMS) {
      expect(entry.stats, entry.name).toBeUndefined();
    }
  });
});
