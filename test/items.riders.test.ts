import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { getItemEffect } from '../src/model/itemEffects';
import type { SimContext } from '../src/engine/context';
import {
  DEFAULT_TIMINGS,
  type ComboStep,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * The conditional riders, against the real engine.
 *
 * Every expected number is arithmetic on literals read out of Riot's own bins,
 * not a reference to the module's constants: a test that reads the same constant
 * the implementation reads cannot notice a wrong constant.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Target',
  level: 14,
  maxHealth: 20000,
  currentHealthPercent: 1,
  armor: 100,
  magicResist: 100,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `r${uid}`, action }
    : { uid: `r${uid}`, action, chargeSeconds };
}

function run(
  combo: ComboStep[],
  itemIds: string[],
  bonus: Partial<StatBlock> = {},
  target: Partial<TargetConfig> = {},
) {
  const bonusStats = { ...emptyStats(), ...bonus };
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 14, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 14,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds,
      runeIds: [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: stats,
    bonusStats,
    target: { ...TARGET, ...target },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'expected',
  };
  return { result: simulate(input, VI_MODULE, moduleCtx), stats };
}

const attack = (): ComboStep => step({ kind: 'attack' });
const ability = (slot: 'Q' | 'E'): ComboStep =>
  slot === 'Q' ? step({ kind: 'ability', slot }, 0) : step({ kind: 'ability', slot });

describe('Umbral Glaive - Nightstalker (3179)', () => {
  it('adds 50 plus 150% lethality as true damage, to the first attack only', () => {
    // Items/3179 ProcDamage = 50 + 1.5 x lethality. With 20 lethality: 80 —
    // and true damage ignores the target's 100 armour entirely.
    const { result } = run([attack(), attack()], ['3179'], { lethality: 20 });
    const procs = result.instances.filter((entry) => entry.sourceLabel.includes('Nightstalker'));

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('true');
    expect(procs[0]!.mitigated).toBeCloseTo(80, 6);
  });

  it('does not fire against a monster', () => {
    const champion = run([attack()], ['3179'], { lethality: 20 });
    const monster = run([attack()], ['3179'], { lethality: 20 }, { unitType: 'monster' });

    expect(champion.result.instances.some((e) => e.sourceLabel.includes('Nightstalker'))).toBe(true);
    expect(monster.result.instances.some((e) => e.sourceLabel.includes('Nightstalker'))).toBe(false);
  });
});

describe('Bastionbreaker - Shaped Charge (2520)', () => {
  it('adds 50 plus 150% lethality as true damage on ability damage', () => {
    // Items/2520 AbilityDamageCalc = 50 + 1.5 x lethality: 50 + 33 = 83.
    const { result } = run([ability('Q')], ['2520'], { lethality: 22 });
    const procs = result.instances.filter((entry) => entry.sourceLabel.includes('Shaped Charge'));

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('true');
    expect(procs[0]!.mitigated).toBeCloseTo(83, 6);
  });

  it('needs ability damage, and fires once inside its 20 s cooldown', () => {
    const { result } = run([attack(), ability('Q'), ability('E'), attack()], ['2520'], {
      lethality: 22,
    });
    const procs = result.instances.filter((entry) => entry.sourceLabel.includes('Shaped Charge'));

    // Two abilities land well inside 20 s, so exactly one proc; the attack in
    // front of them shows it is not basic-attack damage that arms it.
    expect(procs).toHaveLength(1);
    const firstAbility = result.instances.find((entry) => entry.slot === 'Q')!;
    expect(procs[0]!.time).toBeCloseTo(firstAbility.time, 4);
  });
});

describe("Dead Man's Plate - Shipwrecker (3742)", () => {
  it('discharges 40 plus base attack damage, once', () => {
    const { result, stats } = run([attack(), attack()], ['3742']);
    const procs = result.instances.filter((entry) => entry.sourceLabel.includes('Shipwrecker'));

    // Items/3742: BonusDamagePerStack 0.4 x 100 stacks = 40, plus base attack
    // damage at MaxStacksADRatio 1. Physical, so 100 armour halves it.
    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(40 + stats.baseAttackDamage, 6);
    expect(procs[0]!.mitigated).toBeCloseTo((40 + stats.baseAttackDamage) * 0.5, 4);
  });
});

