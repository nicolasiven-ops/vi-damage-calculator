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
  const shadowDamage =
    numbers.onHitFlat +
    numbers.onHitBonusAdRatio * BONUS_AD +
    numbers.onHitAbilityPowerRatio * ABILITY_POWER;

  const withTerminus = (id: string, combo: ComboStep[], target: Partial<TargetConfig> = {}) =>
    run(combo, {
      itemIds: [id],
      bonus: { attackDamage: BONUS_AD, abilityPower: ABILITY_POWER },
      target,
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
    const perHit = numbers.summonersRift.penPerDarkHit;

    expect(riders).toHaveLength(4);
    // The first attack is Light, so it meets the full 60 magic resistance.
    expect(riders[0]!.mitigated).toBeCloseTo(landedAgainst(0), 6);
    // The second is Dark. Its own Shadow rider already benefits, because the
    // engine resolves the attack's damage before it asks items for riders.
    expect(riders[1]!.mitigated).toBeCloseTo(landedAgainst(perHit), 6);
    // The third is Light again and rides the still-live first stack.
    expect(riders[2]!.mitigated).toBeCloseTo(landedAgainst(perHit), 6);
    // The fourth is Dark: two stacks.
    expect(riders[3]!.mitigated).toBeCloseTo(landedAgainst(2 * perHit), 6);
  });

  it('applies the penetration to physical damage as well, not only to its own rider', () => {
    const armor = 80;
    const result = withTerminus(numbers.summonersRift.id, attacks(3), { armor });
    const attacksLanded = result.instances.filter((instance) => instance.sourceId === 'AA');
    const perHit = numbers.summonersRift.penPerDarkHit;
    const share = (index: number) =>
      attacksLanded[index]!.mitigated / attacksLanded[index]!.raw;

    expect(attacksLanded).toHaveLength(3);
    expect(share(0)).toBeCloseTo(resistanceMultiplier(armor), 6);
    // The second attack grants the first stack only after its own damage, so the
    // third attack is the first one to land into reduced armour.
    expect(share(1)).toBeCloseTo(resistanceMultiplier(armor), 6);
    expect(share(2)).toBeCloseTo(resistanceMultiplier(armor * (1 - perHit)), 6);
  });

  it('stops stacking at the cap Riot puts on it', () => {
    const magicResist = 60;
    // Eight attacks are four Dark ones, one more than the cap allows for.
    const darkAttacks = 4;
    const { penPerDarkHit, penCap } = numbers.summonersRift;
    const snapshot = lastSnapshot(
      withTerminus(numbers.summonersRift.id, attacks(8), { magicResist }),
    );

    // The clamp has to have done something: four Dark attacks unclamped would be
    // 40% penetration, and this assertion is what fails if the `Math.min` goes.
    expect(snapshot.attacker.armorPenPercent).toBeLessThan(darkAttacks * penPerDarkHit);
    expect(snapshot.attacker.armorPenPercent).toBeCloseTo(penCap, 6);
    expect(snapshot.attacker.magicPenPercent).toBeCloseTo(penCap, 6);
    expect(snapshot.target.effectiveMagicResist).toBeCloseTo(magicResist * (1 - penCap), 6);
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
    const { id, penPerDarkHit, penCap } = numbers.arena;
    const afterTwo = lastSnapshot(withTerminus(id, attacks(2)));
    const afterTen = lastSnapshot(withTerminus(id, attacks(10)));

    expect(afterTwo.attacker.armorPenPercent).toBeCloseTo(penPerDarkHit, 6);
    expect(afterTen.attacker.armorPenPercent).toBeCloseTo(penCap, 6);
    // And it is genuinely a different item from the Rift one.
    expect(penCap).toBeLessThan(numbers.summonersRift.penCap);
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

  it('raises magic damage by 12%', () => {
    expect(withAndWithout(PRIMARY!).magicRatio).toBeCloseTo(1 + numbers.amplification, 6);
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
      expect(withAndWithout(id).magicRatio).toBeCloseTo(1 + numbers.amplification, 6);
    }
  });
});

