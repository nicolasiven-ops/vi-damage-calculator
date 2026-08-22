import { describe, expect, it } from 'vitest';
import { ONHIT_CONSTANTS, ONHIT_ITEMS } from '../src/model/items/onhit';
import type { DealDamageArgs, SimContext } from '../src/engine/context';
import { hasModelledEffect, type ItemEffect, type ItemRuntime } from '../src/model/itemEffects';
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
 * It does not read the item's own stat line either — that is the description
 * parser's job in the app, not this file's — so a test whose *timing* depends on
 * the item being worn passes the item's printed attack speed in through
 * `bonusStats`. Guinsoo's is the case that needs it: with per-stack stack timers
 * the fourth Seething stack only exists if attacks land inside 3 s of each
 * other, and a champion who is not wearing the item's 25% attack speed does not
 * get there.
 *
 * Any hook this family does not use throws rather than silently accepting the
 * call, so an item that grows a new behaviour fails here with an instruction
 * instead of passing on an untested path.
 *
 * Expected damage is written as arithmetic on Riot's own literals with the
 * source named, not as the constant the runtime reads. A test that restates
 * `ONHIT_CONSTANTS` agrees with a wrong constant; `150 + 5 * (11 - 8)` does not.
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
  /**
   * Permanent bonus stats the build carries, as the app's parsed item stat line
   * would supply them. Only attack speed matters here, and only for its effect
   * on the attack cadence.
   */
  bonusStats?: Partial<StatBlock>;
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
      sumStats([options.bonusStats ?? {}, ...live().map((entry) => entry.stats)]),
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
    get attackerMaxHealth() {
      return currentStats().maxHealth;
    },
    get attackerCurrentHealth() {
      return currentStats().maxHealth;
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
    applyMagicResistShred: unsupported('applyMagicResistShred'),
    reduceBasicCooldowns: unsupported('reduceBasicCooldowns'),
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

  /**
   * The array is only worth anything if the registry spreads it, which is the
   * difference between "modelled" and "written down in a file nobody imports".
   * `itemEffects.ts` does spread it now, so this holds the wiring in place: the
   * app reports these four as modelled and `simulate()` can hand them a runtime.
   */
  it('reaches the registry, so simulate() can actually run these items', () => {
    for (const entry of ONHIT_ITEMS) {
      expect(hasModelledEffect(entry.id), `${entry.name} (${entry.id})`).toBe(true);
    }
    expect(ONHIT_ITEMS.map((entry) => entry.id)).toEqual(['1043', '6677', '3124', '6672']);
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
      // Data Dragon 16.16.1, item 1043: "Attacks deal 15 bonus physical damage
      // On-Hit." Riot's own resolved number, written here as the literal so a
      // wrong constant in the module cannot agree with itself.
      expect(sting.raw).toBeCloseTo(15, 10);
      expect(sting.type).toBe('physical');
    }
    // Each rider lands with the attack that carried it, not on its own timer.
    expect(stings.map((entry) => entry.time)).toEqual(attacksOf(result).map((entry) => entry.time));
  });
});

/* ----------------------------------------------------------------- Rageknife */

