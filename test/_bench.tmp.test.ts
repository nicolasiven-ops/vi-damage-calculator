import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { DEFAULT_TIMINGS, type ComboStep, type SimulationInput, type TargetConfig } from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};
const TARGET: TargetConfig = {
  name: 'T', level: 11, maxHealth: 3000, currentHealthPercent: 1, armor: 100,
  magicResist: 50, flatDamageReduction: 0, percentDamageReduction: 0, bonusHealth: 0,
  unitType: 'champion',
};
let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined ? { uid: `t${uid}`, action } : { uid: `t${uid}`, action, chargeSeconds };
}
function input(combo: ComboStep[], itemIds: string[], bonus = emptyStats()): SimulationInput {
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonus);
  return {
    attacker: { championId: 'Vi', level: 11, ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds, runeIds: [], shardIds: [], summonerIds: ['SummonerDot'], manualStats: {} },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: stats, bonusStats: bonus, target: { ...TARGET },
    combo, timings: { ...DEFAULT_TIMINGS }, critMode: 'expected',
  };
}
function bench(label: string, inp: SimulationInput, n = 5000) {
  simulate(inp, VI_MODULE, moduleCtx);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) simulate(inp, VI_MODULE, moduleCtx);
  const t1 = performance.now();
  const per = (t1 - t0) / n;
  console.log(`${label}: ${per.toFixed(4)} ms/call -> ${Math.round(1 / per)} calls/ms, ${Math.round(1000 / per)} calls/s`);
  return per;
}
describe('bench', () => {
  it("measures simulate cost", { timeout: 120000 }, () => {
    const six = [step({kind:'ability',slot:'Q'},1.25), step({kind:'attack'}), step({kind:'ability',slot:'E'}),
      step({kind:'attack'}), step({kind:'ability',slot:'R'}), step({kind:'ability',slot:'W'})];
    const twelve = [...six, step({kind:'attack'}), step({kind:'ability',slot:'E'}), step({kind:'attack'}),
      step({kind:'summoner',summonerId:'SummonerDot'}), step({kind:'attack'}), step({kind:'ability',slot:'Q'},0)];
    const p1 = bench('6 steps, no items', input(six, []));
    const p2 = bench('6 steps, 6 modelled items', input(six, ['3078','3508','3071','3153','3748','6692']));
    const p3 = bench('12 steps, 6 modelled items', input(twelve, ['3078','3508','3071','3153','3748','6692']));
    console.log(JSON.stringify({p1,p2,p3}));
    expect(p1).toBeGreaterThan(0);
  });
});
