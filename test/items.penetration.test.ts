import { describe, expect, it } from 'vitest';
import { resistanceMultiplier } from '../src/engine/damage';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS,
  type ComboStep,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { PENETRATION_CONSTANTS, PENETRATION_ITEMS } from '../src/model/items/penetration';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/*
 * These run against the real registry: this family is wired into
 * `src/model/itemEffects.ts`, so the engine finds the effects on its own. The
 * suite used to widen the registry with a module mock, which is what a family
 * needs *before* it is registered — leaving it in place afterwards applied every
 * effect twice and squared every amplifier.
 *
 * Every number this suite expects is written as arithmetic on Riot's own
 * literals, with the `mDataValues` entry or Data Dragon line it came from named
 * in a comment. Comparing the runtime's output against the same constant the
 * runtime read would pass for any value at all, including a wrong one — the
 * failure these tests exist to catch is precisely a constant that has drifted
 * from Riot's data, so the constants are pinned to literals as well.
 */

const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

/** Nothing may die: these tests are about multipliers, not about kill times. */
const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 100000,
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

const LEVEL = 11;

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `p${uid}`, action }
    : { uid: `p${uid}`, action, chargeSeconds };
}

function attacks(count: number): ComboStep[] {
  return Array.from({ length: count }, () => step({ kind: 'attack' }));
}

interface RunOptions {
  itemIds?: string[];
  bonus?: Partial<StatBlock>;
  target?: Partial<TargetConfig>;
}

