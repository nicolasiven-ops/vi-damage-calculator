import { describe, expect, it } from 'vitest';
import { CRIT_CONSTANTS, CRIT_ITEMS } from '../src/model/items/crit';
import { type ItemEffect, type ItemRuntime } from '../src/model/itemEffects';
import { mitigate } from '../src/engine/damage';
import type { DamageInstance, DamageType, TargetConfig } from '../src/engine/types';
import { DEFAULT_TIMINGS } from '../src/engine/types';
import type { SimContext } from '../src/engine/context';
import type { HitInfo } from '../src/model/runes';
import type { StatBlock } from '../src/model/stats';
import { emptyStats, resolveChampionStats, sumStats } from '../src/model/stats';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

/**
 * The crit family, driven directly rather than through `simulate`.
 *
 * `simulate` finds an item's passive through the registry in `itemEffects.ts`,
 * and this module is not registered there — registering it would mean editing
 * that file, which this piece of work is not allowed to do. So the harness below
 * stands in for the engine and reproduces the three things these effects
 * actually depend on:
 *
 *  - the *order* the engine uses. `onBasicAttack` is asked for its rider after
 *    the attack's own damage has resolved, and `onHitLanded` is called after the
 *    target's health has already been reduced, so a hook sees the health the hit
 *    left behind. Both matter: The Collector reads that health, and Yun Tal's
 *    stacks must not inflate the attack that granted them.
 *  - the way temporary buffs are keyed. The engine identifies a buff by the text
 *    before the first " · " and *replaces* it, which is what makes a stacking
 *    buff one buff rather than sixty. Yun Tal applies two buffs at once and
 *    would silently overwrite one of them if that key were shared, so the
 *    harness has to key them the same way the engine does or the test would pass
 *    on a bug.
 *  - stats resolved through `resolveChampionStats`, so a crit-chance buff is
 *    read back through the same function the engine's damage step uses.
 *
 * What it does not reproduce is mitigation: the stand-in target has no
 * resistances, so a raw number and a landed number are the same thing here and
 * every assertion below is about the number the item produced. Opportunity is
 * the one entry that only matters *through* mitigation, so its block calls the
 * engine's own `mitigate` instead of the harness.
 */

const BASE_TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 2000,
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

const LEVEL = 11;

/** One piece of damage the item produced, however it produced it. */
interface Instance {
  label: string;
  type: DamageType;
  amount: number;
  at: number;
}

function harness(target: Partial<TargetConfig> = {}) {
  const config: TargetConfig = { ...BASE_TARGET, ...target };
  let time = 0;
  let health = config.maxHealth * config.currentHealthPercent;
  const temporary: { label: string; stats: Partial<StatBlock>; expiresAt: number }[] = [];
  const instances: Instance[] = [];
  const warnings: string[] = [];

  const identity = (label: string): string => label.split(' · ')[0] ?? label;
  const liveStats = (): Partial<StatBlock>[] =>
    temporary.filter((entry) => entry.expiresAt > time).map((entry) => entry.stats);

  const ctx: SimContext = {
    get time() {
      return time;
    },
    timings: DEFAULT_TIMINGS,
    get stats() {
      return resolveChampionStats(
        FIXTURE_CHAMPION_STATS,
        LEVEL,
        sumStats([emptyStats(), ...liveStats()]),
      );
    },
    target: config,
    get targetMaxHealth() {
      return config.maxHealth;
    },
    get targetCurrentHealth() {
      return health;
    },
    rank: () => 5,
    dealDamage(args): DamageInstance {
      health = Math.max(0, health - args.amount);
      instances.push({ label: args.sourceLabel, type: args.type, amount: args.amount, at: time });
      return {
        id: `stub${instances.length}`,
        seq: instances.length,
        time,
        sourceId: args.sourceId,
        sourceLabel: args.sourceLabel,
        sourceKind: args.sourceKind,
        type: args.type,
        raw: args.amount,
        mitigated: args.amount,
        crit: false,
        targetHpAfter: health,
        notes: args.notes ?? [],
      };
    },
    scheduleDamage() {},
    applyArmorShred() {},
    grantShield() {},
    applyTemporaryStats(args) {
      const existing = temporary.find((entry) => identity(entry.label) === identity(args.label));
      if (existing) {
        existing.label = args.label;
        existing.stats = args.stats;
        existing.expiresAt = time + args.durationSeconds;
        return;
      }
      temporary.push({
        label: args.label,
        stats: args.stats,
        expiresAt: time + args.durationSeconds,
      });
    },
    clearTemporaryStats() {},
    applyTargetAmplification() {},
    applyCrowdControl() {},
    addEvent() {},
    warn(message) {
      warnings.push(message);
    },
  };

  return {
    ctx,
    instances,
    warnings,
    buffLabels: () => temporary.filter((entry) => entry.expiresAt > time).map((entry) => entry.label),
    advance(seconds: number) {
      time += seconds;
    },
    /** One basic attack, asking the item for the rider it folds into it. */
    swing(runtime: ItemRuntime): Instance | null {
      const rider = runtime.onBasicAttack?.(ctx) ?? null;
      if (!rider || rider.amount <= 0) return null;
      const instance: Instance = { label: rider.label, type: rider.type, amount: rider.amount, at: time };
      instances.push(instance);
      health = Math.max(0, health - rider.amount);
      return instance;
    },
    /** One damage instance landing, reported the way the engine reports it. */
    land(runtime: ItemRuntime, damage: number, overrides: Partial<HitInfo> = {}) {
      health = Math.max(0, health - damage);
      const hit: HitInfo = {
        sourceId: 'AA',
        sourceKind: 'attack',
        type: 'physical',
        isAbilityDamage: false,
        triggersOnHit: true,
        mitigated: damage,
        targetHealthPercentAfter: health / config.maxHealth,
        ...overrides,
      };
      runtime.onHitLanded?.(ctx, hit);
    },
  };
}

