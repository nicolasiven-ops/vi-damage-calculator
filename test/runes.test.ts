/**
 * Runes that need the simulation to show their effect.
 *
 * Hail of Blades is the awkward case and therefore the one worth testing: its
 * buff ends on an attack count rather than a timer, it extends on attack
 * resets, it is allowed to break the attack speed cap, and its damage is true
 * damage on each empowered attack. Every one of those is a separate way to get
 * it quietly wrong.
 *
 * Expected numbers come from Data Dragon's own rune text for patch 16.16:
 * 90 % attack speed (melee), up to 3 attacks, at most 3 s apart, 10 s cooldown,
 * 2–20 (+12 % bonus AD, +10 % AP) true damage per attack.
 */

import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS,
  type ComboStep,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { VI_MODULE } from '../src/model/champions/vi';
import { emptyStats, resolveChampionStats } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

const HAIL_OF_BLADES = 9923;
const LEVEL = 11;

const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: LEVEL,
  maxHealth: 9000,
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
function step(action: ComboStep['action']): ComboStep {
  uid += 1;
  return { uid: `r${uid}`, action };
}

function run(
  combo: ComboStep[],
  options: { runeIds?: number[]; target?: TargetConfig; bonusAd?: number } = {},
) {
  const bonusStats = { ...emptyStats(), attackDamage: options.bonusAd ?? 0 };
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: LEVEL,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds: [],
      runeIds: options.runeIds ?? [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, bonusStats),
    bonusStats,
    target: options.target ?? { ...TARGET },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'expected',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

const attacks = (count: number) => Array.from({ length: count }, () => step({ kind: 'attack' }));
const procs = (result: ReturnType<typeof run>) =>
  result.instances.filter((entry) => entry.sourceId === 'rune:9923');

describe('Hail of Blades', () => {
  it('empowers exactly three attacks', () => {
    const result = run(attacks(5), { runeIds: [HAIL_OF_BLADES] });
    expect(procs(result)).toHaveLength(3);
  });

  it('deals true damage, so armour and resistances do not touch it', () => {
    const armoured = run(attacks(1), {
      runeIds: [HAIL_OF_BLADES],
      target: { ...TARGET, armor: 300 },
    });
    const hit = procs(armoured)[0]!;
    expect(hit.type).toBe('true');
    expect(hit.mitigated).toBeCloseTo(hit.raw, 6);
  });

  it('scales its damage with level and bonus AD', () => {
    // Level 11 sits 10/17 of the way from 2 to 20.
    const base = 2 + 18 * (10 / 17);
    expect(procs(run(attacks(1), { runeIds: [HAIL_OF_BLADES] }))[0]!.raw).toBeCloseTo(base, 4);
    expect(
      procs(run(attacks(1), { runeIds: [HAIL_OF_BLADES], bonusAd: 100 }))[0]!.raw,
    ).toBeCloseTo(base + 12, 4);
  });

  /**
   * The whole point of the keystone: those three attacks come faster. The buff
   * has to be in place before the first attack winds up, not after it lands.
   */
  it('speeds up the attacks it empowers, including the first', () => {
    const plain = run(attacks(3));
    const empowered = run(attacks(3), { runeIds: [HAIL_OF_BLADES] });
    const times = (result: ReturnType<typeof run>) =>
      result.instances.filter((entry) => entry.sourceId === 'AA').map((entry) => entry.time);

    const [firstPlain] = times(plain);
    const [firstEmpowered] = times(empowered);
    expect(firstEmpowered!).toBeLessThan(firstPlain!);

    const gap = (list: number[]) => list[1]! - list[0]!;
    expect(gap(times(empowered))).toBeLessThan(gap(times(plain)) * 0.7);
  });

  it('stops speeding up attacks once its three are spent', () => {
    const result = run(attacks(6), { runeIds: [HAIL_OF_BLADES] });
    const hits = result.instances.filter((entry) => entry.sourceId === 'AA').map((e) => e.time);
    const empoweredGap = hits[1]! - hits[0]!;
    const laterGap = hits[4]! - hits[3]!;
    expect(laterGap).toBeGreaterThan(empoweredGap);
  });

  /**
   * "Attack resets increase the attack limit by 1" — and Vi's E is a reset, so
   * an E inside the window buys a fourth empowered attack.
   */
  it('grants an extra attack for an attack reset', () => {
    const withReset = run(
      [
        step({ kind: 'attack' }),
        step({ kind: 'ability', slot: 'E' }),
        step({ kind: 'attack' }),
        step({ kind: 'attack' }),
      ],
      { runeIds: [HAIL_OF_BLADES] },
    );
    expect(procs(withReset)).toHaveLength(4);
  });

  it('does not trigger on minions or monsters', () => {
    const result = run(attacks(3), {
      runeIds: [HAIL_OF_BLADES],
      target: { ...TARGET, unitType: 'monster' },
    });
    expect(procs(result)).toEqual([]);
  });

  it('ends when the attacks are spaced further apart than its window', () => {
    const result = run(
      [
        step({ kind: 'attack' }),
        // The window is 3 s; nothing carries across a longer gap.
        step({ kind: 'wait', seconds: 4 }),
        step({ kind: 'attack' }),
      ],
      { runeIds: [HAIL_OF_BLADES] },
    );
    // The first attack is empowered; by the second the effect has lapsed and
    // the keystone is still on its 10 s cooldown.
    expect(procs(result)).toHaveLength(1);
  });

  it('does nothing at all when it is not picked', () => {
    expect(procs(run(attacks(3)))).toEqual([]);
  });
});
