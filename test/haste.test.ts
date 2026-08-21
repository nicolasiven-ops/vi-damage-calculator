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
import {
  STAT_KEYS,
  emptyStats,
  hasteFor,
  resolveChampionStats,
  sumStats,
} from '../src/model/stats';
import { getItemEffect } from '../src/model/itemEffects';
import { SHARD_DEFINITIONS } from '../src/model/runes';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * Ability haste comes in two flavours and the difference is a 90-second
 * ultimate, so it gets its own suite.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 100000, // nothing here is about damage; the target must not die
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
    ? { uid: `h${uid}`, action }
    : { uid: `h${uid}`, action, chargeSeconds };
}

function run(combo: ComboStep[], bonus: Partial<ReturnType<typeof emptyStats>> = {}) {
  const bonusStats = { ...emptyStats(), ...bonus };
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
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

/** When the second cast of an ability landed, which is what haste moves. */
function secondCastAt(slot: 'Q' | 'R', bonus: Partial<ReturnType<typeof emptyStats>>): number {
  const result = run([step({ kind: 'ability', slot }, slot === 'Q' ? 0 : undefined), step({ kind: 'ability', slot }, slot === 'Q' ? 0 : undefined)], bonus);
  const casts = result.instances.filter((entry) => entry.slot === slot);
  expect(casts).toHaveLength(2);
  return casts[1]!.time;
}

describe('the stat block is fully wired', () => {
  /*
   * `STAT_KEYS` is `satisfies readonly (keyof StatBlock)[]`, which checks that
   * every entry is a real key but never that every key is an entry. A missing
   * one makes `sumStats` drop the stat silently, with a clean typecheck — so the
   * exhaustiveness check has to happen here.
   */
  it('sums every stat it defines', () => {
    const keys = Object.keys(emptyStats()).sort();
    expect([...STAT_KEYS].sort()).toEqual(keys);
  });

  it('carries basic ability haste through a sum', () => {
    const total = sumStats([{ ...emptyStats(), basicAbilityHaste: 25 }]);
    expect(total.basicAbilityHaste).toBe(25);
  });
});

describe('basic ability haste', () => {
  it('is withheld from the ultimate and granted to everything else', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, {
      ...emptyStats(),
      abilityHaste: 20,
      basicAbilityHaste: 25,
    });
    expect(hasteFor(stats, 'Q')).toBe(45);
    expect(hasteFor(stats, 'W')).toBe(45);
    expect(hasteFor(stats, 'E')).toBe(45);
    expect(hasteFor(stats, 'R')).toBe(20);
  });

  it('shortens the wait for a second Q', () => {
    const plain = secondCastAt('Q', {});
    const hasted = secondCastAt('Q', { basicAbilityHaste: 100 });
    // 100 haste halves a cooldown, so the second cast has to arrive much sooner.
    expect(hasted).toBeLessThan(plain * 0.75);
  });

  it('does not shorten the wait for a second ultimate', () => {
    const plain = secondCastAt('R', {});
    const hasted = secondCastAt('R', { basicAbilityHaste: 100 });
    expect(hasted).toBeCloseTo(plain, 2);
    expect(hasted).toBeGreaterThanOrEqual(90);
  });

  it('is what plain haste is not: plain haste does shorten the ultimate', () => {
    const plain = secondCastAt('R', {});
    const hasted = secondCastAt('R', { abilityHaste: 100 });
    expect(hasted).toBeLessThan(plain * 0.6);
  });
});

describe('where basic ability haste comes from', () => {
  /*
   * Riot's live data is explicit about this one and it is easy to get wrong: the
   * shard's icon is called StatModsCDRScalingIcon and its effect is a flat "+8
   * Ability Haste" with no "Basic" qualifier anywhere in the entry. The word
   * belongs to Spear of Shojin and to Legend: Haste, not to the shard.
   */
  it('is not what the ability haste shard grants', () => {
    const shard = SHARD_DEFINITIONS.find((entry) => entry.id === 5007);
    if (!shard?.stats) throw new Error('the ability haste shard has no definition');
    const granted = shard.stats({
      level: 11,
      baseline: resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats()),
    });
    expect(granted.abilityHaste).toBe(8);
    expect(granted.basicAbilityHaste ?? 0).toBe(0);
  });

  it('is what Spear of Shojin grants, through its passive text', () => {
    const shojin = getItemEffect('3161');
    expect(shojin?.stats?.basicAbilityHaste).toBe(25);
    expect(shojin?.stats?.abilityHaste ?? 0).toBe(0);
  });
});