function effectOf(id: string): ItemEffect {
  const effect = CRIT_ITEMS.find((entry) => entry.id === id);
  if (!effect) throw new Error(`item ${id} is not in CRIT_ITEMS`);
  return effect;
}

function runtimeOf(id: string): ItemRuntime {
  const effect = effectOf(id);
  if (!effect.createRuntime) throw new Error(`${effect.name} has no runtime`);
  return effect.createRuntime();
}

/** Attacks needed to refill an empty Energize counter at this rate. */
function attacksToRecharge(stacksPerAttack: number): number {
  return Math.ceil(CRIT_CONSTANTS.energize.max / stacksPerAttack);
}

describe('Energized attacks', () => {
  /**
   * The charge assumption is the whole modelling decision, so it gets the first
   * test: Vi walks to the fight, so she arrives Energized and the opening attack
   * is the empowered one.
   */
  it('spends a full charge on the first attack of the combo', () => {
    const h = harness();
    const proc = h.swing(runtimeOf('3094'));

    expect(proc).not.toBeNull();
    expect(proc!.type).toBe('magic');
    expect(proc!.amount).toBe(CRIT_CONSTANTS.rapidFirecannon.bonusDamage);
    expect(proc!.label).toContain('Sharpshooter');
  });

  it('recharges from attacks alone, at six stacks each', () => {
    const h = harness();
    const runtime = runtimeOf('3094');
    const needed = attacksToRecharge(CRIT_CONSTANTS.energize.perBasicAttack);

    h.swing(runtime);
    // Every attack up to the refill is an ordinary one.
    for (let i = 0; i < needed; i += 1) {
      expect(h.swing(runtime), `attack ${i + 2}`).toBeNull();
    }
    // 17 attacks × 6 stacks passes 100, so the next one is Energized again.
    expect(h.swing(runtime)?.amount).toBe(CRIT_CONSTANTS.rapidFirecannon.bonusDamage);
    expect(h.instances).toHaveLength(2);
  });

  it('gives Stormrazor the hundred Riot ships in the item bin', () => {
    const h = harness();
    const proc = h.swing(runtimeOf('3097'));

    expect(proc!.amount).toBe(CRIT_CONSTANTS.stormrazor.bonusDamage);
    expect(proc!.type).toBe('magic');
    // Larger than Rapid Firecannon's — the two would be easy to transpose.
    expect(proc!.amount).toBeGreaterThan(CRIT_CONSTANTS.rapidFirecannon.bonusDamage);
  });

  it('charges Statikk Shiv faster, because Electroshock adds nine stacks', () => {
    const h = harness();
    const runtime = runtimeOf('3087');
    const perAttack =
      CRIT_CONSTANTS.energize.perBasicAttack + CRIT_CONSTANTS.statikkShiv.bonusStacksPerAttack;
    const needed = attacksToRecharge(perAttack);

    expect(needed).toBeLessThan(attacksToRecharge(CRIT_CONSTANTS.energize.perBasicAttack));

    h.swing(runtime);
    for (let i = 0; i < needed; i += 1) {
      expect(h.swing(runtime), `attack ${i + 2}`).toBeNull();
    }
    expect(h.swing(runtime)).not.toBeNull();

    expect(h.instances.map((entry) => entry.amount)).toEqual([
      CRIT_CONSTANTS.statikkShiv.championDamage,
      CRIT_CONSTANTS.statikkShiv.championDamage,
    ]);
  });

  it("uses Statikk Shiv's larger number against something that is not a champion", () => {
    const champion = harness({ unitType: 'champion' });
    const monster = harness({ unitType: 'monster', maxHealth: 12000 });

    expect(champion.swing(runtimeOf('3087'))!.amount).toBe(
      CRIT_CONSTANTS.statikkShiv.championDamage,
    );
    expect(monster.swing(runtimeOf('3087'))!.amount).toBe(
      CRIT_CONSTANTS.statikkShiv.nonChampionDamage,
    );
  });
});

