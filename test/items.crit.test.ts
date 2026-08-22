import { describe, expect, it } from 'vitest';
import { CRIT_CONSTANTS, CRIT_ITEMS } from '../src/model/items/crit';
import { type ItemEffect, type ItemRuntime } from '../src/model/itemEffects';
import { mitigate } from '../src/engine/damage';
import { simulate } from '../src/engine/simulate';
import { VI_MODULE } from '../src/model/champions/vi';
import type { AbilitySlot, DamageInstance, DamageType, TargetConfig } from '../src/engine/types';
import { DEFAULT_TIMINGS } from '../src/engine/types';
import type { SimContext } from '../src/engine/context';
import type { HitInfo } from '../src/model/runes';
import type { StatBlock } from '../src/model/stats';
import { BASE_CRIT_MULTIPLIER, emptyStats, resolveChampionStats, sumStats } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * The crit family, driven directly rather than through `simulate`.
 *
 * The family is registered in `itemEffects.ts` and does reach `simulate`, but a
 * whole simulation is the wrong instrument for one item's passive: it would take
 * a build, a combo and a champion to exercise a charge counter, and a failure
 * would point at the engine rather than at the item. So the harness below stands
 * in for the engine and reproduces the four things these effects actually depend
 * on:
 *
 *  - the *order* the engine uses. `onBasicAttack` is asked for its rider after
 *    the attack's own damage has resolved, and `onHitLanded` is called after the
 *    target's health has already been reduced, so a hook sees the health the hit
 *    left behind. Both matter: The Collector reads that health, Yun Tal's stacks
 *    must not inflate the attack that granted them, and Fiendhunter Bolts' third
 *    attack must still be inside its own window when it spends the last charge.
 *  - the way temporary buffs are keyed. The engine identifies a buff by the text
 *    before the first " · " and *replaces* it, and `clearTemporaryStats` looks a
 *    buff up by that same prefix. Yun Tal applies two buffs at once and would
 *    silently overwrite one of them if that key were shared; Fiendhunter Bolts
 *    ends its window by clearing it, which only works if the prefix matches.
 *  - stats resolved through `resolveChampionStats`, so a crit-chance buff is
 *    read back through the same function the engine's damage step uses.
 *  - the identity a damage instance carries. `simulate.ts` books an item's damage
 *    under `item:${id}` from the id it was equipped as, so the harness keeps
 *    `sourceId` — that is the only way to see an Arena clone reporting under the
 *    Rift item's id.
 *
 * What it does not reproduce is mitigation: the stand-in target has no
 * resistances, so a raw number and a landed number are the same thing here and
 * every assertion below is about the number the item produced. Opportunity is
 * the one entry that only matters *through* mitigation, so its block calls the
 * engine's own `mitigate` instead of the harness.
 */

/**
 * Riot's numbers, restated.
 *
 * This block exists because a test that reads `CRIT_CONSTANTS` and asserts the
 * runtime produced `CRIT_CONSTANTS` proves the plumbing and nothing about the
 * value: `rapidFirecannon.bonusDamage` could be edited to 400 and every
 * behavioural test would still pass. Everything below is quoted from its source
 * in the comment beside it, and the assertions in this file are written against
 * these literals rather than against the module's own constants, so a constant
 * that drifts fails a test instead of quietly changing an answer.
 *
 * Sources, all patch 16.16.1 / item bin of 2026-08-16:
 *  - "DD" — Data Dragon `item.json`, resolved tooltip text.
 *  - "bin" — CommunityDragon `items.cdtb.bin.json`, `mDataValues` or
 *    `mItemCalculations` on that item.
 *  - "wiki" — quoted verbatim, and only where the number is in neither of those.
 */
