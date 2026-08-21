/**
 * Vi's module, driven by the real game data for patch 16.16.
 *
 * `simulate.test.ts` covers the same module with the game data switched off, so
 * between the two files both paths through every value are exercised.
 *
 * The last block is the one worth keeping an eye on: it asserts that the
 * maintained constants still agree, value for value, with what Riot ships. When
 * Riot changes a number, that test fails and names the row — which is the only
 * automated signal this repository has that the fallbacks went stale.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChampionBin } from '../src/data/bin';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS,
  type AbilitySlot,
  type ComboStep,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { VI_CONSTANTS, VI_MODULE } from '../src/model/champions/vi';
import { emptyStats, resolveChampionStats } from '../src/model/stats';
import type { DDragonChampionDetail, DDragonSpell } from '../src/data/types';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

function probe<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../.data-probe/${name}`, import.meta.url), 'utf8')) as T;
}

const DDRAGON = probe<{ data: Record<string, DDragonChampionDetail> }>('ddragon-vi.json').data.Vi!;
const SPELL_BY_ID: Record<string, DDragonSpell | undefined> = Object.fromEntries(
  DDRAGON.spells.map((entry) => [entry.id, entry]),
);

const WITH_GAME_DATA: ChampionModuleContext = {
  detail: DDRAGON,
  spellById: SPELL_BY_ID,
  gameData: parseChampionBin(probe('vi-bin.json'), 'Vi', '16.16'),
};

const WITHOUT_GAME_DATA: ChampionModuleContext = {
  detail: DDRAGON,
  spellById: SPELL_BY_ID,
  gameData: null,
};

const RANKS: Record<AbilitySlot, number> = { P: 1, Q: 1, W: 1, E: 1, R: 1 };

function rows(ctx: ChampionModuleContext, ranks: Record<AbilitySlot, number> = RANKS) {
  return VI_MODULE.describeValues(ctx, ranks);
}

function value(ctx: ChampionModuleContext, label: string, ranks?: Record<AbilitySlot, number>) {
  return rows(ctx, ranks).find((row) => row.label === label);
}

/* ------------------------------------------------------------ the inspector */

describe('formula inspector, with game data', () => {
  it('labels ability damage as game data, not as a maintained constant', () => {
    // Q uncharged, Q fully charged, E and R all report a base damage.
    const damageRows = rows(WITH_GAME_DATA).filter((row) => row.label.startsWith('Base damage'));
    expect(damageRows).toHaveLength(4);
    for (const row of damageRows) expect(row.source).toBe('gamedata');
  });

  it('still credits Data Dragon for the values Data Dragon does ship', () => {
    expect(value(WITH_GAME_DATA, 'Cooldown')!.source).toBe('ddragon');
  });

  it('uses no maintained constant anywhere once the formulas are loaded', () => {
    const fromRegistry = rows(WITH_GAME_DATA).filter((row) => row.source === 'registry');
    expect(fromRegistry).toEqual([]);
  });

  it('shows Riot numbers for rank 1', () => {
    expect(value(WITH_GAME_DATA, 'Base damage (tapped)')!.value).toBe('40');
    expect(value(WITH_GAME_DATA, 'Base damage (fully charged)')!.value).toBe('100');
    expect(value(WITH_GAME_DATA, 'Bonus AD ratio')!.value).toBe('60% → 150%');
    expect(value(WITH_GAME_DATA, 'Max-health damage')!.value).toBe('4%');
    expect(value(WITH_GAME_DATA, 'per 100 bonus AD')!.value).toBe('3.5%');
    expect(value(WITH_GAME_DATA, 'Shield')!.value).toBe('12% maximum health');
  });

  it('reads the passive cooldown off Riot level curve instead of guessing it', () => {
    expect(rows(WITH_GAME_DATA).find((row) => row.slot === 'P' && row.label === 'Cooldown')!.value).toBe(
      '16 s (level 1) → 12 s (level 18)',
    );
  });

  it('carries the formula it read, so a number can be checked against the client', () => {
    expect(value(WITH_GAME_DATA, 'Base damage (fully charged)')!.formula).toBe(
      '(40 + 60% bonus AD) × 2.5',
    );
  });

  it('scales every row with the selected rank', () => {
    const maxed: Record<AbilitySlot, number> = { P: 1, Q: 5, W: 5, E: 5, R: 3 };
    expect(value(WITH_GAME_DATA, 'Base damage (tapped)', maxed)!.value).toBe('120');
    expect(value(WITH_GAME_DATA, 'Max-health damage', maxed)!.value).toBe('8%');
    expect(rows(WITH_GAME_DATA, maxed).find((row) => row.slot === 'R' && row.label === 'Base damage')!.value).toBe('350');
  });
});

describe('formula inspector, without game data', () => {
  it('says so, per value, instead of presenting constants as Riot data', () => {
    const damageRows = rows(WITHOUT_GAME_DATA).filter((row) => row.label.startsWith('Base damage'));
    for (const row of damageRows) {
      expect(row.source).toBe('registry');
      expect(row.note).toMatch(/No game data available for this patch/);
    }
  });
});