describe('Rageknife · Wrath and Seething Strike', () => {
  const { attackSpeedPerStack, maxStacks, stackSeconds } = ONHIT_CONSTANTS.rageknife;

  it('deals its magic damage on every attack', () => {
    const result = harness(item('6677'));
    result.attack();
    result.attack();

    const wrath = ridersOf(result, 'Rageknife · Wrath');
    expect(wrath).toHaveLength(2);
    // Data Dragon 16.16.1, item 6677: "Wrath: Attacks apply 20 magic damage
    // On-Hit", and `Items/6677` in the bin agrees (OnHitDamage 20).
    expect(wrath[0]!.raw).toBeCloseTo(20, 10);
    expect(wrath[0]!.type).toBe('magic');
  });

  it('stacks attack speed up to its maximum and no further', () => {
    const result = harness(item('6677'));
    const seen: number[] = [];
    for (let index = 0; index < maxStacks + 2; index += 1) {
      result.attack();
      seen.push(result.buffs()[0]?.attackSpeed ?? 0);
    }

    /*
     * Riot's literals, not the module's constants: Data Dragon says "Seething
     * Strike: Basic attacks grant 5% Attack Speed, stacking up to 3 times", and
     * `Items/6677` carries AttackSpeedPerStack 0.05 with MaxStacks 3. Three
     * attacks inside the 3 s window therefore read 5%, 10%, 15%.
     */
    expect(seen.slice(0, 3).map((value) => Number(value.toFixed(10)))).toEqual([0.05, 0.1, 0.15]);
    // Two attacks past the cap change nothing but the windows the stacks sit in.
    expect(seen[maxStacks]).toBeCloseTo(0.05 * 3, 10);
    expect(seen[maxStacks + 1]).toBeCloseTo(0.05 * 3, 10);
    expect(result.buffs()[0]!.label).toContain('3/3');
  });

  /**
   * Every stack has its own timer, which is what Riot's wording says: "Basic
   * attacks grant 5% bonus attack speed for 3 seconds, stacking up to 3 times"
   * (wiki, verbatim) — a stack lasts 3 seconds from the attack that granted it,
   * with no refresh clause of the kind the wiki does spell out where one applies
   * (Vi's Denting Blows: "refreshing on subsequent applications").
   *
   * A single window pushed out by every attack would be indistinguishable in a
   * fast sequence and wrong here: attacking every 2.5 s, it would climb to 3/3
   * and stay, while each stack's own 3 s timer only ever leaves two alive.
   */
  it('gives each stack its own timer, so gaps just inside the window still cap it below the maximum', () => {
    const result = harness(item('6677'));
    const gap = stackSeconds - 0.5; // 2.5 s: inside the window, so nothing is a clean reset.
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) result.wait(gap);
      result.attack();
    }

    // Two live stacks, forever: the oldest lapses exactly as the newest arrives.
    expect(result.buffs()[0]!.label).toContain('2/3');
    expect(result.buffs()[0]!.attackSpeed).toBeCloseTo(0.05 * 2, 10);
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

  /**
   * A build that is actually wearing the thing.
   *
   * Data Dragon 16.16.1 prints 30 AD, 30 AP and "25% Attack Speed" for item
   * 3124; only the attack speed changes any timing here, so only that is passed
   * in. It has to be, now that each Seething stack carries its own 3 s timer:
   * holding four of them needs three attacks inside 3 s, and the fixture
   * champion without the item's own attack speed does not manage it. Level 18
   * rather than the file's default 11 for the same reason — it buys margin, and
   * no number in this describe block depends on level.
   */
  const WORN = { level: 18, bonusStats: { attackSpeed: 0.25 } };

  it('deals its magic damage on every attack', () => {
    const result = harness(item('3124'), WORN);
    result.attack();
    result.attack();

    const wrath = ridersOf(result, WRATH);
    expect(wrath).toHaveLength(2);
    // Data Dragon 16.16.1, item 3124: "Attacks deal 30 bonus magic damage
    // On-Hit"; `Items/3124` carries the same OnHitDamage 30.
    expect(wrath[0]!.raw).toBeCloseTo(30, 10);
    expect(wrath[0]!.type).toBe('magic');
  });

  it('stacks attack speed per attack, which shortens the attacks that follow', () => {
    const result = harness(item('3124'), WORN);
    for (let index = 0; index < guinsoo.maxStacks + 2; index += 1) result.attack();

    // Data Dragon: "Attacks grant 8% Attack Speed for 3 seconds. (stacks 4
    // times)" — so the ceiling is 0.08 × 4, written out rather than read back
    // from the module's own constants.
    expect(result.buffs()[0]!.attackSpeed).toBeCloseTo(0.08 * 4, 10);
    expect(result.buffs()[0]!.label).toContain('4/4');

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
    const result = harness(item('3124'), WORN);
    for (let index = 0; index < 9; index += 1) result.attack();
    // The repeat is scheduled, so the clock has to reach it.
    result.wait(guinsoo.phantomDelaySeconds * 2);

    const phantoms = ridersOf(result, PHANTOM);
    const attacks = attacksOf(result);
    expect(phantoms).toHaveLength(2);
    // The repeat is the same Wrath instance again: Data Dragon's 30.
    expect(phantoms[0]!.raw).toBeCloseTo(30, 10);
    expect(phantoms[0]!.type).toBe('magic');
    expect(phantoms[0]!.time).toBeCloseTo(attacks[5]!.time + guinsoo.phantomDelaySeconds, 10);
    expect(phantoms[1]!.time).toBeCloseTo(attacks[8]!.time + guinsoo.phantomDelaySeconds, 10);

    // Nine attacks: nine Wrath riders plus the two repeats.
    expect(ridersOf(result, WRATH)).toHaveLength(9);
  });

  it('produces no repeat before the stacks are full', () => {
    const result = harness(item('3124'), WORN);
    for (let index = 0; index < 5; index += 1) result.attack();
    result.wait(1);

    expect(ridersOf(result, PHANTOM)).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });

  /**
   * Attacks until the first Phantom Hit, letting the 0.15 s schedule land after
   * each one so the rider is visible as soon as it exists.
   */
  const attacksUntilRepeat = (result: Harness, limit = 20): number => {
    let count = 0;
    while (ridersOf(result, PHANTOM).length === 0 && count < limit) {
      result.attack();
      result.wait(guinsoo.phantomDelaySeconds * 2);
      count += 1;
    }
    return count;
  };

  /**
   * The phantom counter's own window was the one stateful branch in this family
   * that no test reached. It matters because `phantomStackSeconds` is the
   * least-supported number here — wiki, not Riot: "At maximum stacks, basic
   * attacks on-attack also grant a Phantom stack for 6 seconds, up to 2 stacks."
   *
   * What the branch is worth pinning is an upper bound on that 6. Five attacks
   * leave four Seething stacks and two phantom stacks standing; any gap long
   * enough to lapse the Seething stacks must then cost a full cold start of six
   * attacks, because rebuilding four Seething stacks takes three more attack
   * cycles and the phantom stacks are already older than the gap by then. A
   * phantom window generous enough to carry the pair across the gap would show
   * up here as one attack instead of six.
   *
   * It cannot separate 6 s from, say, 3 s: at Vi's cadence both lapse before the
   * fourth Seething stack is back. That is a property of the item — the phantom
   * window is never the binding constraint — and is stated rather than papered
   * over.
   */
  const LAPSING_GAPS: [label: string, seconds: number][] = [
    ['exactly the Seething window', guinsoo.stackSeconds],
    ['past the Seething window', guinsoo.stackSeconds + 1],
    ['past the phantom window', guinsoo.phantomStackSeconds + 1],
  ];

  it.each(LAPSING_GAPS)(
    'starts the phantom count over after a gap %s, exactly as from cold',
    (_label, gap) => {
      const cold = harness(item('3124'), WORN);
      expect(attacksUntilRepeat(cold)).toBe(6);

      const result = harness(item('3124'), WORN);
      for (let index = 0; index < 5; index += 1) result.attack();
      expect(ridersOf(result, PHANTOM)).toHaveLength(0);
      result.wait(gap);

      result.attack();
      // The Seething stacks really did lapse, which is what makes the count
      // below a restart and not the tail of an unbroken sequence.
      expect(result.buffs()[0]!.label).toContain('1/4');
      result.wait(guinsoo.phantomDelaySeconds * 2);
      expect(1 + attacksUntilRepeat(result)).toBe(6);
    },
  );

  /**
   * The half that is not modelled has to be said out loud, and it has to name
   * both omissions. A Phantom Hit re-applies every on-hit effect — Data Dragon's
   * own wording is unqualified — and the larger of the two things this model
   * cannot repeat is not an item at all: it is Vi's Denting Blows, advanced from
   * `ChampionRuntime.onBasicAttackHit`. A warning that mentioned only "another
   * on-hit item" would point a build with no second on-hit item at a shortfall
   * it does not have, and hide the one it does.
   */
  it('warns that only its own on-hit is repeated, naming the champion effect too', () => {
    const result = harness(item('3124'), WORN);
    for (let index = 0; index < 6; index += 1) result.attack();
    result.wait(1);

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!;
    expect(warning).toContain('Phantom Hit');
    expect(warning).toContain('on-hit item');
    expect(warning).toContain('Denting Blows');
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
    /*
     * Riot's own literals: `Items/6672` gives DamageAmount as mLevel1Value 150
     * with a breakpoint at level 9 worth 5 per level at and after, so a level-11
     * Vi is paid for levels 9, 10 and 11 — 150 + 5 × (11 − 8) = 165. Written as
     * arithmetic on the bin's numbers rather than through the module's constants,
     * so a wrong constant fails here instead of agreeing with itself.
     */
    const base = 150 + 5 * (11 - (9 - 1));
    expect(base).toBe(165);
    // MaxAmpNumber 1.75, i.e. the wiki's "increased by 0% - 75%".
    const span = 1.75 - 1;

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

    // A fifth of the health left is four fifths missing: four fifths of the ramp.
    expect(threeAttacks(0.2)).toBeCloseTo(base * (1 + span * 0.8), 2);
    // Half missing is half the ramp — the linear reading, stated as a check.
    expect(threeAttacks(0.5)).toBeCloseTo(base * (1 + span * 0.5), 2);
    // And at the bottom it reaches exactly Riot's MaxAmpNumber, no further.
    expect(threeAttacks(0.000001)).toBeCloseTo(base * 1.75, 2);
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

  /**
   * Each stack has its own timer, and for this item that decides whether a whole
   * ~165 damage instance exists — not the size of a buff.
   *
   * Riot's wiki, verbatim: "Basic attacks on-hit grant a stack for 3 seconds, up
   * to 2 stacks" — a stack for 3 seconds, from the attack that granted it, with
   * no refresh clause of the kind the wiki spells out where one applies. The
   * bin's own duration is `BuffDuration` 4, which is the number the module uses.
   *
   * Attacking every 3.5 s is the case that separates the two readings at
   * BuffDuration 4. A single window pushed out by each attack would proc on the
   * third attack (t = 7.0), because each attack moved the deadline to +4; per
   * stack, the t = 0 stack died at t = 4, so at t = 7.0 there are only ever two
   * live stacks and nothing fires — however long the sequence runs.
   */
  it('gives each stack its own timer, so a steady 3.5 s cadence never procs at all', () => {
    const result = harness(item('6672'));
    const gap = kraken.stackSeconds - 0.5; // 3.5 s: under the window, over half of it.
    for (let index = 0; index < 8; index += 1) {
      if (index > 0) result.wait(gap);
      result.attack();
    }

    expect(attacksOf(result)).toHaveLength(8);
    expect(result.instances.filter((entry) => entry.sourceLabel === PROC)).toHaveLength(0);
  });

  /**
   * The missing-health ramp is read after the attack has landed, because that is
   * the only moment the hook is offered. In the engine that also puts it after
   * every item rider placed before Kraken in the build, so the amp is mildly
   * order-dependent — the module says so at the point of use. This bounds the
   * size of that dependence: a Recurve Bow-sized rider (15) placed ahead of
   * Kraken adds 45 by the third attack of the window, which on a 2500 HP target
   * moves the proc by about 2.2 damage out of ~178 — 1.5% at most, and in the
   * direction of slightly too much.
   */
  it('reads the ramp after the attack, which is worth about 1% of the proc', () => {
    const health = 2500;
    const attackDamage = harness(item('6672'), { targetMaxHealth: health })
      .stats()
      .totalAttackDamage;

    // 165 at level 11, per the bin's level table (150 + 5 × (11 − 8)).
    const base = 150 + 5 * (11 - (9 - 1));
    const procAt = (missingBefore: number) => base * (1 + 0.75 * (missingBefore / health));

    const result = harness(item('6672'), { targetMaxHealth: health });
    result.attack();
    result.attack();
    result.attack();
    const proc = result.instances.find((entry) => entry.sourceLabel === PROC)!;

    // Three attacks have landed when the ramp is read: the third one included.
    expect(proc.raw).toBeCloseTo(procAt(3 * attackDamage), 6);
    // Had another item's 15-damage rider run first on each of those attacks, the
    // amp would have read 45 more damage of missing health — this much more, and
    // no more, which is the whole of the order dependence for that build.
    const withRiderAhead = procAt(3 * attackDamage + 3 * 15);
    expect(withRiderAhead - proc.raw).toBeCloseTo(0.75 * base * ((3 * 15) / health), 6);
    expect(withRiderAhead / proc.raw - 1).toBeLessThan(0.015);
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
    // Data Dragon prints no passive block for 3006 either, but the bin is not
    // empty the way 3051's is: `Items/3006` carries FeatsAS 0.05, the Feats of
    // Strength boot upgrade. A conditional stat, not a damage effect.
    ['3006', "Berserker's Greaves", 'stat-only, bar a conditional 5% attack speed'],
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
    // The rest of the shop's <OnHit> ids that no family models. Named here so
    // that their absence is a decision on record rather than a silence.
    ['1083', 'Cull', 'its on-hit restores health and deals no damage'],
    ['3504', 'Ardent Censer', 'on-hit damage gated on healing or shielding an ally'],
    ['3870', 'Dream Maker', "the bonus damage lands on the ally, not the item's owner"],
    ['3877', 'Bloodsong', 'a Spellblade, and so the ability family’s business'],
    ['2510', 'Dusk and Dawn', 'a Spellblade, likewise'],
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