function run(combo: ComboStep[], options: RunOptions = {}) {
  const bonusStats = { ...emptyStats(), ...options.bonus };
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: LEVEL,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds: options.itemIds ?? [],
      runeIds: [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: stats,
    bonusStats,
    target: { ...TARGET, ...options.target },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'never',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

type Result = ReturnType<typeof run>;

function fromItem(result: Result, id: string): Result['instances'] {
  return result.instances.filter((instance) => instance.sourceId === `item:${id}`);
}

function attackDamage(result: Result): number {
  const attack = result.instances.find((instance) => instance.sourceId === 'AA');
  if (!attack) throw new Error('the combo produced no basic attack');
  return attack.mitigated;
}

function basicAttacks(result: Result): Result['instances'] {
  return result.instances.filter((instance) => instance.sourceId === 'AA');
}

function lastSnapshot(result: Result): Result['snapshots'][number] {
  const snapshot = result.snapshots[result.snapshots.length - 1];
  if (!snapshot) throw new Error('the simulation produced no snapshot');
  return snapshot;
}

/** Vi's own maximum health, which two of these passives are measured against. */
function viMaxHealth(bonus: Partial<StatBlock> = {}): number {
  return resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, { ...emptyStats(), ...bonus })
    .maxHealth;
}

/** Nashor's Tooth is the magic-damage source the amplifier tests measure. */
const NASHORS = '3115';

describe('Terminus', () => {
  const numbers = PENETRATION_CONSTANTS.terminus;
  const BONUS_AD = 100;
  const ABILITY_POWER = 50;
  /*
   * `Items/3302` → `mItemCalculations.OnHitDamage`: 30, plus 0.1 on
   * `mStat: 2 / mStatFormula: 2` (bonus AD), plus 0.1 on the part with no
   * `mStat` (ability power). Written as literals so a drifted constant fails
   * here rather than agreeing with itself.
   */
  const shadowDamage = 30 + 0.1 * BONUS_AD + 0.1 * ABILITY_POWER;

  const withTerminus = (
    id: string,
    combo: ComboStep[],
    target: Partial<TargetConfig> = {},
    bonus: Partial<StatBlock> = {},
  ) =>
    run(combo, {
      itemIds: [id],
      bonus: { attackDamage: BONUS_AD, abilityPower: ABILITY_POWER, ...bonus },
      target,
    });

  it("carries Riot's own numbers for both halves", () => {
    // Items/3302 mDataValues: PenPerHit 0.1, PenMax 0.3, BuffDuration 5.
    expect(numbers.summonersRift.penPerDarkHit).toBe(0.1);
    expect(numbers.summonersRift.penCap).toBe(0.3);
    // Items/223302 mDataValues: PenPerHit 0.08, PenMax 0.24.
    expect(numbers.arena.penPerDarkHit).toBe(0.08);
    expect(numbers.arena.penCap).toBe(0.24);
    expect(numbers.buffSeconds).toBe(5);
    // The three parts of OnHitDamage.
    expect(numbers.onHitFlat).toBe(30);
    expect(numbers.onHitBonusAdRatio).toBe(0.1);
    expect(numbers.onHitAbilityPowerRatio).toBe(0.1);
  });

  it('rides every basic attack with 30 plus 10% bonus AD plus 10% AP as magic damage', () => {
    const result = withTerminus(numbers.summonersRift.id, attacks(3));
    const riders = fromItem(result, numbers.summonersRift.id);

    expect(riders).toHaveLength(3);
    for (const rider of riders) {
      expect(rider.type).toBe('magic');
      // The target has no magic resistance, so what was rolled is what landed.
      expect(rider.raw).toBeCloseTo(shadowDamage, 6);
      expect(rider.mitigated).toBeCloseTo(shadowDamage, 6);
    }
    // 30 + 10 + 5, spelled out once so the arithmetic above is not the only
    // statement of what the number is.
    expect(shadowDamage).toBe(45);
  });

  /**
   * The whole point of Juxtaposition: the fourth attack of a combo meets less
   * magic resistance than the first, and the second attack is where that starts.
   */
  it('penetrates on every second attack and stacks the penetration', () => {
    const magicResist = 60;
    const result = withTerminus(numbers.summonersRift.id, attacks(4), { magicResist });
    const riders = fromItem(result, numbers.summonersRift.id);
    const landedAgainst = (penetration: number) =>
      shadowDamage * resistanceMultiplier(magicResist * (1 - penetration));

    expect(riders).toHaveLength(4);
    // The first attack is Light, so it meets the full 60 magic resistance.
    expect(riders[0]!.mitigated).toBeCloseTo(landedAgainst(0), 6);
    // The second is Dark. Its own Shadow rider already benefits, because the
    // engine resolves the attack's damage before it asks items for riders.
    // 0.1 is Riot's PenPerHit, written out rather than read back.
    expect(riders[1]!.mitigated).toBeCloseTo(landedAgainst(0.1), 6);
    // The third is Light again and rides the still-live first stack.
    expect(riders[2]!.mitigated).toBeCloseTo(landedAgainst(0.1), 6);
    // The fourth is Dark: two stacks.
    expect(riders[3]!.mitigated).toBeCloseTo(landedAgainst(0.2), 6);
  });

  it('applies the penetration to physical damage as well, not only to its own rider', () => {
    const armor = 80;
    const result = withTerminus(numbers.summonersRift.id, attacks(3), { armor });
    const attacksLanded = basicAttacks(result);
    const share = (index: number) =>
      attacksLanded[index]!.mitigated / attacksLanded[index]!.raw;

    expect(attacksLanded).toHaveLength(3);
    expect(share(0)).toBeCloseTo(resistanceMultiplier(armor), 6);
    // The second attack grants the first stack only after its own damage, so the
    // third attack is the first one to land into reduced armour.
    expect(share(1)).toBeCloseTo(resistanceMultiplier(armor), 6);
    expect(share(2)).toBeCloseTo(resistanceMultiplier(80 * (1 - 0.1)), 6);
  });

  it('stops stacking at the cap Riot puts on it', () => {
    const magicResist = 60;
    const snapshot = lastSnapshot(
      withTerminus(numbers.summonersRift.id, attacks(8), { magicResist }),
    );

    // Eight attacks are four Dark ones: 40% unclamped, and PenMax is 0.3.
    expect(snapshot.attacker.armorPenPercent).toBeCloseTo(0.3, 6);
    expect(snapshot.attacker.magicPenPercent).toBeCloseTo(0.3, 6);
    expect(snapshot.target.effectiveMagicResist).toBeCloseTo(60 * (1 - 0.3), 6);
  });

  /** "Alternate between Light and Dark Attacks against champions." */
  it('grants no penetration against a monster, but still deals its on-hit damage', () => {
    const result = withTerminus(numbers.summonersRift.id, attacks(4), { unitType: 'monster' });

    expect(fromItem(result, numbers.summonersRift.id)).toHaveLength(4);
    expect(lastSnapshot(result).attacker.armorPenPercent).toBe(0);
    expect(lastSnapshot(result).attacker.magicPenPercent).toBe(0);
  });

  /** The Arena copy is the same passive with Riot's weaker numbers. */
  it('uses the Arena variant own 8% per attack and 24% cap', () => {
    const afterTwo = lastSnapshot(withTerminus(numbers.arena.id, attacks(2)));
    const afterTen = lastSnapshot(withTerminus(numbers.arena.id, attacks(10)));

    // Items/223302: PenPerHit 0.08, PenMax 0.24.
    expect(afterTwo.attacker.armorPenPercent).toBeCloseTo(0.08, 6);
    expect(afterTen.attacker.armorPenPercent).toBeCloseTo(0.24, 6);
  });

  /**
   * The claim the module header makes about the stat pipeline, pinned.
   *
   * Terminus is the first thing in the codebase to write percent penetration in
   * dynamically, so "two sources compose the way the game composes them" stops
   * being a property of one item and becomes a property of `sumStats`. It keeps
   * `armorPenPercent` in `MULTIPLICATIVE_STATS` and composes as `1 − Π(1 − v)`,
   * so Terminus's one Dark stack on top of a 35% stat line leaves
   * (1 − 0.10)(1 − 0.35) = 58.5% of the armour standing — not the 55% an
   * addition would leave.
   */
  it('composes its penetration with another source multiplicatively, as the game does', () => {
    const armor = 100;
    // 35% is Serylda's Grudge's stat line, entered by hand because the harness
    // supplies bonus stats itself rather than reading them off the items.
    const snapshot = lastSnapshot(
      withTerminus(numbers.summonersRift.id, attacks(2), { armor }, { armorPenPercent: 0.35 }),
    );

    expect(snapshot.target.effectiveArmor).toBeCloseTo(100 * (1 - 0.1) * (1 - 0.35), 6);
    // And emphatically not the sum, which would be 45% penetration.
    expect(snapshot.target.effectiveArmor).not.toBeCloseTo(100 * (1 - 0.45), 3);
  });
});

describe('Abyssal Mask', () => {
  const numbers = PENETRATION_CONSTANTS.abyssalMask;
  const [PRIMARY] = numbers.ids;

  const withAndWithout = (id: string, target: Partial<TargetConfig> = {}) => {
    const bare = run(attacks(1), { itemIds: [NASHORS], target });
    const masked = run(attacks(1), { itemIds: [NASHORS, id], target });
    const magic = (result: Result) => {
      const rider = fromItem(result, NASHORS)[0];
      if (!rider) throw new Error("Nashor's Tooth produced no magic damage");
      return rider.mitigated;
    };
    expect(magic(bare)).toBeGreaterThan(0);
    return {
      magicRatio: magic(masked) / magic(bare),
      physicalRatio: attackDamage(masked) / attackDamage(bare),
    };
  };

  it("carries Riot's own numbers", () => {
    // Items/8020 mDataValues: DamageAmp 0.12, Radius 700.
    expect(numbers.amplification).toBe(0.12);
    expect(numbers.radius).toBe(700);
  });

  it('raises magic damage by 12%', () => {
    expect(withAndWithout(PRIMARY!).magicRatio).toBeCloseTo(1.12, 6);
  });

  it('leaves the physical attack it was bought alongside untouched', () => {
    expect(withAndWithout(PRIMARY!).physicalRatio).toBeCloseTo(1, 6);
  });

  it('does not reach a monster, because Unmake names champions', () => {
    expect(withAndWithout(PRIMARY!, { unitType: 'monster' }).magicRatio).toBeCloseTo(1, 6);
  });

  /** All three ids Data Dragon ships carry the same `DamageAmp`. */
  it('behaves identically under each of the ids Riot ships it as', () => {
    for (const id of numbers.ids) {
      expect(withAndWithout(id).magicRatio).toBeCloseTo(1.12, 6);
    }
  });
});

describe('Unending Despair', () => {
  const numbers = PENETRATION_CONSTANTS.unendingDespair;
  /*
   * Items/2502 `DrainCalc`: `BonusHealthDrainPercentage` 0.03 on
   * `mStat: 12 / mStatFormula: 2`, the wearer's *bonus* health. 1000 bonus
   * health is therefore a 30 damage tick, and the assertions below say 30 in
   * Riot's own arithmetic rather than reading the ratio back out of the module.
   */
  const BONUS_HEALTH = 1000;

  const despair = (id: string, combo: ComboStep[], target: Partial<TargetConfig> = {}) =>
    run(combo, { itemIds: [id], bonus: { hp: BONUS_HEALTH }, target });

  /**
   * Four seconds of *continuous* combat, which is what Anguish asks for.
   *
   * The gaps are deliberately shorter than `outOfCombatSeconds`: an interval
   * crossed by waiting longer than the combat window in one go is a lapse the
   * game would have dropped combat in, so a passing case must not depend on one.
   * Two waits of 2 s plus the attack windups add up to well past 4 s while no
   * single gap between hits comes close to it.
   */
  const acrossTheInterval = () => [
    step({ kind: 'attack' }),
    step({ kind: 'wait', seconds: 2 }),
    step({ kind: 'attack' }),
    step({ kind: 'wait', seconds: 2 }),
    step({ kind: 'attack' }),
  ];

  it("carries Riot's own numbers", () => {
    // Items/2502 mDataValues: Cooldown 4, BonusHealthDrainPercentage 0.03,
    // HealMultiplier 2.5, DrainRange 650.
    expect(numbers.intervalSeconds).toBe(4);
    expect(numbers.bonusHealthRatio).toBe(0.03);
    expect(numbers.healMultiplier).toBe(2.5);
    expect(numbers.radius).toBe(650);
    // Items/222502 DrainCalc: ByCharLevelInterpolation 15 → 25.
    expect(numbers.arena.flatAtLevel1).toBe(15);
    expect(numbers.arena.flatAtLevel18).toBe(25);
    /*
     * The one assumption in the file. Items/2502 ships no combat window;
     * Items/4633 (Riftmaker) ships SecondsInCombat 4 for the same idea, which is
     * where this comes from. Pinned so changing it is a decision.
     */
    expect(numbers.outOfCombatSeconds).toBe(4);
  });

  it('ticks for 3% of bonus health once the interval has passed', () => {
    const id = numbers.summonersRift.id;
    const ticks = fromItem(despair(id, acrossTheInterval()), id);

    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.type).toBe('magic');
    // 0.03 × 1000 bonus health = 30, against a target with no magic resistance.
    expect(ticks[0]!.mitigated).toBeCloseTo(30, 6);
    expect(ticks[0]!.time).toBeGreaterThanOrEqual(4);
  });

  it('does not tick the moment combat starts', () => {
    const id = numbers.summonersRift.id;
    expect(fromItem(despair(id, attacks(1)), id)).toHaveLength(0);
  });

  it('keeps one interval between two ticks', () => {
    const id = numbers.summonersRift.id;
    const ticks = fromItem(despair(id, [...acrossTheInterval(), ...acrossTheInterval()]), id);

    expect(ticks).toHaveLength(2);
    expect(ticks[1]!.time - ticks[0]!.time).toBeGreaterThanOrEqual(4);
  });

  /**
   * The reason the runtime remembers the last hit as well as the next tick.
   *
   * A hit landing after a ten-second idle stretch must not cash in a timer armed
   * before it: the game drops combat, and Riot's text is "every 4 seconds *while
   * in combat*". Without the re-arm this produced a tick the instant the second
   * attack landed, ten seconds after the only thing that had armed the counter.
   */
  it('drops combat over a long idle stretch instead of banking the interval', () => {
    const id = numbers.summonersRift.id;
    const idle = [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 10 }),
      step({ kind: 'attack' }),
    ];

    expect(fromItem(despair(id, idle), id)).toHaveLength(0);
  });

  it('measures the fresh interval from the hit that re-entered combat', () => {
    const id = numbers.summonersRift.id;
    const reentry = [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 10 }),
      // Combat starts again here, at roughly t = 11.
      ...acrossTheInterval(),
    ];
    const ticks = fromItem(despair(id, reentry), id);

    expect(ticks).toHaveLength(1);
    // Four seconds after the re-entry, not four seconds after the first attack:
    // a tick counted from t = 0 would have landed at the re-entry itself, ~t=11.
    expect(ticks[0]!.time).toBeGreaterThan(14);
  });

  it('does not tick against a monster: Anguish names champions', () => {
    const id = numbers.summonersRift.id;
    expect(fromItem(despair(id, acrossTheInterval(), { unitType: 'monster' }), id)).toHaveLength(
      0,
    );
  });

  /**
   * The Arena copy adds a flat part interpolated over the champion's level. The
   * expected value is Riot's own interpolation written out on literals — 15 at
   * level 1 to 25 at level 18, evaluated at level 11.
   */
  it('adds the Arena variant level-scaled base on top of the health part', () => {
    const base = 15 + ((25 - 15) * (11 - 1)) / 17;
    const ticks = fromItem(despair(numbers.arena.id, acrossTheInterval()), numbers.arena.id);

    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.mitigated).toBeCloseTo(base + 30, 6);
    // Strictly more than the Rift item, which has no flat part at all.
    expect(ticks[0]!.mitigated).toBeGreaterThan(30);
  });
});

