import { describe, expect, it } from 'vitest';
import { analyse } from '../src/engine/analysis';
import { simulate } from '../src/engine/simulate';
import { DEFAULT_TIMINGS, type ComboStep, type SimulationInput, type TargetConfig } from '../src/engine/types';
import { VI_MODULE, VI_CONSTANTS } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats, statAtLevel } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * This suite deliberately runs *without* game data, so it covers the fallback
 * path: what the calculator does when CommunityDragon cannot be reached and the
 * maintained constants have to carry the combo. The game-data path is covered in
 * `vi.test.ts`, which runs the same module against the real bin file.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 3000,
  currentHealthPercent: 1,
  armor: 100,
  magicResist: 50,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `t${uid}`, action }
    : { uid: `t${uid}`, action, chargeSeconds };
}

function run(combo: ComboStep[], overrides: Partial<SimulationInput> = {}) {
  const bonusStats = overrides.bonusStats ?? emptyStats();
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 11,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds: [],
      runeIds: [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: stats,
    bonusStats,
    target: { ...TARGET },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'expected',
    ...overrides,
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

describe('basic attacks', () => {
  it('deals total attack damage through armor', () => {
    const result = run([step({ kind: 'attack' })]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    // 100 armor halves the damage.
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]!.mitigated).toBeCloseTo(stats.totalAttackDamage * 0.5, 6);
  });

  it('spaces attacks by the attack timer rather than stacking them at t=0', () => {
    const result = run([step({ kind: 'attack' }), step({ kind: 'attack' })]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const cycle = 1 / stats.totalAttackSpeed;
    expect(result.instances[1]!.time - result.instances[0]!.time).toBeCloseTo(cycle, 4);
  });
});

describe('Vault Breaker (Q)', () => {
  it('scales damage with charge time', () => {
    const uncharged = run([step({ kind: 'ability', slot: 'Q' }, 0)]);
    const full = run([step({ kind: 'ability', slot: 'Q' }, VI_CONSTANTS.q.maxChargeSeconds)]);
    expect(full.instances[0]!.raw).toBeGreaterThan(uncharged.instances[0]!.raw * 1.8);
  });

  it('falls back to the maintained constant when game data is unavailable', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 0)]);
    // Rank 5, no bonus AD in this build: the base damage alone. Riot
    // publishes 120 for rank 5, and Q scales with bonus AD, not total AD, so
    // there is nothing to add here.
    const expected = VI_CONSTANTS.q.minBase[4]!;
    expect(result.instances[0]!.raw).toBeCloseTo(expected, 6);
  });

  it('scales with bonus attack damage only', () => {
    const withBonus = run([step({ kind: 'ability', slot: 'Q' }, 0)], {
      bonusStats: { ...emptyStats(), attackDamage: 100 },
    });
    const expected = VI_CONSTANTS.q.minBase[4]! + VI_CONSTANTS.q.minBonusAdRatio * 100;
    expect(withBonus.instances[0]!.raw).toBeCloseTo(expected, 6);
  });

  it('costs its charge time on the timeline', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 1.25),
      step({ kind: 'attack' }),
    ]);
    expect(result.instances[0]!.time).toBeCloseTo(1.25 + DEFAULT_TIMINGS.dashTravel, 6);
  });
});

describe('Excessive Force (E)', () => {
  it('replaces the attack damage rather than adding to it', () => {
    const plain = run([step({ kind: 'attack' })]);
    const empowered = run([step({ kind: 'ability', slot: 'E' }), step({ kind: 'attack' })]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());

    const expected = 90 + VI_CONSTANTS.e.totalAdRatio * stats.totalAttackDamage;
    const empoweredHit = empowered.instances.find((entry) => entry.slot === 'E');
    expect(empoweredHit).toBeDefined();
    expect(empoweredHit!.raw).toBeCloseTo(expected, 6);
    // Not the sum of a normal attack plus the bonus.
    expect(empoweredHit!.raw).toBeLessThan(expected + plain.instances[0]!.raw);
  });

  it('is consumed by exactly one attack', () => {
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    expect(result.instances.filter((entry) => entry.slot === 'E')).toHaveLength(1);
  });

  it('runs out of charges', () => {
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
    ]);
    expect(result.instances.filter((entry) => entry.slot === 'E')).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('Aufladungen');
  });
});

describe('Denting Blows (W)', () => {
  it('procs on the third basic attack, not before', () => {
    const two = run([step({ kind: 'attack' }), step({ kind: 'attack' })]);
    expect(two.instances.some((entry) => entry.slot === 'W')).toBe(false);

    const three = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    expect(three.instances.filter((entry) => entry.slot === 'W')).toHaveLength(1);
  });

  it('deals a percentage of the target maximum health', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    const proc = result.instances.find((entry) => entry.slot === 'W')!;
    // Rank 5 is 8% of 3000 = 240 raw, with no bonus AD in this build.
    expect(proc.raw).toBeCloseTo(3000 * 0.08, 6);
  });

  it('caps against monsters', () => {
    const result = run(
      [step({ kind: 'attack' }), step({ kind: 'attack' }), step({ kind: 'attack' })],
      { target: { ...TARGET, maxHealth: 12000, unitType: 'monster' } },
    );
    const proc = result.instances.find((entry) => entry.slot === 'W')!;
    expect(proc.raw).toBeCloseTo(VI_CONSTANTS.w.monsterCap, 6);
  });

  it('shreds armor, so hits after the proc land harder than hits before it', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    expect(attacks).toHaveLength(4);
    // Same raw damage, more of it gets through once armor is reduced.
    expect(attacks[3]!.raw).toBeCloseTo(attacks[0]!.raw, 4);
    expect(attacks[3]!.mitigated).toBeGreaterThan(attacks[0]!.mitigated);
  });
});

describe('combo ordering', () => {
  it('changes the result when the same steps are reordered', () => {
    const shredFirst = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const ultFirst = run([
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    // The ultimate lands into shredded armor in the first ordering.
    expect(shredFirst.totalMitigated).toBeGreaterThan(ultFirst.totalMitigated);
  });
});

describe('analysis', () => {
  it('accounts for every instance exactly once', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 1.25),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const report = analyse(result, TARGET, stats);

    const summed = report.bySource.reduce((total, entry) => total + entry.mitigated, 0);
    expect(summed).toBeCloseTo(report.totalMitigated, 6);
    expect(report.curve.at(-1)!.cumulative).toBeCloseTo(report.totalMitigated, 6);
  });

  it('reports a kill time once the target runs out of health', () => {
    const result = run(Array.from({ length: 12 }, () => step({ kind: 'attack' })), {
      target: { ...TARGET, maxHealth: 400 },
    });
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const report = analyse(result, { ...TARGET, maxHealth: 400 }, stats);
    expect(report.killTime).not.toBeNull();
    expect(report.missingDamage).toBe(0);
  });
});

describe('stat scaling', () => {
  it('uses Riot growth curve, not linear interpolation', () => {
    // At level 2 a growth stat gains only 72% of its per-level value.
    expect(statAtLevel(100, 100, 2)).toBeCloseTo(100 + 100 * 0.72, 6);
    expect(statAtLevel(100, 100, 1)).toBe(100);
    expect(statAtLevel(100, 100, 18)).toBeCloseTo(100 + 100 * 17 * (0.7025 + 0.0175 * 17), 6);
  });

  it('caps total attack speed at 2.5', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 18, {
      ...emptyStats(),
      attackSpeed: 10,
    });
    expect(stats.totalAttackSpeed).toBe(2.5);
  });
});