const RIOT = {
  /** wiki, Energized: "Moving and basic attacking generates Energize stacks, up to 100". */
  energizeMax: 100,
  /** wiki, Energized notes: each basic attack generates 6 stacks. */
  energizePerBasicAttack: 6,
  /** DD 3094: "deals 40 bonus magic damage"; bin BonusDamage 40. */
  rapidFirecannonDamage: 40,
  /** bin 3097 mItemCalculations.TotalProcDamage = 100 (DD ships the number stripped out). */
  stormrazorDamage: 100,
  /** bin 3087 ChainDamage 60, NonChampChainDamage 90, BonusEnergizedStacks 9. */
  statikkChampionDamage: 60,
  statikkNonChampionDamage: 90,
  statikkBonusStacks: 9,
  /** DD 6676: "executes champions that are below 5% Health"; bin ExecuteThreshold 0.05. */
  collectorExecuteThreshold: 0.05,
  /** bin 3032 CritPerStackMelee 0.4 and CritMax 25, both as whole percent. */
  yunTalCritPerAttackMelee: 0.004,
  yunTalCritCap: 0.25,
  /** bin 3032 ASMod 0.3, ASDuration 6, Cooldown 30, AACDR 1, CritCDR 2. */
  yunTalFlurryAttackSpeed: 0.3,
  yunTalFlurryDuration: 6,
  yunTalFlurryCooldown: 30,
  yunTalFlurryCooldownPerAttack: 1,
  /** bin 2512 NumberOfAttacks 3, Duration 8, Cooldown 45, BonusAS 0.5, CritModifier 0.8. */
  fiendhunterAttacks: 3,
  fiendhunterDuration: 8,
  fiendhunterCooldown: 45,
  fiendhunterBonusAttackSpeed: 0.5,
  fiendhunterCritModifier: 0.8,
  /** bin 2512 BonusTrueDamage 0.15 and UltimateHaste 30 — recorded, not applied. */
  fiendhunterBonusTrueDamage: 0.15,
  fiendhunterUltimateHaste: 30,
  /**
   * bin 226701 LethalityProcAmount 20 (BonusLethalityCalc reads a hash
   * CommunityDragon cannot resolve; it can only be this value — see the module).
   */
  arenaOpportunityLethality: 20,
} as const;

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
  sourceId: string;
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
    get attackerMaxHealth() {
      return ctx.stats.maxHealth;
    },
    get attackerCurrentHealth() {
      return ctx.stats.maxHealth;
    },
    get targetMaxHealth() {
      return config.maxHealth;
    },
    get targetCurrentHealth() {
      return health;
    },
    rank: () => 5,
    dealDamage(args): DamageInstance {
      health = Math.max(0, health - args.amount);
      instances.push({
        sourceId: args.sourceId,
        label: args.sourceLabel,
        type: args.type,
        amount: args.amount,
        at: time,
      });
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
    applyMagicResistShred() {},
    reduceBasicCooldowns() {},
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
    /*
     * The engine looks a buff up by the prefix before the first " · " and takes
     * the *argument* as that prefix already — `clearTemporaryStats('Opening
     * Barrage')`, not the decorated label. Reproduced exactly, because an item
     * that passes the decorated label would silently fail to clear anything and
     * a laxer stand-in here would hide that.
     */
    clearTemporaryStats(label) {
      const index = temporary.findIndex((entry) => identity(entry.label) === label);
      if (index === -1) return;
      temporary.splice(index, 1);
    },
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
    hasBuff: (prefix: string) =>
      temporary.some((entry) => entry.expiresAt > time && identity(entry.label) === prefix),
    advance(seconds: number) {
      time += seconds;
    },
    /** Stats the rest of the build brings, as a buff that outlasts the test. */
    equip(stats: Partial<StatBlock>) {
      temporary.push({ label: 'Build', stats, expiresAt: Infinity });
    },
    /** One ability cast, the way `simulate.ts` reports it to every item runtime. */
    cast(runtime: ItemRuntime, slot: AbilitySlot) {
      runtime.onAbilityCast?.(ctx, slot);
    },
    /** One basic attack, asking the item for the rider it folds into it. */
    swing(runtime: ItemRuntime): Instance | null {
      const rider = runtime.onBasicAttack?.(ctx) ?? null;
      if (!rider || rider.amount <= 0) return null;
      const instance: Instance = {
        sourceId: 'rider',
        label: rider.label,
        type: rider.type,
        amount: rider.amount,
        at: time,
      };
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
  return Math.ceil(RIOT.energizeMax / stacksPerAttack);
}

/**
 * The numbers themselves, against the sources rather than against the module.
 *
 * Every other test in this file asserts a behaviour; this one asserts the values
 * that behaviour is made of, so that editing a constant in `crit.ts` fails here
 * with the item's name on it instead of silently changing what the app reports.
 */
describe('the Riot values this family is built on', () => {
  const c = CRIT_CONSTANTS;

  it('holds Energize at the wiki-sourced 100 stacks and 6 per attack', () => {
    expect(c.energize.max).toBe(RIOT.energizeMax);
    expect(c.energize.perBasicAttack).toBe(RIOT.energizePerBasicAttack);
    // 1 stack per 24 units travelled — recorded, never read, because the
    // simulation has no positions.
    expect(c.energize.perDistanceUnit).toBeCloseTo(1 / 24, 12);
    // The consequence the tests below rely on: 100 / 6 rounds up to 17 attacks.
    expect(attacksToRecharge(RIOT.energizePerBasicAttack)).toBe(17);
  });

  it('holds the three Energized payloads', () => {
    expect(c.rapidFirecannon.bonusDamage).toBe(RIOT.rapidFirecannonDamage);
    expect(c.stormrazor.bonusDamage).toBe(RIOT.stormrazorDamage);
    expect(c.statikkShiv.championDamage).toBe(RIOT.statikkChampionDamage);
    expect(c.statikkShiv.nonChampionDamage).toBe(RIOT.statikkNonChampionDamage);
    expect(c.statikkShiv.bonusStacksPerAttack).toBe(RIOT.statikkBonusStacks);
  });

  it("holds The Collector's execute line", () => {
    expect(c.theCollector.executeThreshold).toBe(RIOT.collectorExecuteThreshold);
  });

  it('holds Yun Tal, and derives the stack ceiling rather than copying it', () => {
    expect(c.yunTal.critPerAttackMelee).toBe(RIOT.yunTalCritPerAttackMelee);
    expect(c.yunTal.critCap).toBe(RIOT.yunTalCritCap);
    expect(c.yunTal.flurryAttackSpeed).toBe(RIOT.yunTalFlurryAttackSpeed);
    expect(c.yunTal.flurryDurationSeconds).toBe(RIOT.yunTalFlurryDuration);
    expect(c.yunTal.flurryCooldownSeconds).toBe(RIOT.yunTalFlurryCooldown);
    expect(c.yunTal.flurryCooldownPerAttackSeconds).toBe(RIOT.yunTalFlurryCooldownPerAttack);
    // 25 / 0.4 is 62.5, so the 63rd stack is the last one that changes anything —
    // which is also the wiki's "stacking up to (Melee 63) times".
    expect(c.yunTal.maxStacksMelee).toBe(63);
    expect(Math.ceil(RIOT.yunTalCritCap / RIOT.yunTalCritPerAttackMelee)).toBe(63);
  });

  it('holds Fiendhunter Bolts, including the two values it does not apply', () => {
    expect(c.fiendhunterBolts.attacks).toBe(RIOT.fiendhunterAttacks);
    expect(c.fiendhunterBolts.durationSeconds).toBe(RIOT.fiendhunterDuration);
    expect(c.fiendhunterBolts.cooldownSeconds).toBe(RIOT.fiendhunterCooldown);
    expect(c.fiendhunterBolts.bonusAttackSpeed).toBe(RIOT.fiendhunterBonusAttackSpeed);
    expect(c.fiendhunterBolts.critModifier).toBe(RIOT.fiendhunterCritModifier);
    expect(c.fiendhunterBolts.bonusTrueDamage).toBe(RIOT.fiendhunterBonusTrueDamage);
    expect(c.fiendhunterBolts.ultimateAbilityHaste).toBe(RIOT.fiendhunterUltimateHaste);
    // The window has to be shorter than the cooldown, or the runtime's
    // assumption that two casts never overlap is wrong.
    expect(RIOT.fiendhunterDuration).toBeLessThan(RIOT.fiendhunterCooldown);
  });

  it("holds the Arena Opportunity's Preparation", () => {
    expect(c.opportunityArena.preparationLethality).toBe(RIOT.arenaOpportunityLethality);
    // Arena's CombatTimer is 3, not the Rift item's 8.
    expect(c.opportunityArena.outOfCombatSeconds).toBe(3);
    expect(c.opportunityArena.heldAfterDamageSeconds).toBe(3);
  });
});

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
    expect(proc!.amount).toBe(RIOT.rapidFirecannonDamage);
    expect(proc!.label).toContain('Sharpshooter');
  });

  it('recharges from attacks alone, at six stacks each', () => {
    const h = harness();
    const runtime = runtimeOf('3094');
    const needed = attacksToRecharge(RIOT.energizePerBasicAttack);

    h.swing(runtime);
    // Every attack up to the refill is an ordinary one.
    for (let i = 0; i < needed; i += 1) {
      expect(h.swing(runtime), `attack ${i + 2}`).toBeNull();
    }
    // 17 attacks × 6 stacks passes 100, so the next one is Energized again.
    expect(h.swing(runtime)?.amount).toBe(RIOT.rapidFirecannonDamage);
    expect(h.instances).toHaveLength(2);
  });

  it('gives Stormrazor the hundred Riot ships in the item bin', () => {
    const h = harness();
    const proc = h.swing(runtimeOf('3097'));

    expect(proc!.amount).toBe(RIOT.stormrazorDamage);
    expect(proc!.type).toBe('magic');
    // Larger than Rapid Firecannon's — the two would be easy to transpose.
    expect(proc!.amount).toBeGreaterThan(RIOT.rapidFirecannonDamage);
  });

  it('charges Statikk Shiv faster, because Electroshock adds nine stacks', () => {
    const h = harness();
    const runtime = runtimeOf('3087');
    const perAttack = RIOT.energizePerBasicAttack + RIOT.statikkBonusStacks;
    const needed = attacksToRecharge(perAttack);

    // 100 / 15 rounds up to 7, against the plain rate's 17.
    expect(needed).toBe(7);
    expect(needed).toBeLessThan(attacksToRecharge(RIOT.energizePerBasicAttack));

    h.swing(runtime);
    for (let i = 0; i < needed; i += 1) {
      expect(h.swing(runtime), `attack ${i + 2}`).toBeNull();
    }
    expect(h.swing(runtime)).not.toBeNull();

    expect(h.instances.map((entry) => entry.amount)).toEqual([
      RIOT.statikkChampionDamage,
      RIOT.statikkChampionDamage,
    ]);
  });

  it("uses Statikk Shiv's larger number against something that is not a champion", () => {
    const champion = harness({ unitType: 'champion' });
    const monster = harness({ unitType: 'monster', maxHealth: 12000 });

    expect(champion.swing(runtimeOf('3087'))!.amount).toBe(RIOT.statikkChampionDamage);
    expect(monster.swing(runtimeOf('3087'))!.amount).toBe(RIOT.statikkNonChampionDamage);
  });
});