describe("Serylda's Grudge", () => {
  const numbers = PENETRATION_CONSTANTS.seryldasGrudge;

  const grudge = (id: string, currentHealthPercent: number, combo = [step({ kind: 'ability', slot: 'Q' }, 0)]) =>
    run(combo, { itemIds: [id], target: { currentHealthPercent } });
  const slows = (result: Result) =>
    result.spans.filter((span) => span.lane === 'cc' && span.label === 'Slowed');

  it("carries Riot's own numbers", () => {
    // Items/6694 mDataValues: SlowAmount 0.3, SlowDuration 1, SlowThreshold 0.5.
    expect(numbers.summonersRift.slowPercent).toBe(0.3);
    expect(numbers.slowSeconds).toBe(1);
    expect(numbers.healthThreshold).toBe(0.5);
    // Items/226694 mDataValues: SlowAmount 0.5, same threshold and duration.
    expect(numbers.arena.slowPercent).toBe(0.5);
  });

  it('slows a target below half health for one second, and adds no damage', () => {
    const { id } = numbers.summonersRift;
    const result = grudge(id, 0.4);
    const slow = slows(result);

    expect(slow).toHaveLength(1);
    expect(slow[0]!.fullSeconds).toBeCloseTo(1, 6);
    // "Slow enemies below 50% Health by 30% for 1 second" — Data Dragon, 6694.
    expect(slow[0]!.detail).toContain('30% slow');
    // Bitter Cold is a slow and nothing else: no instance may come from it.
    expect(fromItem(result, id)).toHaveLength(0);
  });

  it('leaves a healthy target alone', () => {
    expect(slows(grudge(numbers.summonersRift.id, 1))).toHaveLength(0);
  });

  /**
   * The threshold is read *after* the hit, which is the assumption the module
   * documents: a target standing at exactly 50% is taken across it by the very
   * ability that checks, so it slows immediately rather than on the next cast.
   */
  it('slows on the ability that takes the target across the threshold', () => {
    expect(slows(grudge(numbers.summonersRift.id, 0.5))).toHaveLength(1);
  });

  it('does not fire on a basic attack, because Bitter Cold names abilities', () => {
    const result = grudge(numbers.summonersRift.id, 0.4, attacks(2));
    expect(slows(result)).toHaveLength(0);
  });

  it('slows harder under the Arena variant number', () => {
    const slow = slows(grudge(numbers.arena.id, 0.4));

    expect(slow).toHaveLength(1);
    // "by 50% for 1 second" — Data Dragon, 226694.
    expect(slow[0]!.detail).toContain('50% slow');
  });
});

