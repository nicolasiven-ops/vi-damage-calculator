import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { DEFAULT_TIMINGS, type ComboStep, type SimulationInput, type TargetConfig } from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

const moduleCtx: ChampionModuleContext = { detail: FIXTURE_CHAMPION, spellById: FIXTURE_SPELLS_BY_ID, gameData: null };
const TARGET: TargetConfig = {
  name: 'T', level: 11, maxHealth: 20000, currentHealthPercent: 1, armor: 100,
  magicResist: 50, flatDamageReduction: 0, percentDamageReduction: 0, bonusHealth: 1200,
  unitType: 'champion',
};
let uid = 0;
const step = (action: ComboStep['action'], chargeSeconds?: number): ComboStep => {
  uid += 1;
  return chargeSeconds === undefined ? { uid: `t${uid}`, action } : { uid: `t${uid}`, action, chargeSeconds };
};
function run(combo: ComboStep[], bonus: StatBlock, itemIds: string[] = [], target = TARGET) {
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonus);
  const input: SimulationInput = {
    attacker: { championId: 'Vi', level: 11, ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds, runeIds: [], shardIds: [], summonerIds: ['SummonerDot'], manualStats: {} },
    championBaseStats: FIXTURE_CHAMPION_STATS, attackerStats: stats, bonusStats: bonus,
    target: { ...target }, combo, timings: { ...DEFAULT_TIMINGS }, critMode: 'expected',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}
const COMBO = () => [
  step({ kind: 'ability', slot: 'Q' }, 1.25),
  step({ kind: 'attack' }),
  step({ kind: 'ability', slot: 'E' }),
  step({ kind: 'attack' }),
  step({ kind: 'ability', slot: 'R' }),
  step({ kind: 'ability', slot: 'W' }),
];
function sweep(key: keyof StatBlock, values: number[], items: string[] = []) {
  const out = values.map((v) => {
    const bonus = emptyStats(); bonus[key] = v;
    const r = run(COMBO(), bonus, items);
    return { v, dmg: Math.round(r.totalMitigated * 100) / 100, dur: Math.round(r.duration * 1000) / 1000 };
  });
  let breaks: string[] = [];
  for (let i = 1; i < out.length; i++) if (out[i]!.dmg < out[i - 1]!.dmg - 1e-6) breaks.push(`${key} ${out[i-1]!.v}->${out[i]!.v}: ${out[i-1]!.dmg} -> ${out[i]!.dmg}`);
  console.log(`SWEEP ${key} [items=${items.join('/')}] first=${out[0]!.dmg} last=${out[out.length-1]!.dmg} nonmono=${breaks.length}`);
  for (const b of breaks.slice(0, 6)) console.log('   BREAK ' + b);
  return out;
}
describe('probe', () => {
  it('monotonicity sweeps', { timeout: 240000 }, () => {
    const range = (a: number, b: number, s: number) => { const o: number[] = []; for (let v = a; v <= b + 1e-9; v += s) o.push(Math.round(v * 1e6) / 1e6); return o; };
    sweep('attackDamage', range(0, 300, 5));
    sweep('attackSpeed', range(0, 1.6, 0.02));
    sweep('abilityHaste', range(0, 80, 2));
    sweep('lethality', range(0, 40, 1));
    sweep('critChance', range(0, 1, 0.05));
    sweep('hp', range(0, 1500, 50));
    sweep('hp', range(0, 1500, 50), ['3748']);
    sweep('attackSpeed', range(0, 1.6, 0.02), ['3078', '3071', '3153']);
    sweep('abilityHaste', range(0, 80, 2), ['3161', '3071']);
    sweep('mana', range(0, 1200, 50));
    sweep('attackDamage', range(0, 300, 5), ['3078','3071','3153','6692','3508','3748']);
    expect(true).toBe(true);
  });
  it('sizes of the result object', () => {
    const r = run(COMBO(), emptyStats(), ['3078','3071','3153','6692','3508','3748']);
    console.log(`SIZES instances=${r.instances.length} events=${r.events.length} spans=${r.spans.length} snapshots=${r.snapshots.length}`);
  });
});