describe('Unending Despair', () => {
  const numbers = PENETRATION_CONSTANTS.unendingDespair;
  const BONUS_HEALTH = 1000;
  const fromBonusHealth = numbers.bonusHealthRatio * BONUS_HEALTH;

  const despair = (id: string, combo: ComboStep[], target: Partial<TargetConfig> = {}) =>
    run(combo, { itemIds: [id], bonus: { hp: BONUS_HEALTH }, target });

  /** Long enough that the interval has to have passed by the second attack. */
  const acrossTheInterval = () => [
    step({ kind: 'attack' }),
    step({ kind: 'wait', seconds: numbers.intervalSeconds + 1 }),
    step({ kind: 'attack' }),
  ];

  it('ticks for 3% of bonus health once the interval has passed', () => {
    const id = numbers.summonersRift.id;
    const ticks = fromItem(despair(id, acrossTheInterval()), id);

    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.type).toBe('magic');
    expect(ticks[0]!.mitigated).toBeCloseTo(fromBonusHealth, 6);
    expect(ticks[0]!.time).toBeGreaterThanOrEqual(numbers.intervalSeconds);
  });

  it('does not tick the moment combat starts', () => {
    const id = numbers.summonersRift.id;
    expect(fromItem(despair(id, attacks(1)), id)).toHaveLength(0);
  });

  it('keeps one interval between two ticks', () => {
    const id = numbers.summonersRift.id;
    const ticks = fromItem(despair(id, [...acrossTheInterval(), ...acrossTheInterval()]), id);

    expect(ticks).toHaveLength(2);
    expect(ticks[1]!.time - ticks[0]!.time).toBeGreaterThanOrEqual(numbers.intervalSeconds);
  });

  it('does not tick against a monster: Anguish names champions', () => {
    const id = numbers.summonersRift.id;
    expect(fromItem(despair(id, acrossTheInterval(), { unitType: 'monster' }), id)).toHaveLength(
      0,
    );
  });

  /**
   * The Arena copy adds a flat part interpolated over the champion's level, and
   * the expected value is computed the same way Riot's data describes it rather
   * than typed in a second time.
   */
  it('adds the Arena variant level-scaled base on top of the health part', () => {
    const { id, flatAtLevel1, flatAtLevel18 } = numbers.arena;
    const base = flatAtLevel1 + ((flatAtLevel18 - flatAtLevel1) * (LEVEL - 1)) / 17;
    const ticks = fromItem(despair(id, acrossTheInterval()), id);

    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.mitigated).toBeCloseTo(base + fromBonusHealth, 6);
    // Strictly more than the Rift item, which has no flat part at all.
    expect(ticks[0]!.mitigated).toBeGreaterThan(fromBonusHealth);
  });
});