describe('The Collector', () => {
  const threshold = RIOT.collectorExecuteThreshold;

  it('takes the remaining health once a hit leaves a champion under the line', () => {
    const h = harness();
    const runtime = runtimeOf('6676');
    // 5% of 2000 is 100 health.
    const line = BASE_TARGET.maxHealth * threshold;
    expect(line).toBe(100);

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
  it('grants the melee 0.4% of critical strike chance per attack', () => {
    const h = harness();
    const runtime = runtimeOf('3032');

    // The fixture champion has no innate crit, so the whole reading is the item.
    expect(h.ctx.stats.critChance).toBe(0);

    h.swing(runtime);
    expect(h.ctx.stats.critChance).toBeCloseTo(RIOT.yunTalCritPerAttackMelee, 10);

    h.swing(runtime);
    h.swing(runtime);
    // 3 × 0.4% = 1.2%.
    expect(h.ctx.stats.critChance).toBeCloseTo(0.012, 10);
  });

  it('stops at the 25% cap rather than at 63 × 0.4%', () => {
    const h = harness();
    const runtime = runtimeOf('3032');

    for (let i = 0; i < 63 + 10; i += 1) h.swing(runtime);

    // 63 stacks would be 25.2%; Riot caps the item at 25%.
    expect(63 * RIOT.yunTalCritPerAttackMelee).toBeGreaterThan(RIOT.yunTalCritCap);
    expect(h.ctx.stats.critChance).toBeCloseTo(RIOT.yunTalCritCap, 10);
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
    expect(h.ctx.stats.critChance).toBeCloseTo(RIOT.yunTalCritPerAttackMelee, 10);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline + RIOT.yunTalFlurryAttackSpeed, 10);
  });

  it('runs Flurry for six seconds and not a moment longer', () => {
    const h = harness();
    const runtime = runtimeOf('3032');
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.swing(runtime);
    h.advance(RIOT.yunTalFlurryDuration - 0.01);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline + RIOT.yunTalFlurryAttackSpeed, 10);

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
    h.advance(RIOT.yunTalFlurryDuration);
    const baseline = h.ctx.stats.bonusAttackSpeed;
    const attacksNeeded =
      (RIOT.yunTalFlurryCooldown - RIOT.yunTalFlurryDuration) / RIOT.yunTalFlurryCooldownPerAttack;
    expect(attacksNeeded).toBe(24);

    for (let i = 0; i < attacksNeeded; i += 1) {
      h.swing(runtime);
      expect(h.ctx.stats.bonusAttackSpeed, `after attack ${i + 1}`).toBeCloseTo(baseline, 10);
    }

    // The 24 attacks have pulled the cooldown down to where the clock already
    // is, so the next attack procs it again.
    h.swing(runtime);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline + RIOT.yunTalFlurryAttackSpeed, 10);
  });

  it('does not proc Flurry off a target that is not a champion', () => {
    const h = harness({ unitType: 'minion', maxHealth: 500 });
    const runtime = runtimeOf('3032');
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.swing(runtime);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline, 10);
    // The crit stack is not gated on the target, and still lands.
    expect(h.ctx.stats.critChance).toBeCloseTo(RIOT.yunTalCritPerAttackMelee, 10);
  });

  /**
   * The stacking assumption, asserted rather than only documented: the entry is
   * a floor, and a floor has to be visibly a floor.
   */
  it('starts from zero stacks and says so in its note', () => {
    const h = harness();
    expect(h.ctx.stats.critChance).toBe(0);
    const note = effectOf('3032').note;
    expect(note).toContain('floor');
    expect(note).toContain('25%');
  });
});

