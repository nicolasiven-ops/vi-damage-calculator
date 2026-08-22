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
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * Damage that arrives on its own clock is marked as such.
 *
 * The flag exists for the views: a dot on a damage curve means "a moment you can
 * point at", and every other dot is a press. Scorchclaw's burn ticking four
 * seconds after the hit that lit it produced a marker between two presses with
 * nothing visible behind it — right number, wrong claim.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Target',
  level: 14,
  maxHealth: 9000,
  currentHealthPercent: 1,
  armor: 60,
  magicResist: 50,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
const step = (action: ComboStep['action']): ComboStep => {
  uid += 1;
  return { uid: `d${uid}`, action };
};

function run(summonerIds: string[]) {
  const bonusStats = emptyStats();
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 14, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 14,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds: [],
      runeIds: [],
      shardIds: [],
      summonerIds,
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: stats,
    bonusStats,
    target: { ...TARGET },
    combo: [step({ kind: 'attack' }), step({ kind: 'attack' }), step({ kind: 'attack' })],
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'expected',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

describe("Scorchclaw's burn", () => {
  it('arrives on its own clock, and says so', () => {
    const result = run(['SummonerSmiteAvatarOffensive']);
    const burn = result.instances.filter((entry) => entry.sourceLabel.includes('Scorchclaw'));

    expect(burn.length).toBeGreaterThan(0);
    // Every tick is flagged, including the first — which was the one that got a
    // marker of its own and looked like a hit from nowhere.
    expect(burn.every((entry) => entry.delayed === true)).toBe(true);
  });

  it('leaves the presses unflagged', () => {
    const result = run(['SummonerSmiteAvatarOffensive']);
    const attacks = result.instances.filter((entry) => entry.sourceLabel === 'Basic attack');

    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks.every((entry) => entry.delayed !== true)).toBe(true);
  });

  it('still counts every point of its damage', () => {
    const withPet = run(['SummonerSmiteAvatarOffensive']);
    const without = run(['SummonerSmite']);

    // The flag is about markers, not about totals: the burn is damage and it
    // has to show up in the total exactly as before.
    expect(withPet.totalMitigated).toBeGreaterThan(without.totalMitigated);
  });
});
