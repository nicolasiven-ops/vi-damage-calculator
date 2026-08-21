import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { parseChampionBin } from '../src/data/bin';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS, type AbilitySlot, type ComboStep, type SimulationInput, type TargetConfig,
} from '../src/engine/types';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { VI_MODULE } from '../src/model/champions/vi';
import { emptyStats, resolveChampionStats } from '../src/model/stats';
import type { DDragonChampionDetail, DDragonSpell } from '../src/data/types';

function probe<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../.data-probe/${name}`, import.meta.url), 'utf8')) as T;
}
const DDRAGON = probe<{ data: Record<string, DDragonChampionDetail> }>('ddragon-vi.json').data.Vi!;
const SPELL_BY_ID: Record<string, DDragonSpell | undefined> = Object.fromEntries(DDRAGON.spells.map((e) => [e.id, e]));
const ctx: ChampionModuleContext = { detail: DDRAGON, spellById: SPELL_BY_ID, gameData: parseChampionBin(probe('vi-bin.json'), 'Vi', '16.16') };
const ctxNoGD: ChampionModuleContext = { detail: DDRAGON, spellById: SPELL_BY_ID, gameData: null };

const TARGET: TargetConfig = { name: 'T', level: 11, maxHealth: 2100, currentHealthPercent: 1, armor: 90, magicResist: 50, flatDamageReduction: 0, percentDamageReduction: 0, bonusHealth: 0, unitType: 'champion', healthRegenPerFive: 9 };
let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined ? { uid: `t${uid}`, action } : { uid: `t${uid}`, action, chargeSeconds };
}
const RANKS: Record<AbilitySlot, number> = { P: 1, Q: 5, W: 4, E: 3, R: 2 };
function input(combo: ComboStep[], itemIds: string[]): SimulationInput {
  const bonus = emptyStats();
  return {
    attacker: { championId: 'Vi', level: 11, ranks: RANKS, itemIds, runeIds: [], shardIds: [], summonerIds: ['SummonerDot'], manualStats: {} },
    championBaseStats: DDRAGON.stats, attackerStats: resolveChampionStats(DDRAGON.stats, 11, bonus),
    bonusStats: bonus, target: { ...TARGET }, combo, timings: { ...DEFAULT_TIMINGS }, critMode: 'expected',
  };
}
const out: string[] = [];
function bench(label: string, iterations: number, fn: () => unknown) {
  for (let i = 0; i < 500; i += 1) fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const ms = performance.now() - t0;
  out.push(`${label}: ${((ms / iterations) * 1000).toFixed(1)} us/call`);
}
describe('bench', () => {
  it('measures', () => {
    const combo6 = [
      step({ kind: 'ability', slot: 'Q' }, 1.25), step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }), step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }), step({ kind: 'attack' }),
    ];
    const combo8 = [...combo6, step({ kind: 'summoner', summonerId: 'SummonerDot' }), step({ kind: 'attack' })];
    bench('A. 6 steps, 0 items, gamedata', 5000, () => simulate(input(combo6, []), VI_MODULE, ctx));
    bench('B. 6 steps, 0 items, no gamedata', 5000, () => simulate(input(combo6, []), VI_MODULE, ctxNoGD));
    bench('C. 6 steps, 1 item (LS)', 5000, () => simulate(input(combo6, ['1036']), VI_MODULE, ctx));
    bench('D. 6 steps, 6 modelled items', 5000, () => simulate(input(combo6, ['3078','3153','3071','3748','6692','3161']), VI_MODULE, ctx));
    bench('E. 6 steps, 6 stat-only items', 5000, () => simulate(input(combo6, ['3031','3095','3006','3033','6676','3072']), VI_MODULE, ctx));
    bench('F. 8 steps + ignite, 6 modelled', 5000, () => simulate(input(combo8, ['3078','3153','3071','3748','6692','3161']), VI_MODULE, ctx));
    const r = simulate(input(combo6, ['3078','3153','3071','3748','6692','3161']), VI_MODULE, ctx);
    out.push(`payload: ${r.instances.length} instances, ${r.events.length} events, ${r.spans.length} spans, ${r.snapshots.length} snapshots`);
    const r8 = simulate(input(combo8, ['3078','3153','3071','3748','6692','3161']), VI_MODULE, ctx);
    out.push(`payload 8: ${r8.instances.length} inst, ${r8.events.length} ev, ${r8.spans.length} spans, ${r8.snapshots.length} snaps, dur ${r8.duration.toFixed(2)}s`);
    console.log('\n' + out.join('\n'));
  }, 120000);
});