/**
 * Fiendhunter Bolts.
 *
 * The window is opened by an ultimate cast and closed by whichever comes first,
 * the third attack or the eighth second, so both endings get a test. The crit
 * assertions are the interesting ones: a guaranteed critical strike at 80% of
 * normal crit damage has to come out of a model that folds crit into an
 * expected-value multiplier, and the arithmetic that does it is where a wrong
 * sign or a re-scaled multiplier would hide.
 */
describe('Fiendhunter Bolts', () => {
  it('opens the window on the ultimate and on nothing else', () => {
    for (const slot of ['P', 'Q', 'W', 'E'] as const) {
      const h = harness();
      h.cast(runtimeOf('2512'), slot);
      expect(h.hasBuff('Opening Barrage'), slot).toBe(false);
    }

    const h = harness();
    h.cast(runtimeOf('2512'), 'R');
    expect(h.hasBuff('Opening Barrage')).toBe(true);
  });

  it('grants the fifty percent attack speed for the window', () => {
    const h = harness();
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.cast(runtimeOf('2512'), 'R');
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(
      baseline + RIOT.fiendhunterBonusAttackSpeed,
      10,
    );
  });

  it('makes the attacks crit for eighty percent of normal critical strike damage', () => {
    const h = harness();
    // The fixture has no crit chance and no crit damage, so the multiplier the
    // item finds is the engine's base one.
    expect(h.ctx.stats.critChance).toBe(0);
    expect(h.ctx.stats.critMultiplier).toBeCloseTo(BASE_CRIT_MULTIPLIER, 10);

    h.cast(runtimeOf('2512'), 'R');

    // Guaranteed: the crit chance is saturated, so the expected-value multiplier
    // the damage step computes *is* the crit multiplier.
    expect(h.ctx.stats.critChance).toBe(1);
    expect(h.ctx.stats.critMultiplier).toBeCloseTo(
      RIOT.fiendhunterCritModifier * BASE_CRIT_MULTIPLIER,
      10,
    );
  });

  it('scales the whole multiplier, so extra crit damage is scaled with it', () => {
    // An Infinity Edge in the same build: DD 3031 lists "30% Critical Strike
    // Damage", which the description parser puts into critDamage. The wiki's own
    // arithmetic for this passive scales that too — "(60% + 24%) bonus damage" is
    // 0.8 × (base + 30%), not 0.8 × base + 30%.
    const h = harness();
    h.equip({ critDamage: 0.3 });
    const normal = h.ctx.stats.critMultiplier;
    expect(normal).toBeCloseTo(BASE_CRIT_MULTIPLIER + 0.3, 10);

    h.cast(runtimeOf('2512'), 'R');
    expect(h.ctx.stats.critMultiplier).toBeCloseTo(RIOT.fiendhunterCritModifier * normal, 10);
  });

  it('empowers exactly three attacks and then stops', () => {
    const h = harness();
    const runtime = runtimeOf('2512');
    const baseline = h.ctx.stats.bonusAttackSpeed;

    h.cast(runtime, 'R');
    for (let i = 0; i < RIOT.fiendhunterAttacks; i += 1) {
      // Still empowered while the attack is being swung — this hook runs after
      // the attack's own damage, so the third attack was a crit too.
      expect(h.hasBuff('Opening Barrage'), `attack ${i + 1}`).toBe(true);
      h.swing(runtime);
    }

    expect(h.hasBuff('Opening Barrage')).toBe(false);
    expect(h.ctx.stats.critChance).toBe(0);
    expect(h.ctx.stats.bonusAttackSpeed).toBeCloseTo(baseline, 10);
    // And the passive adds no damage instance of its own: it works through stats.
    expect(h.instances).toHaveLength(0);
  });

  it('lets the window lapse after eight seconds with attacks unspent', () => {
    const h = harness();
    const runtime = runtimeOf('2512');

    h.cast(runtime, 'R');
    h.swing(runtime);
    h.advance(RIOT.fiendhunterDuration - 0.01);
    expect(h.hasBuff('Opening Barrage')).toBe(true);

    h.advance(0.02);
    expect(h.hasBuff('Opening Barrage')).toBe(false);
    // The two unspent attacks are gone with it, rather than waiting to empower
    // an attack minutes later.
    h.swing(runtime);
    h.swing(runtime);
    expect(h.hasBuff('Opening Barrage')).toBe(false);
    expect(h.ctx.stats.critChance).toBe(0);
  });

  it('holds the forty-five second cooldown between two ultimates', () => {
    const h = harness();
    const runtime = runtimeOf('2512');

    h.cast(runtime, 'R');
    for (let i = 0; i < RIOT.fiendhunterAttacks; i += 1) h.swing(runtime);
    expect(h.hasBuff('Opening Barrage')).toBe(false);

    // Vi's ultimate is off cooldown long before the item is.
    h.advance(RIOT.fiendhunterCooldown - 0.01);
    h.cast(runtime, 'R');
    expect(h.hasBuff('Opening Barrage')).toBe(false);

    h.advance(0.02);
    h.cast(runtime, 'R');
    expect(h.hasBuff('Opening Barrage')).toBe(true);
    expect(h.ctx.stats.critChance).toBe(1);
  });

  it('pays the share that would have crit anyway, instead of warning about it', () => {
    /*
     * The window makes every attack crit at 80% of normal critical damage. An
     * attack that would already have crit is paid differently in game — full
     * crit plus 15% bonus true damage — and this file used to call that
     * unmodellable and warn instead. Crits here are expected values, so the
     * share that took the other branch is simply a weight.
     */
    const plain = harness();
    plain.cast(runtimeOf('2512'), 'R');
    expect(plain.warnings).toEqual([]);

    const critting = harness();
    critting.equip({ critChance: 0.6 });
    const runtime = runtimeOf('2512');
    critting.cast(runtime, 'R');
    const rider = critting.swing(runtime);

    // No warning any more: the number is computed rather than apologised for.
    expect(critting.warnings).toEqual([]);
    // Bin BonusTrueDamage 0.15 on the 60% that already crit, dealt as its own
    // instance so the target's armour cannot eat it.
    const trueHits = critting.instances.filter((entry) => entry.type === 'true');
    expect(trueHits).toHaveLength(1);
    expect(trueHits[0]!.label).toContain('true damage');
    // And the missing fifth of the critical damage, on that same share.
    expect(rider?.type).toBe('physical');
    expect(rider?.amount ?? 0).toBeGreaterThan(0);
  });

  it('names the ultimate ability haste it cannot hold rather than inventing a stat', () => {
    const effect = effectOf('2512');
    // StatBlock has abilityHaste and basicAbilityHaste and nothing for the
    // ultimate alone, so declaring the 30 anywhere would haste Q, W and E too.
    expect(effect.stats).toBeUndefined();
    expect(effect.note).toContain('ultimate ability haste');
  });

  /**
   * The one test in this file that runs the whole engine, because it is the only
   * claim the harness cannot make: that `simulate` reaches `onAbilityCast` with
   * `slot === 'R'` for an equipped item at all. Everything above assumes that
   * hook fires; this proves it, and proves the buff lands on the attack after R
   * rather than one attack late.
   */
  it('reaches the attack after R when the engine drives it', () => {
    const withItem = simulateRAndAttack(['2512']);
    const without = simulateRAndAttack([]);

    // The fixture champion has no crit chance, so without the item the attack
    // has no crit factor at all and the item's whole contribution is the
    // guaranteed 80% critical strike.
    expect(without.crit).toBeCloseTo(1, 10);
    expect(withItem.crit).toBeCloseTo(RIOT.fiendhunterCritModifier * BASE_CRIT_MULTIPLIER, 10);
    expect(withItem.raw).toBeCloseTo(without.raw * RIOT.fiendhunterCritModifier * BASE_CRIT_MULTIPLIER, 6);
  });
});