/* ------------------------------------------------------------- the simulation */

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 3000,
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
    ? { uid: `v${uid}`, action }
    : { uid: `v${uid}`, action, chargeSeconds };
}

function run(combo: ComboStep[], bonusAd = 0) {
  const bonusStats = { ...emptyStats(), attackDamage: bonusAd };
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
    attackerStats: resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonusStats),
    bonusStats,
    target: { ...TARGET },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'expected',
  };
  return simulate(input, VI_MODULE, WITH_GAME_DATA);
}

describe('simulation against real game data', () => {
  it('computes Q from bonus AD, the way the client does', () => {
    // Rank 5 uncharged: 120 base + 60% of 100 bonus AD.
    const result = run([step({ kind: 'ability', slot: 'Q' }, 0)], 100);
    expect(result.instances[0]!.raw).toBeCloseTo(180, 3);
  });

  it('computes a fully charged Q from the multiplied formula', () => {
    // Rank 5 charged: 300 base + 150% of 100 bonus AD.
    const result = run([step({ kind: 'ability', slot: 'Q' }, 1.25)], 100);
    expect(result.instances[0]!.raw).toBeCloseTo(450, 3);
  });

  it('computes R from bonus AD', () => {
    // Rank 3: 350 base + 90% of 100 bonus AD.
    const result = run([step({ kind: 'ability', slot: 'R' })], 100);
    expect(result.instances[0]!.raw).toBeCloseTo(440, 3);
  });

  it('computes E from total AD, because it replaces the attack', () => {
    const result = run([step({ kind: 'ability', slot: 'E' })], 100);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, {
      ...emptyStats(),
      attackDamage: 100,
    });
    const hit = result.instances.find((entry) => entry.slot === 'E')!;
    expect(hit.raw).toBeCloseTo(90 + 1.1 * stats.totalAttackDamage, 3);
  });

  it('computes W as a share of maximum health plus bonus AD', () => {
    const result = run(
      [step({ kind: 'attack' }), step({ kind: 'attack' }), step({ kind: 'attack' })],
      200,
    );
    const proc = result.instances.find((entry) => entry.slot === 'W')!;
    // Rank 5: 8% + 7% from 200 bonus AD = 15% of 3000.
    expect(proc.raw).toBeCloseTo(3000 * 0.15, 3);
  });

  it('lets the W counter lapse when the combo is slower than the marker', () => {
    const quick = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    expect(quick.instances.filter((entry) => entry.slot === 'W')).toHaveLength(1);

    const lapsed = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      // The marker lasts 4 s; nothing carries over a longer gap.
      step({ kind: 'wait', seconds: 6 }),
      step({ kind: 'attack' }),
    ]);
    expect(lapsed.instances.filter((entry) => entry.slot === 'W')).toHaveLength(0);
  });

  it('shields Vi for a share of her maximum health on ability damage', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 0)]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    expect(result.shieldGained).toBeCloseTo(stats.maxHealth * 0.12, 2);
  });
});

/* ------------------------------------------------------------------- parity */

/**
 * The maintained constants exist for the case where CommunityDragon cannot be
 * reached, which means they are only useful while they are still correct. This
 * compares them against the patch's game data row by row: every value the
 * inspector shows has to come out the same, whichever source produced it.
 *
 * A failure here is not a broken calculator — it is a patch note. Update
 * `FALLBACK` in `src/model/champions/vi.ts` and re-run.
 */
describe('maintained constants match the game data', () => {
  const RANK_SETS: Record<AbilitySlot, number>[] = [
    { P: 1, Q: 1, W: 1, E: 1, R: 1 },
    { P: 1, Q: 3, W: 3, E: 3, R: 2 },
    { P: 1, Q: 5, W: 5, E: 5, R: 3 },
  ];

  for (const [index, ranks] of RANK_SETS.entries()) {
    it(`agrees on every value for rank set ${index + 1}`, () => {
      const live = rows(WITH_GAME_DATA, ranks);
      const fallback = rows(WITHOUT_GAME_DATA, ranks);
      expect(fallback).toHaveLength(live.length);

      const differences = live
        .map((row, position) => ({ row, other: fallback[position]! }))
        .filter(({ row, other }) => row.value !== other.value)
        .map(({ row, other }) => `${row.slot} ${row.label}: Spieldaten ${row.value} ≠ Registry ${other.value}`);

      expect(differences).toEqual([]);
    });
  }

  it('keeps the two ratios that were wrong before, right', () => {
    // Q scales with bonus AD. Total AD would make it 60% of 160 here, not 100.
    expect(VI_CONSTANTS.q.minBonusAdRatio).toBe(0.6);
    expect(VI_CONSTANTS.q.maxBonusAdRatio).toBe(1.5);
    // R's rank 2 and 3 base damage, which used to read 325 and 500.
    expect(VI_CONSTANTS.r.base).toEqual([150, 250, 350]);
  });
});