describe('Flesheater', () => {
  const numbers = PENETRATION_CONSTANTS.flesheater;
  const ARMOR = 100;

  const shredding = (id: string, combo: ComboStep[], target: Partial<TargetConfig> = {}) =>
    run(combo, { itemIds: [id], target: { armor: ARMOR, ...target } });

  /**
   * How much of the target's armour is left, as a fraction of what the same
   * combo leaves without the item.
   *
   * The comparison run is what makes this readable: Vi's own Denting Blows takes
   * a percentage off the same armour pool, so the absolute figure is not 100
   * minus the shred. A ratio cancels the percentage — `currentArmor` is
   * `(base − flat) × (1 − percent)` — and leaves exactly `(100 − flat) / 100`.
   *
   * `hits` is the number of damage instances the run produced, which is the
   * number of stacks applied: Denting Blows' own damage instance counts, so five
   * attacks are six stacks, not five.
   */
  const armourLeft = (id: string, combo: ComboStep[]) => {
    const withItem = run(combo, { itemIds: [id], target: { armor: ARMOR } });
    const withoutItem = run(combo, { itemIds: [], target: { armor: ARMOR } });
    return {
      ratio:
        lastSnapshot(withItem).target.currentArmor /
        lastSnapshot(withoutItem).target.currentArmor,
      hits: withItem.instances.length,
    };
  };

  it("carries Riot's own numbers", () => {
    /*
     * Items/667112 mDataValues: Shred 3, MaxStacks 10, ShredStackTime 5,
     * ShredInternalCD 1 — and Items/447112 ships the identical four. Data
     * Dragon's text for both: "Dealing damage shreds 3 Armor and Magic Resist
     * for 5 seconds, stacking up to 10 times. Applying stacks has a 1 second
     * cooldown per Ability."
     */
    expect(numbers.shredPerStack).toBe(3);
    expect(numbers.maxStacks).toBe(10);
    expect(numbers.stackSeconds).toBe(5);
    expect(numbers.internalCooldownSeconds).toBe(1);
    // 667112 is the Summoner's Rift item (maps["11"] === true, 2500 gold);
    // 447112 is the Arena copy (maps["30"] === true, 2750 gold).
    expect(numbers.summonersRift.id).toBe('667112');
    expect(numbers.arena.id).toBe('447112');
  });

  it('takes 3 flat armour off the target per hit, growing with the stacks', () => {
    const landed = basicAttacks(shredding(numbers.summonersRift.id, attacks(3)));
    const share = (index: number) => landed[index]!.mitigated / landed[index]!.raw;

    expect(landed).toHaveLength(3);
    // The first attack applies the first stack only after its own damage.
    expect(share(0)).toBeCloseTo(resistanceMultiplier(100), 6);
    expect(share(1)).toBeCloseTo(resistanceMultiplier(100 - 3), 6);
    expect(share(2)).toBeCloseTo(resistanceMultiplier(100 - 6), 6);
  });

  it('stops at ten stacks, which is 30 armour', () => {
    // Twelve attacks land more than ten damage instances, so the cap is the only
    // thing that can hold the shred at 3 × 10.
    const { ratio, hits } = armourLeft(numbers.summonersRift.id, attacks(12));

    expect(hits).toBeGreaterThan(10);
    expect(ratio).toBeCloseTo((100 - 3 * 10) / 100, 6);
  });

  it('shreds the running total once rather than once per stack level', () => {
    /*
     * The trap this guards: `combinedShred()` *adds* the flat part of every live
     * shred entry, and `applyArmorShred` keys entries by label. A per-stack
     * label — the shape Black Cleaver uses for its percentages — would leave six
     * live entries after six stacks, 3 + 6 + 9 + 12 + 15 + 18 = 63 armour
     * instead of the running total of 18.
     */
    const { ratio, hits } = armourLeft(numbers.summonersRift.id, attacks(5));

    // Below the cap, so the number under test is the running total itself.
    expect(hits).toBeLessThan(10);
    expect(ratio).toBeCloseTo((100 - 3 * hits) / 100, 6);
  });

  it('lets the shred expire after five seconds and starts again from one stack', () => {
    const combo = [
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      // Longer than ShredStackTime, so nothing of the two stacks survives.
      step({ kind: 'wait', seconds: 6 }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ];
    const landed = basicAttacks(shredding(numbers.summonersRift.id, combo));
    const share = (index: number) => landed[index]!.mitigated / landed[index]!.raw;

    expect(landed).toHaveLength(4);
    expect(share(1)).toBeCloseTo(resistanceMultiplier(100 - 3), 6);
    // Back to full armour: the window ran out and the stacks went with it.
    expect(share(2)).toBeCloseTo(resistanceMultiplier(100), 6);
    // And the count restarted at one rather than resuming at three.
    expect(share(3)).toBeCloseTo(resistanceMultiplier(100 - 3), 6);
  });

  it('shreds against a monster too, because "dealing damage" names no unit type', () => {
    const landed = basicAttacks(
      shredding(numbers.summonersRift.id, attacks(2), { unitType: 'monster' }),
    );
    expect(landed[1]!.mitigated / landed[1]!.raw).toBeCloseTo(resistanceMultiplier(100 - 3), 6);
  });

  it('leaves magic damage alone, because the engine has no magic-resist reduction', () => {
    /*
     * Not a feature — the half of Hack the Meat the engine cannot express.
     * `applyDamage` builds the magic-resist input with `flatReduction: 0`, so
     * the equal 3 magic resist per stack goes nowhere. Asserted so that the day
     * a magic-resist reduction slot appears, this test is what points at the
     * item that has been waiting for it.
     */
    const withItem = run(attacks(3), {
      itemIds: [NASHORS, numbers.summonersRift.id],
      target: { magicResist: 100 },
    });
    const withoutItem = run(attacks(3), { itemIds: [NASHORS], target: { magicResist: 100 } });
    const lastMagic = (result: Result) => {
      const riders = fromItem(result, NASHORS);
      return riders[riders.length - 1]!.mitigated;
    };

    expect(lastMagic(withItem)).toBeCloseTo(lastMagic(withoutItem), 6);
  });

  it('behaves identically under the Arena copy, which ships the same four values', () => {
    const landed = basicAttacks(shredding(numbers.arena.id, attacks(3)));
    const share = (index: number) => landed[index]!.mitigated / landed[index]!.raw;

    expect(share(1)).toBeCloseTo(resistanceMultiplier(100 - 3), 6);
    expect(share(2)).toBeCloseTo(resistanceMultiplier(100 - 6), 6);
  });
});

describe('Perplexity', () => {
  const numbers = PENETRATION_CONSTANTS.perplexity;

  /** Both damage types in one combo: the attack, and a magic on-hit rider. */
  const ratios = (target: Partial<TargetConfig>) => {
    const bare = run(attacks(1), { itemIds: [NASHORS], target });
    const slaying = run(attacks(1), { itemIds: [NASHORS, numbers.id], target });
    const magic = (result: Result) => {
      const rider = fromItem(result, NASHORS)[0];
      if (!rider) throw new Error("Nashor's Tooth produced no magic damage");
      return rider.mitigated;
    };
    return {
      physical: attackDamage(slaying) / attackDamage(bare),
      magic: magic(slaying) / magic(bare),
    };
  };

  it("carries Riot's own numbers", () => {
    /*
     * Items/4015 mDataValues: MaxBonusDamagePercent 0.15,
     * MaxHealthDifference 3000. Data Dragon's text for 4015: "Deal up to 15%
     * bonus damage against champions with greater max Health than you. Max
     * damage increase reached when Health difference is greater than 3000."
     * Not Lord Dominik's numbers: Items/3036 reads MaxBonusHealth 1500 on the
     * target's *bonus* health, which is a different pool.
     */
    expect(numbers.maxBonusDamagePercent).toBe(0.15);
    expect(numbers.maxHealthDifference).toBe(3000);
  });

  it('reaches its cap against a champion far above Vi maximum health', () => {
    const maxHealth = viMaxHealth() + 3000 * 2;
    const both = ratios({ maxHealth });

    expect(both.physical).toBeCloseTo(1.15, 6);
    // Riot puts no damage type on Giant Slayer, so the magic on-hit scales too.
    expect(both.magic).toBeCloseTo(1.15, 6);
  });

  it('ramps linearly with the health difference', () => {
    const ratio = ratios({ maxHealth: viMaxHealth() + 3000 / 2 }).physical;
    expect(ratio).toBeCloseTo(1 + 0.15 / 2, 6);
  });

  it('gives nothing against a champion Vi out-sizes', () => {
    const equal = ratios({ maxHealth: viMaxHealth() });
    const smaller = ratios({ maxHealth: viMaxHealth() - 400 });

    expect(equal.physical).toBeCloseTo(1, 6);
    expect(smaller.physical).toBeCloseTo(1, 6);
  });

  it('measures against Vi own health, so her own bonus health shrinks the bonus', () => {
    const bonus = { hp: 1000 };
    const maxHealth = viMaxHealth() + 3000;
    const bare = run(attacks(1), { bonus, target: { maxHealth } });
    const slaying = run(attacks(1), { itemIds: [numbers.id], bonus, target: { maxHealth } });
    // Vi's own 1000 bonus health eats a third of the 3000 difference.
    const expected = ((3000 - 1000) / 3000) * 0.15;

    expect(attackDamage(slaying) / attackDamage(bare)).toBeCloseTo(1 + expected, 6);
  });

  it('gives nothing against a monster, however large', () => {
    const target = { maxHealth: viMaxHealth() + 20000, unitType: 'monster' as const };
    expect(ratios(target).physical).toBeCloseTo(1, 6);
  });
});

/**
 * The omissions are decisions, so they are asserted rather than left implied.
 * The reasoning for each one is in the skip list at the bottom of
 * `src/model/items/penetration.ts`; what is checked here is only that no entry
 * has quietly appeared for an item whose penetration is already a parsed stat
 * line, or for one whose passive the engine still cannot reach.
 */
describe('what this family deliberately leaves out', () => {
  const ids = PENETRATION_ITEMS.map((effect) => effect.id);

  it('holds no item whose penetration is already a parsed stat line', () => {
    // 3035 Last Whisper, 3033 Mortal Reminder, 3135 Void Staff, 3137 Cryptbloom,
    // 6695 Serpent's Fang: <stats> lines items.ts already parses. 8010/4010
    // Bloodletter's Curse needs a magic-resist shred slot the engine lacks.
    for (const id of ['3035', '3033', '3135', '3137', '6695', '8010', '4010']) {
      expect(ids).not.toContain(id);
    }
  });

  it('leaves the items another family owns to that family', () => {
    // 3036 lives in itemEffects.ts, 4645 Shadowflame in items/ability.ts. A
    // second entry here would double the amplifier through the registry.
    for (const id of ['3036', '4645']) {
      expect(ids).not.toContain(id);
    }
  });

  it('declares no stat that Data Dragon already parses out of the stats block', () => {
    for (const effect of PENETRATION_ITEMS) {
      expect(effect.stats).toBeUndefined();
    }
  });

  it('declares every entry as modelled, with a note and a hook that does the work', () => {
    for (const effect of PENETRATION_ITEMS) {
      expect(effect.modelled).toBe(true);
      expect(effect.note.length).toBeGreaterThan(20);
      expect(Boolean(effect.amplify) || Boolean(effect.createRuntime)).toBe(true);
    }
  });

  /**
   * The reachability policy, enforced rather than described.
   *
   * Every id in this family that Data Dragon 16.16.1 ships with
   * `maps["11"] === false` — the Arena copies and Perplexity — is modelled
   * anyway, and each one has to say so in its own note, because a reader who
   * finds the entry while chasing a number will not have read the header.
   */
  it('says in its own note when the shop cannot offer the item', () => {
    const offRift = ['223302', '228020', '222502', '226694', '447112', '4015'];
    for (const id of offRift) {
      const effect = PENETRATION_ITEMS.find((entry) => entry.id === id);
      expect(effect, `${id} is not registered at all`).toBeDefined();
      expect(effect!.note, id).toContain('maps["11"] === false');
    }
    // And the Rift ids must not carry that sentence.
    for (const id of ['3302', '8020', '328020', '2502', '6694', '667112']) {
      const effect = PENETRATION_ITEMS.find((entry) => entry.id === id);
      expect(effect, `${id} is not registered at all`).toBeDefined();
      expect(effect!.note, id).not.toContain('maps["11"] === false');
    }
  });

  it('registers each id exactly once', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
});