/**
 * One R and one attack through the real engine, reporting the attack's own
 * damage instance and the crit factor it carried.
 */
function simulateRAndAttack(itemIds: string[]) {
  const bonusStats = emptyStats();
  const result = simulate(
    {
      attacker: {
        championId: 'Vi',
        level: LEVEL,
        ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
        itemIds,
        runeIds: [],
        shardIds: [],
        manualStats: {},
      },
      championBaseStats: FIXTURE_CHAMPION_STATS,
      attackerStats: resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, bonusStats),
      bonusStats,
      target: { ...BASE_TARGET, maxHealth: 100000 },
      combo: [
        { uid: 'r', action: { kind: 'ability', slot: 'R' } },
        { uid: 'a', action: { kind: 'attack' } },
      ],
      timings: { ...DEFAULT_TIMINGS },
      critMode: 'expected',
    },
    VI_MODULE,
    { detail: FIXTURE_CHAMPION, spellById: FIXTURE_SPELLS_BY_ID, gameData: null },
  );

  const attack = result.instances.find((entry) => entry.sourceKind === 'attack');
  expect(attack, 'the combo produced no basic attack').toBeDefined();
  // The crit factor is not reported directly, so it is read back out of the
  // instance's own build breakdown the way the inspector does.
  const base = attack!.build?.find((term) => term.label === 'attack damage')?.amount ?? 0;
  return { raw: attack!.raw, crit: base === 0 ? 0 : attack!.raw / base };
}