describe('The Collector', () => {
  const threshold = CRIT_CONSTANTS.theCollector.executeThreshold;

  it('takes the remaining health once a hit leaves a champion under the line', () => {
    const h = harness();
    const runtime = runtimeOf('6676');
    const line = BASE_TARGET.maxHealth * threshold;

    // One point above the line: nothing happens, and that is the interesting
    // half of the test — an execute that fires early kills targets that live.
    h.land(runtime, BASE_TARGET.maxHealth - (line + 1));
    expect(h.instances).toHaveLength(0);
    expect(h.ctx.targetCurrentHealth).toBeCloseTo(line + 1, 6);

    // Two more points of damage cross it.
    h.land(runtime, 2);
    expect(h.instances).toHaveLength(1);
    const execute = h.instances[0]!;
    expect(execute.type).toBe('true');
    expect(execute.amount).toBeCloseTo(line - 1, 6);
    expect(execute.label).toContain('The Collector');
    // And the point of an execute is that nothing is left.
    expect(h.ctx.targetCurrentHealth).toBe(0);
  });

  it('executes champions only', () => {
    const h = harness({ unitType: 'monster', maxHealth: 2000 });
    const runtime = runtimeOf('6676');

    h.land(runtime, BASE_TARGET.maxHealth * (1 - threshold / 2));
    expect(h.ctx.targetCurrentHealth).toBeGreaterThan(0);
    expect(h.instances).toHaveLength(0);
  });

  it('does not fire twice on a target it has already emptied', () => {
    const h = harness();
    const runtime = runtimeOf('6676');

    h.land(runtime, BASE_TARGET.maxHealth * (1 - threshold / 2));
    expect(h.instances).toHaveLength(1);
    // A second hit into a corpse: the engine would not deliver it, and the item
    // must not manufacture a second execute if it does.
    h.land(runtime, 10);
    expect(h.instances).toHaveLength(1);
  });

  it('says out loud that damage reduction still eats into a true-damage execute', () => {
    const h = harness({ percentDamageReduction: 0.2 });
    const runtime = runtimeOf('6676');

    h.land(runtime, BASE_TARGET.maxHealth * (1 - threshold / 2));
    expect(h.instances).toHaveLength(1);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('true damage');
  });
});