describe('Hexoptics C44 - Magnification (2523)', () => {
  it('raises attack damage by the share of 500 range the champion reaches', () => {
    const plain = run([attack()], []);
    const withItem = run([attack()], ['2523']);
    const base = plain.result.instances[0]!.mitigated;
    const amped = withItem.result.instances[0]!.mitigated;

    // Items/2523: MaxDamageAmp 0.10 at MaxRange 500. Vi reaches 125, a quarter
    // of the way, so +2.5%.
    const reach = plain.stats.attackRange / 500;
    expect(amped / base).toBeCloseTo(1 + 0.1 * reach, 6);
  });

  it('leaves ability damage alone', () => {
    const plain = run([ability('Q')], []);
    const withItem = run([ability('Q')], ['2523']);
    expect(withItem.result.instances[0]!.mitigated).toBeCloseTo(
      plain.result.instances[0]!.mitigated,
      6,
    );
  });
});

describe("Bloodletter's Curse - Vile Decay (8010)", () => {
  /*
   * Tested against the runtime rather than through a Vi combo, and the reason is
   * worth writing down: Vi deals no magic damage at all — Denting Blows is
   * physical — so this item is inert for her and a combo could never stack it.
   * The engine side (that a magic-resist shred actually reaches the mitigation)
   * is covered in damage.test.ts, where the pipeline lives.
   */
  function shredCalls(hits: { type: 'magic' | 'physical'; ability: boolean; at: number }[]) {
    const effect = getItemEffect('8010')!;
    const runtime = effect.createRuntime!();
    const calls: { percent: number; label: string }[] = [];
    let now = 0;
    const ctx = {
      get time() {
        return now;
      },
      stats: resolveChampionStats(FIXTURE_CHAMPION_STATS, 14, emptyStats()),
      target: { ...TARGET },
      targetMaxHealth: TARGET.maxHealth,
      targetCurrentHealth: TARGET.maxHealth,
      timings: { ...DEFAULT_TIMINGS },
      rank: () => 5,
      applyMagicResistShred: (args: { percent?: number; label: string }) =>
        calls.push({ percent: args.percent ?? 0, label: args.label }),
    } as unknown as SimContext;

    for (const hit of hits) {
      now = hit.at;
      runtime.onHitLanded!(ctx, {
        sourceId: 'x',
        sourceKind: 'ability',
        type: hit.type,
        isAbilityDamage: hit.ability,
        triggersOnHit: !hit.ability,
        mitigated: 100,
        targetHealthPercentAfter: 0.9,
      });
    }
    return calls;
  }

  it('stacks 7.5% per magic ability hit, up to four stacks', () => {
    // Items/8010: ShredPerStack 0.075, MaxStacks 4 — so 7.5, 15, 22.5, 30, 30.
    const calls = shredCalls(
      [0, 1, 2, 3, 4].map((n) => ({ type: 'magic' as const, ability: true, at: n })),
    );
    expect(calls.map((call) => Math.round(call.percent * 1000) / 1000)).toEqual([
      0.075, 0.15, 0.225, 0.3, 0.3,
    ]);
  });

  it('respects the 0.3 s internal cooldown', () => {
    const calls = shredCalls([
      { type: 'magic', ability: true, at: 0 },
      { type: 'magic', ability: true, at: 0.2 },
      { type: 'magic', ability: true, at: 0.4 },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('ignores physical damage and basic-attack riders', () => {
    expect(shredCalls([{ type: 'physical', ability: true, at: 0 }])).toHaveLength(0);
    expect(shredCalls([{ type: 'magic', ability: false, at: 0 }])).toHaveLength(0);
  });
});