/**
 * The Arena Opportunity (226701) earns its place through the mitigation step
 * rather than through an instance of its own, so it is tested there: the stat it
 * declares is fed into the engine's `mitigate` exactly the way `simulate` feeds
 * it (as `flatArmorPen`), and the landed damage is compared against the armour
 * formula with the constant subtracted.
 *
 * The Rift Opportunity (6701) is deliberately not here: Data Dragon ships it
 * `inStore: false` and unpurchasable this patch. The family test below asserts
 * its absence.
 */
describe('Opportunity (Arena 226701)', () => {
  const preparation = RIOT.arenaOpportunityLethality;
  const TARGET_ARMOR = 100;

  /** The stats an attacker has with nothing but this item's Preparation. */
  function statsWithPreparation() {
    const stats = effectOf('226701').stats;
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

  it('declares the 20 lethality as a stat, because no hook runs early enough', () => {
    const effect = effectOf('226701');
    // A hook would arrive after the first hit's damage had been computed, and
    // for Vi that hit is usually the charged Q — so this is a stat on purpose.
    expect(effect.createRuntime).toBeUndefined();
    expect(effect.amplify).toBeUndefined();
    expect(effect.stats).toEqual({ lethality: 20 });
  });

  it('reaches the damage step as flat armor penetration', () => {
    expect(statsWithPreparation().flatArmorPen).toBe(preparation);
  });

  it('turns 20 lethality into the damage the armor formula says it is worth', () => {
    const raw = 200;
    const stats = statsWithPreparation();

    const without = landed(raw, 0);
    const withItem = landed(raw, stats.flatArmorPen);

    // 100 armor halves a hit: 200 × 100/200 = 100 damage.
    expect(without).toBeCloseTo((200 * 100) / (100 + 100), 9);
    expect(without).toBeCloseTo(100, 9);
    // 100 − 20 leaves 100/180 of the hit standing: 200 × 100/180 ≈ 111.1.
    expect(withItem).toBeCloseTo((200 * 100) / (100 + 100 - 20), 9);
    expect(withItem).toBeCloseTo(111.111111111, 6);
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
    h.land(rift, BASE_TARGET.maxHealth * (1 - RIOT.collectorExecuteThreshold / 2));
    expect(h.instances).toHaveLength(1);
    // The target is already empty, so the second one correctly does nothing —
    // which is the guard that a clone shares no state with its original.
    h.land(arena, 0.5);
    expect(h.instances).toHaveLength(1);
  });

  /**
   * The regression that made The Collector a factory: a spread copy of a runtime
   * whose `dealDamage` hardcoded `item:6676` reported the Arena purchase's
   * execute under the Rift item's id, and the timeline and the damage inspector
   * both key on that id.
   */
  it('books each Collector execute under the id it was bought as', () => {
    for (const id of ['6676', '226676']) {
      const h = harness();
      h.land(runtimeOf(id), BASE_TARGET.maxHealth * (1 - RIOT.collectorExecuteThreshold / 2));
      expect(h.instances).toHaveLength(1);
      expect(h.instances[0]!.sourceId, id).toBe(`item:${id}`);
      // The label stays the item's name either way: the id is what disambiguates.
      expect(h.instances[0]!.label).toBe('The Collector · Death');
    }
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
   * Riot writes into passive prose. The Arena Opportunity's Preparation
   * lethality is the one such number left in this family — its 15 base lethality
   * is a stat line and is not repeated, and neither is The Collector's 10.
   */
  it('leaves stat lines to the description parser', () => {
    expect(CRIT_ITEMS.some((item) => item.id === '3031')).toBe(false);

    const withStats = CRIT_ITEMS.filter((item) => item.stats);
    expect(withStats.map((item) => item.id)).toEqual(['226701']);
    expect(Object.keys(withStats[0]!.stats!)).toEqual(['lethality']);
  });

  /**
   * The ids are the part most easily got wrong, because four of this family's
   * items moved: Stormrazor is 3097 and 3095 is Riot's disabled shell, Yun Tal
   * is 3032 and 6673 is Immortal Shieldbow, 6675 is Navori Flickerblade whose
   * cooldown passive nothing here can express, and 6701 Opportunity is off the
   * shelf entirely — Data Dragon ships it `inStore: false` with
   * `gold.purchasable` false, so a passive on it could never apply to a build
   * anyone can buy. Its live counterpart is the Arena 226701.
   */
  it('keys the items on the ids that are still live', () => {
    const ids = CRIT_ITEMS.map((item) => item.id);
    expect(ids).toContain('3097');
    expect(ids).not.toContain('3095');
    expect(ids).toContain('3032');
    expect(ids).not.toContain('6673');
    expect(ids).not.toContain('6675');
    expect(ids).not.toContain('6701');
    expect(ids).toContain('226701');
    // The two Rift items this review added and dismissed, respectively.
    expect(ids).toContain('2512');
    expect(ids).not.toContain('2523');
  });
});