describe("Serylda's Grudge", () => {
  const numbers = PENETRATION_CONSTANTS.seryldasGrudge;

  const grudge = (id: string, currentHealthPercent: number, combo = [step({ kind: 'ability', slot: 'Q' }, 0)]) =>
    run(combo, { itemIds: [id], target: { currentHealthPercent } });
  const slows = (result: Result) =>
    result.spans.filter((span) => span.lane === 'cc' && span.label === 'Slowed');

  it('slows a target below half health for one second, and adds no damage', () => {
    const { id, slowPercent } = numbers.summonersRift;
    const result = grudge(id, numbers.healthThreshold - 0.1);
    const slow = slows(result);

    expect(slow).toHaveLength(1);
    expect(slow[0]!.fullSeconds).toBeCloseTo(numbers.slowSeconds, 6);
    expect(slow[0]!.detail).toContain(`${slowPercent * 100}% slow`);
    // Bitter Cold is a slow and nothing else: no instance may come from it.
    expect(fromItem(result, id)).toHaveLength(0);
  });

  it('leaves a healthy target alone', () => {
    expect(slows(grudge(numbers.summonersRift.id, 1))).toHaveLength(0);
  });

  it('does not fire on a basic attack, because Bitter Cold names abilities', () => {
    const result = grudge(numbers.summonersRift.id, numbers.healthThreshold - 0.1, attacks(2));
    expect(slows(result)).toHaveLength(0);
  });

  it('slows harder under the Arena variant number', () => {
    const { id, slowPercent } = numbers.arena;
    const slow = slows(grudge(id, numbers.healthThreshold - 0.1));

    expect(slow).toHaveLength(1);
    expect(slow[0]!.detail).toContain(`${slowPercent * 100}% slow`);
    expect(slowPercent).toBeGreaterThan(numbers.summonersRift.slowPercent);
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

  it('reaches its cap against a champion far above Vi maximum health', () => {
    const maxHealth = viMaxHealth() + numbers.maxHealthDifference * 2;
    const both = ratios({ maxHealth });

    expect(both.physical).toBeCloseTo(1 + numbers.maxBonusDamagePercent, 6);
    // Riot puts no damage type on Giant Slayer, so the magic on-hit scales too.
    expect(both.magic).toBeCloseTo(1 + numbers.maxBonusDamagePercent, 6);
  });

  it('ramps linearly with the health difference', () => {
    const half = numbers.maxHealthDifference / 2;
    const ratio = ratios({ maxHealth: viMaxHealth() + half }).physical;
    expect(ratio).toBeCloseTo(1 + numbers.maxBonusDamagePercent / 2, 6);
  });

  it('gives nothing against a champion Vi out-sizes', () => {
    const equal = ratios({ maxHealth: viMaxHealth() });
    const smaller = ratios({ maxHealth: viMaxHealth() - 400 });

    expect(equal.physical).toBeCloseTo(1, 6);
    expect(smaller.physical).toBeCloseTo(1, 6);
  });

  it('measures against Vi own health, so her own bonus health shrinks the bonus', () => {
    const bonus = { hp: 1000 };
    const maxHealth = viMaxHealth() + numbers.maxHealthDifference;
    const bare = run(attacks(1), { bonus, target: { maxHealth } });
    const slaying = run(attacks(1), { itemIds: [numbers.id], bonus, target: { maxHealth } });
    const expected =
      ((numbers.maxHealthDifference - bonus.hp) / numbers.maxHealthDifference) *
      numbers.maxBonusDamagePercent;

    expect(attackDamage(slaying) / attackDamage(bare)).toBeCloseTo(1 + expected, 6);
  });

  it('gives nothing against a monster, however large', () => {
    const target = { maxHealth: viMaxHealth() + 20000, unitType: 'monster' as const };
    expect(ratios(target).physical).toBeCloseTo(1, 6);
  });
});

/**
 * The omissions are decisions, so they are asserted rather than left implied.
 *
 * Last Whisper, Mortal Reminder, Void Staff, Cryptbloom and Serpent's Fang carry
 * their penetration as a `<stats>` line that `items.ts` already parses, and an
 * entry for any of them would either count that twice or claim to model a
 * passive this simulation cannot reach: Grievous Wounds needs a target that
 * heals, Shield Reaver a target that shields, and Bloodletter's Curse a
 * magic-resistance shred the engine has no slot for — `applyArmorShred` touches
 * armour only, and the magic-resist input in `applyDamage` is built with
 * `flatReduction: 0, percentReduction: 0`.
 */
describe('what this family deliberately leaves out', () => {
  const ids = PENETRATION_ITEMS.map((effect) => effect.id);

  it('holds no item whose penetration is already a parsed stat line', () => {
    for (const id of ['3035', '3033', '3135', '3137', '6695', '8010', '4010']) {
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

  it('registers each id exactly once', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
});
