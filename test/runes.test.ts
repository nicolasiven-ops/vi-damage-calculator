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
import { getRuneDefinition } from '../src/model/runes';
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
  options: {
    runeIds?: number[];
    target?: TargetConfig;
    bonusAd?: number;
    /** Vi's own health, for the runes that read it. */
    attackerHealthPercent?: number;
  } = {},
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
      ...(options.attackerHealthPercent !== undefined
        ? { currentHealthPercent: options.attackerHealthPercent }
        : {}),
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

  it('deals true damage, so armor and resistances do not touch it', () => {
    const armored = run(attacks(1), {
      runeIds: [HAIL_OF_BLADES],
      target: { ...TARGET, armor: 300 },
    });
    const hit = procs(armored)[0]!;
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

/**
 * The numbers, pinned to Riot's own words.
 *
 * These are the values that had rotted quietly: Sudden Impact was still granting
 * lethality it lost seasons ago, Electrocute was computing a 30–180 base against a
 * published 70–240, and the suite was green through all of it. A test that quotes
 * the tooltip is the only thing that turns "Riot changed a rune" from a silent
 * wrong answer into a failure with a name on it.
 */
describe('rune values, against runesReforged for 16.16.1', () => {
  const at = (id: number) => {
    const rune = getRuneDefinition(id);
    if (!rune) throw new Error(`rune ${id} is not modelled`);
    return rune;
  };
  const statsOf = (id: number, level: number) =>
    at(id).stats?.({ level, baseline: resolveChampionStats(FIXTURE_CHAMPION_STATS, level, emptyStats()) }) ?? {};

  it('Legend: Alacrity — "3% attack speed plus an additional 1.5% for every Legend stack (max 10)"', () => {
    expect(statsOf(9104, 11).attackSpeed).toBeCloseTo(0.18, 10);
  });

  it('Legend: Haste — "1.5 basic ability haste for every Legend stack (max 10)"', () => {
    expect(statsOf(9105, 11).basicAbilityHaste).toBe(15);
  });

  it('Transcendence — "Level 5: +5 Ability Haste · Level 8: +5 Ability Haste"', () => {
    expect(statsOf(8210, 4).abilityHaste).toBe(0);
    expect(statsOf(8210, 5).abilityHaste).toBe(5);
    // The second tier lands at 8. It used to be modelled at 10, which quietly
    // shortened nothing for three levels of every mid-game build.
    expect(statsOf(8210, 8).abilityHaste).toBe(10);
  });

  it('Absolute Focus — "up to 18 Attack Damage … 1.8 Attack Damage at level 1"', () => {
    // Riot states the attack-damage end itself: no adaptive-force conversion.
    expect(statsOf(8233, 1).attackDamage).toBeCloseTo(1.8, 6);
    expect(statsOf(8233, 18).attackDamage).toBeCloseTo(18, 6);
  });

  it('Gathering Storm — "10 min: +8 AP or 5 AD · 20 min: +24 AP or 14 AD"', () => {
    // Two minutes per level is the app's stand-in for a clock, so level 11 is
    // 22 minutes: one step in.
    expect(statsOf(8236, 4).attackDamage).toBe(0);
    expect(statsOf(8236, 6).attackDamage).toBe(5);
    expect(statsOf(8236, 11).attackDamage).toBe(14);
  });

  it('Sudden Impact grants no stats at all any more', () => {
    // It granted 7 lethality and 6 magic penetration here for years after Riot
    // replaced the rune with a true-damage proc.
    const rune = at(8143);
    expect(rune.stats).toBeUndefined();
    expect(rune.createRuntime).toBeTypeOf('function');
  });

  it('models no rune Riot has removed from the tree', () => {
    // Eyeball Collection (8138) has not been in the Domination tree for years, so
    // nothing could pick it and its stat line was unreachable code that read as a
    // modelled rune.
    expect(getRuneDefinition(8138)).toBeUndefined();
  });
});

describe('Sudden Impact', () => {
  const SUDDEN_IMPACT = 8143;
  const procs = (result: ReturnType<typeof run>) =>
    result.instances.filter((entry) => entry.sourceId === 'rune:8143');

  it('does nothing without a dash to arm it', () => {
    // Basic attacks are not dashes, and neither is E.
    const result = run(attacks(3), { runeIds: [SUDDEN_IMPACT] });
    expect(procs(result)).toHaveLength(0);
  });

  it('fires on the dash that arms it, because the dash comes first', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' })], { runeIds: [SUDDEN_IMPACT] });
    expect(procs(result)).toHaveLength(1);
    // "20 - 80 True Damage based on level": level 11 is 10/17 of the way up.
    expect(procs(result)[0]!.raw).toBeCloseTo(20 + 60 * (10 / 17), 4);
    expect(procs(result)[0]!.type).toBe('true');
  });

  it('arms the next press too, then holds its ten seconds', () => {
    const result = run(
      [step({ kind: 'ability', slot: 'Q' }), ...attacks(3)],
      { runeIds: [SUDDEN_IMPACT] },
    );
    // Once on the Q, and not again inside the cooldown.
    expect(procs(result)).toHaveLength(1);
  });
});

describe('Cut Down and Last Stand read health, not build size', () => {
  it('Cut Down — "8% more damage to champions who have more than 60% health"', () => {
    const healthy = run(attacks(1), { runeIds: [8017] });
    const wounded = run(attacks(1), {
      runeIds: [8017],
      target: { ...TARGET, currentHealthPercent: 0.5 },
    });
    const first = (result: ReturnType<typeof run>) =>
      result.instances.filter((entry) => entry.sourceId === 'AA')[0]!.raw;
    // Above the threshold it amplifies; below it, nothing.
    expect(first(healthy)).toBeGreaterThan(first(wounded));
    expect(first(healthy) / first(wounded)).toBeCloseTo(1.08, 3);
  });

  it('Last Stand — "5% - 11% … while you are below 60% health"', () => {
    const full = run(attacks(1), { runeIds: [8299] });
    const low = run(attacks(1), { runeIds: [8299], attackerHealthPercent: 0.3 });
    const first = (result: ReturnType<typeof run>) =>
      result.instances.filter((entry) => entry.sourceId === 'AA')[0]!.raw;
    expect(first(low) / first(full)).toBeCloseTo(1.11, 3);
  });
});