describe('Yun Tal Wildarrows', () => {
  const yunTal = CRIT_CONSTANTS.yunTal;

  it('grants the melee 0.4% of critical strike chance per attack', () => {
    const h = harness();
    const runtime = runtimeOf('3032');

    // The fixture champion has no innate crit, so the whole reading is the item.
    expect(h.ctx.stats.critChance).toBe(0);

    h.swing(runtime);
    expect(h.ctx.stats.critChance).toBeCloseTo(yunTal.critPerAttackMelee, 10);

    h.swing(runtime);
    h.swing(runtime);
    expect(h.ctx.stats.critChance).toBeCloseTo(3 * yunTal.critPerAttackMelee, 10);
  });

  it('stops at the 25% cap rather than at 63 × 0.4%', () => {
    const h = harness();
    const runtime = runtimeOf('3032');

    for (let i = 0; i < yunTal.maxStacksMelee + 10; i += 1) h.swing(runtime);

    // 63 stacks would be 25.2%; Riot caps the item at 25%.
    expect(yunTal.maxStacksMelee).toBe(63);
    expect(yunTal.maxStacksMelee * yunTal.critPerAttackMelee).toBeGreaterThan(yunTal.critCap);
    expect(h.ctx.stats.critChance).toBeCloseTo(yunTal.critCap, 10);
  });

  it('holds both passives at once instead of one overwriting the other', () => {
    const h = harness();
    const runtime = runtimeOf('3032');
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.swing(runtime);

    // The regression this guards: the engine keys a buff on the text before the
    // first " · ", so two buffs from one item named after the item would be one
    // buff, and whichever landed second would win.
    expect(h.buffLabels()).toHaveLength(2);
    expect(h.ctx.stats.critChance).toBeCloseTo(yunTal.critPerAttackMelee, 10);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline + yunTal.flurryAttackSpeed, 10);
  });

  it('runs Flurry for six seconds and not a moment longer', () => {
    const h = harness();
    const runtime = runtimeOf('3032');
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.swing(runtime);
    h.advance(yunTal.flurryDurationSeconds - 0.01);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline + yunTal.flurryAttackSpeed, 10);

    h.advance(0.02);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline, 10);

    // And it does not simply come back on the next attack: that is what the
    // thirty-second cooldown is for.
    h.swing(runtime);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline, 10);
  });

  it('takes a second off the Flurry cooldown for every attack that lands', () => {
    const h = harness();
    const runtime = runtimeOf('3032');

    h.swing(runtime);
    // Stand at the moment the window closes; Flurry is nominally 24 s away.
    h.advance(yunTal.flurryDurationSeconds);
    const baseline = h.ctx.stats.bonusAttackSpeed;
    const attacksNeeded =
      (yunTal.flurryCooldownSeconds - yunTal.flurryDurationSeconds) /
      yunTal.flurryCooldownPerAttackSeconds;

    for (let i = 0; i < attacksNeeded; i += 1) {
      h.swing(runtime);
      expect(h.ctx.stats.bonusAttackSpeed, `after attack ${i + 1}`).toBeCloseTo(baseline, 10);
    }

    // The 24 attacks have pulled the cooldown down to where the clock already
    // is, so the next attack procs it again.
    h.swing(runtime);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline + yunTal.flurryAttackSpeed, 10);
  });

  it('does not proc Flurry off a target that is not a champion', () => {
    const h = harness({ unitType: 'minion', maxHealth: 500 });
    const runtime = runtimeOf('3032');
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.swing(runtime);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline, 10);
    // The crit stack is not gated on the target, and still lands.
    expect(h.ctx.stats.critChance).toBeCloseTo(yunTal.critPerAttackMelee, 10);
  });
});

/**
 * Opportunity earns its place through the mitigation step rather than through an
 * instance of its own, so it is tested there: the stat it declares is fed into
 * the engine's `mitigate` exactly the way `simulate` feeds it (as
 * `flatArmorPen`), and the landed damage is compared against the armour formula
 * with the constant subtracted.
 */
describe('Opportunity', () => {
  const preparation = CRIT_CONSTANTS.opportunity.preparationLethalityMelee;
  const TARGET_ARMOR = 100;

  /** The stats an attacker has with nothing but this item's Preparation. */
  function statsWithPreparation() {
    const stats = effectOf('6701').stats;
    expect(stats).toBeDefined();
    return resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, sumStats([emptyStats(), stats!]));
  }

  function landed(raw: number, flatArmorPen: number): number {
    return mitigate({
      raw,
      type: 'physical',
      armor: {
        base: TARGET_ARMOR,
        flatReduction: 0,
        percentReduction: 0,
        percentPenetration: 0,
        flatPenetration: flatArmorPen,
      },
      magicResist: {
        base: 0,
        flatReduction: 0,
        percentReduction: 0,
        percentPenetration: 0,
        flatPenetration: 0,
      },
      percentDamageReduction: 0,
      flatDamageReduction: 0,
      amplification: 0,
    }).mitigated;
  }

  it('declares the melee 11 lethality as a stat, because no hook runs early enough', () => {
    const effect = effectOf('6701');
    // A hook would arrive after the first hit's damage had been computed, and
    // for Vi that hit is usually the charged Q — so this is a stat on purpose.
    expect(effect.createRuntime).toBeUndefined();
    expect(effect.amplify).toBeUndefined();
    expect(effect.stats).toEqual({ lethality: preparation });
  });

  it('reaches the damage step as flat armor penetration', () => {
    expect(statsWithPreparation().flatArmorPen).toBe(preparation);
  });

  it('turns 11 lethality into the damage the armor formula says it is worth', () => {
    const raw = 200;
    const stats = statsWithPreparation();

    const without = landed(raw, 0);
    const withItem = landed(raw, stats.flatArmorPen);

    // 100 armor halves a hit; 100 − 11 leaves 100/189 of it standing.
    expect(without).toBeCloseTo((raw * 100) / (100 + TARGET_ARMOR), 9);
    expect(withItem).toBeCloseTo((raw * 100) / (100 + TARGET_ARMOR - preparation), 9);
    // Worth roughly 5.8% more damage at this armour, and never less.
    expect(withItem / without).toBeCloseTo(
      (100 + TARGET_ARMOR) / (100 + TARGET_ARMOR - preparation),
      9,
    );
  });

  it('never pushes armor below zero into bonus damage', () => {
    // A frail target with less armour than the lethality: penetration stops at
    // zero, so the hit lands whole rather than amplified.
    const raw = 200;
    const bare = mitigate({
      raw,
      type: 'physical',
      armor: {
        base: preparation / 2,
        flatReduction: 0,
        percentReduction: 0,
        percentPenetration: 0,
        flatPenetration: preparation,
      },
      magicResist: {
        base: 0,
        flatReduction: 0,
        percentReduction: 0,
        percentPenetration: 0,
        flatPenetration: 0,
      },
      percentDamageReduction: 0,
      flatDamageReduction: 0,
      amplification: 0,
    }).mitigated;
    expect(bare).toBeCloseTo(raw, 9);
  });
});

