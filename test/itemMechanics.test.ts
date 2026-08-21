import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS,
  type ComboStep,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats } from '../src/model/stats';
import { getItemEffect } from '../src/model/itemEffects';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * One test per item *mechanic*, not per item.
 *
 * The mechanics are the thing that is implemented once and reused; an item is a
 * row of numbers pointing at one. So this suite pins the behaviour of each shape
 * — and a new item using a proven shape needs no test of its own beyond its
 * numbers.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 100000, // nothing may die: these tests are about multipliers
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `m${uid}`, action }
    : { uid: `m${uid}`, action, chargeSeconds };
}

function run(combo: ComboStep[], itemIds: string[] = []) {
  const bonusStats = emptyStats();
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 11,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds,
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
    critMode: 'never',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

/** Total damage of the instances a predicate accepts. */
function total(
  result: ReturnType<typeof run>,
  accept: (instance: ReturnType<typeof run>['instances'][number]) => boolean,
): number {
  return result.instances.filter(accept).reduce((sum, entry) => sum + entry.mitigated, 0);
}

describe('stacking amplifier', () => {
  const combo = () => [
    step({ kind: 'ability', slot: 'Q' }, 0),
    step({ kind: 'ability', slot: 'R' }),
  ];

  it('raises later ability damage and leaves the hit that granted the stack alone', () => {
    const plain = run(combo());
    const withShojin = run(combo(), ['3161']);

    const qPlain = total(plain, (entry) => entry.slot === 'Q');
    const qShojin = total(withShojin, (entry) => entry.slot === 'Q');
    // The first ability grants the first stack; it must not amplify itself.
    expect(qShojin).toBeCloseTo(qPlain, 1);

    const rPlain = total(plain, (entry) => entry.slot === 'R');
    const rShojin = total(withShojin, (entry) => entry.slot === 'R');
    // One stack by then: +3%.
    expect(rShojin / rPlain).toBeCloseTo(1.03, 3);
  });

  it('does not touch basic attacks', () => {
    const combo = [
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'attack' }),
    ];
    const plain = run(combo);
    const withShojin = run(combo, ['3161']);
    const attacks = (result: ReturnType<typeof run>) =>
      total(result, (entry) => entry.sourceKind === 'attack');
    expect(attacks(withShojin)).toBeCloseTo(attacks(plain), 1);
  });

  it('is declared as modelled, with its haste in the stat block', () => {
    const effect = getItemEffect('3161');
    expect(effect?.modelled).toBe(true);
    expect(effect?.stats?.basicAbilityHaste).toBe(25);
    expect(effect?.createRuntime).toBeDefined();
  });
});