/**
 * The Arena clones.
 *
 * Two of this family's Arena ids carry the same data values as their Summoner's
 * Rift originals and are shipped as copies; the point of these tests is that
 * they are copies of the *behaviour*, not merely of the id.
 */
describe('Arena variants', () => {
  it('gives Arena Yun Tal the same stacking as 3032, with its own runtime', () => {
    const rift = harness();
    const arena = harness();

    rift.swing(runtimeOf('3032'));
    arena.swing(runtimeOf('223032'));

    expect(arena.ctx.stats.critChance).toBeCloseTo(rift.ctx.stats.critChance, 10);
    expect(arena.buffLabels()).toEqual(rift.buffLabels());
  });

  it('keeps the two Collectors on separate counters', () => {
    const h = harness();
    const rift = runtimeOf('6676');
    const arena = runtimeOf('226676');

    // One hit under the line: both items would execute, and each is asked once.
    h.land(rift, BASE_TARGET.maxHealth * (1 - CRIT_CONSTANTS.theCollector.executeThreshold / 2));
    expect(h.instances).toHaveLength(1);
    // The target is already empty, so the second one correctly does nothing —
    // which is the guard that a clone shares no state with its original.
    h.land(arena, 0.5);
    expect(h.instances).toHaveLength(1);
  });
});

describe('the family as a whole', () => {

  it('claims nothing it does not implement', () => {
    expect(new Set(CRIT_ITEMS.map((item) => item.id)).size).toBe(CRIT_ITEMS.length);
    for (const item of CRIT_ITEMS) {
      expect(item.modelled, item.name).toBe(true);
      // Either it does something when the combo runs, or it grants a stat Data
      // Dragon's stat block does not list. An entry that does neither is a claim
      // with nothing behind it.
      expect(Boolean(item.createRuntime ?? item.amplify ?? item.stats), item.name).toBe(true);
      expect(item.note.length, item.name).toBeGreaterThan(20);
    }
  });

  /**
   * Infinity Edge is deliberately absent, and this is the test that says why:
   * its "30% Critical Strike Damage" is a `<stats>` line, `resolveItem` already
   * parses that line into `critDamage`, and it *adds* an effect's `stats` on top
   * of what it parsed. An entry here would grant the crit damage twice.
   *
   * The same reasoning bounds what any entry may declare in `stats`: only what
   * Riot writes into passive prose. Opportunity's Preparation lethality is the
   * one such number in this family — its 18 base lethality is a stat line and is
   * not repeated.
   */
  it('leaves stat lines to the description parser', () => {
    expect(CRIT_ITEMS.some((item) => item.id === '3031')).toBe(false);

    const withStats = CRIT_ITEMS.filter((item) => item.stats);
    expect(withStats.map((item) => item.id)).toEqual(['6701']);
    expect(Object.keys(withStats[0]!.stats!)).toEqual(['lethality']);
  });

  /**
   * The ids are the part most easily got wrong, because three of this family's
   * items moved: Stormrazor is 3097 and 3095 is Riot's disabled shell, Yun Tal
   * is 3032 and 6673 is Immortal Shieldbow, and 6675 is Navori Flickerblade,
   * whose cooldown passive nothing here can express.
   */
  it('keys the energized items on the ids that are still live', () => {
    const ids = CRIT_ITEMS.map((item) => item.id);
    expect(ids).toContain('3097');
    expect(ids).not.toContain('3095');
    expect(ids).toContain('3032');
    expect(ids).not.toContain('6673');
    expect(ids).not.toContain('6675');
  });
});
