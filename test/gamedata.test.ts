/**
 * The bin parser, checked against real game data.
 *
 * Unlike `fixtures.ts`, the payloads here are *not* synthetic: they are the raw
 * files `.data-probe/` holds for patch 16.16, straight from CommunityDragon and
 * Data Dragon. Every expected number below is the number the official wiki
 * publishes for Vi on that patch, so this file is where "did we read Riot's
 * format correctly" is actually decided.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findCalculation,
  findDataValue,
  findSpell,
  parseChampionBin,
  pickRank,
  type ChampionGameData,
} from '../src/data/bin';
import { validateGameData } from '../src/data/gamedata';
import { breakdown, evaluate, formatCalculation, ratioFor, statLookup, type StatLookup } from '../src/model/spellcalc';
import type { DDragonChampionDetail, DDragonSpell } from '../src/data/types';

function probe<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../.data-probe/${name}`, import.meta.url), 'utf8')) as T;
}

const RAW_BIN = probe<Record<string, unknown>>('vi-bin.json');
const DDRAGON = probe<{ data: Record<string, DDragonChampionDetail> }>('ddragon-vi.json').data.Vi!;

const GAME_DATA: ChampionGameData = parseChampionBin(RAW_BIN, 'Vi', '16.16');

const SPELL_BY_ID: Record<string, DDragonSpell | undefined> = Object.fromEntries(
  DDRAGON.spells.map((spell) => [spell.id, spell]),
);

/** A stat block with round numbers, so expected values stay checkable by hand. */
function stats(over: Partial<Record<'level' | 'baseAd' | 'bonusAd' | 'ap' | 'maxHealth', number>> = {}): StatLookup {
  const level = over.level ?? 11;
  const baseAd = over.baseAd ?? 60;
  const bonusAd = over.bonusAd ?? 100;
  return {
    level,
    value(stat, scaling) {
      if (stat === 'ad') return scaling === 'bonus' ? bonusAd : baseAd + bonusAd;
      if (stat === 'ap') return over.ap ?? 0;
      if (stat === 'maxHealth') return over.maxHealth ?? 2000;
      return 0;
    },
  };
}

const spell = (key: string) => findSpell(GAME_DATA, key);
const calc = (spellKey: string, calcKey: string) => findCalculation(spell(spellKey), calcKey);

describe('parseChampionBin', () => {
  it('finds every ability of the kit', () => {
    expect(Object.keys(GAME_DATA.spells).sort()).toEqual(
      expect.arrayContaining(['ViE', 'ViPassive', 'ViQ', 'ViR', 'ViW']),
    );
  });

  it('reads every formula in the kit', () => {
    expect(GAME_DATA.incomplete).toEqual([]);
  });

  it('ignores the Arena overrides', () => {
    // `DataValuesModeOverride` sets Q's AD ratio to 0.7 in Arena. Summoner's
    // Rift uses 0.6, and that is the only value the parser may surface.
    expect(findDataValue(spell('ViQ'), 'ADRatio', 1)).toBeCloseTo(0.6, 5);
  });
});

describe('per-rank array conventions', () => {
  it('indexes seven-entry arrays by rank', () => {
    const cooldowns = [1, 2, 3, 4, 5].map((rank) => pickRank(spell('ViQ')!.cooldown, rank));
    expect(cooldowns).toEqual([12, 10.5, 9, 7.5, 6]);
    expect(DDRAGON.spells.find((s) => s.id === 'ViQ')!.cooldownBurn).toBe('12/10.5/9/7.5/6');
  });

  it('indexes six-entry arrays by rank minus one', () => {
    const costs = [1, 2, 3, 4, 5].map((rank) => pickRank(spell('ViQ')!.cost, rank));
    expect(costs).toEqual([50, 60, 70, 80, 90]);
    expect(DDRAGON.spells.find((s) => s.id === 'ViQ')!.costBurn).toBe('50/60/70/80/90');
  });

  it('reads E recharge times, which only exist in the bin', () => {
    const recharge = [1, 2, 3, 4, 5].map((rank) => pickRank(spell('ViE')!.ammoRechargeTime, rank));
    expect(recharge).toEqual([12, 11, 10, 9, 8]);
  });
});

describe('validateGameData', () => {
  it('confirms the reading against Data Dragon', () => {
    const report = validateGameData(GAME_DATA, SPELL_BY_ID);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);
    // Flat arrays match under any indexing rule; these are the ones that prove it.
    expect(report.decisive).toBeGreaterThanOrEqual(10);
  });

  it('rejects data whose rank indexing has shifted', () => {
    const shifted = JSON.parse(JSON.stringify(RAW_BIN)) as Record<string, { mSpell?: { cooldownTime?: number[] } }>;
    const q = shifted['Characters/Vi/Spells/ViQAbility/ViQ']!;
    // Drop the level-0 padding entry: exactly the failure mode this guards.
    q.mSpell!.cooldownTime = [12, 10.5, 9, 7.5, 6, 6, 6];
    const report = validateGameData(parseChampionBin(shifted, 'Vi', '16.16'), SPELL_BY_ID);
    expect(report.ok).toBe(false);
    expect(report.mismatches[0]).toMatchObject({ spellId: 'ViQ', field: 'cooldown', rank: 1 });
  });

  it('reports nothing checkable as a failure, not a pass', () => {
    expect(validateGameData(null, SPELL_BY_ID).ok).toBe(false);
    expect(validateGameData(GAME_DATA, {}).ok).toBe(false);
  });
});

/**
 * Wiki, patch 16.16: 40/60/80/100/120 (+ 60% bonus AD), rising to
 * 100/150/200/250/300 (+ 150% bonus AD) at full charge.
 */
describe('Vault Breaker (Q)', () => {
  it('reads the uncharged formula', () => {
    const parts = breakdown(calc('ViQ', 'TotalDamage'), 3)!;
    expect(parts.flat).toBe(80);
    expect(parts.ratios).toEqual([{ stat: 'ad', scaling: 'bonus', ratio: 0.6000000238418579 }]);
  });

  it('reads the fully charged formula, multiplier folded in', () => {
    const parts = breakdown(calc('ViQ', 'MaxDamageTooltip'), 3)!;
    expect(parts.flat).toBe(200);
    expect(parts.ratios[0]!.ratio).toBeCloseTo(1.5, 5);
  });

  it('scales with bonus AD, not total AD', () => {
    // The whole point of the cross-check: 60% of 100 bonus AD is 60, not 96.
    expect(evaluate(calc('ViQ', 'TotalDamage'), 1, stats({ baseAd: 60, bonusAd: 100 }))).toBeCloseTo(100, 4);
  });

  it('lists every rank the way the wiki does', () => {
    const min = [1, 2, 3, 4, 5].map((rank) => breakdown(calc('ViQ', 'TotalDamage'), rank)!.flat);
    const max = [1, 2, 3, 4, 5].map((rank) => breakdown(calc('ViQ', 'MaxDamageTooltip'), rank)!.flat);
    expect(min).toEqual([40, 60, 80, 100, 120]);
    expect(max).toEqual([100, 150, 200, 250, 300]);
  });

  it('formats the formula the way the tooltip reads', () => {
    expect(formatCalculation(calc('ViQ', 'TotalDamage'), 1)).toBe('40 + 60% bonus AD');
    expect(formatCalculation(calc('ViQ', 'MaxDamageTooltip'), 1)).toBe('(40 + 60% bonus AD) × 2.5');
  });
});

/** Wiki: 4/5/6/7/8% (+ 3.5% per 100 bonus AD) of the target's maximum health. */
describe('Denting Blows (W)', () => {
  it('reads a percentage of maximum health', () => {
    const calculation = calc('ViW', 'TotalDamageTooltip');
    expect(calculation!.displayAsPercent).toBe(true);
    // Rank 1 with no bonus AD: 4 %.
    expect(evaluate(calculation, 1, stats({ bonusAd: 0 }))).toBeCloseTo(0.04, 6);
    // Rank 5 with 200 bonus AD: 8% + 7% = 15 %.
    expect(evaluate(calculation, 5, stats({ bonusAd: 200 }))).toBeCloseTo(0.15, 6);
  });

  it('lists the per-rank percentages', () => {
    const perRank = [1, 2, 3, 4, 5].map(
      (rank) => breakdown(calc('ViW', 'TotalDamageTooltip'), rank)!.flat,
    );
    expect(perRank.map((value) => Math.round(value * 1000) / 1000)).toEqual([
      0.04, 0.05, 0.06, 0.07, 0.08,
    ]);
  });

  it('reads the values the ability applies besides damage', () => {
    expect(findDataValue(spell('ViW'), 'ShredAmount', 1)).toBe(20);
    expect(findDataValue(spell('ViW'), 'SharedBuffsDuration', 1)).toBe(4);
    expect(findDataValue(spell('ViW'), 'MonsterDamageCap', 1)).toBe(300);
    expect(findDataValue(spell('ViW'), 'StacksBeforeEffect', 1)).toBe(2);
    expect([1, 2, 3, 4, 5].map((rank) => findDataValue(spell('ViW'), 'AttackSpeed', rank))).toEqual([
      30, 35, 40, 45, 50,
    ]);
  });

  it('formats percent formulas in percent units', () => {
    expect(formatCalculation(calc('ViW', 'TotalDamageTooltip'), 1)).toBe(
      '4% + 3.5% per 100 bonus AD',
    );
  });
});

/** Wiki: 10/30/50/70/90 (+ 110% AD) (+ 100% AP). */
describe('Relentless Force (E)', () => {
  it('scales with total AD and with AP', () => {
    const calculation = calc('ViE', 'TotalDamageTooltip');
    expect(ratioFor(calculation, 1, 'ad', 'total')).toBeCloseTo(1.1, 5);
    expect(ratioFor(calculation, 1, 'ad', 'bonus')).toBeNull();
    expect(ratioFor(calculation, 1, 'ap', 'total')).toBeCloseTo(1, 5);
  });

  it('evaluates to the tooltip number', () => {
    // Rank 3: 50 base + 110% of 160 total AD + 100% of 50 AP.
    const value = evaluate(calculation('ViE'), 3, stats({ baseAd: 60, bonusAd: 100, ap: 50 }));
    expect(value).toBeCloseTo(50 + 1.1 * 160 + 50, 4);
  });

  function calculation(key: string) {
    return calc(key, 'TotalDamageTooltip');
  }

  it('lists the per-rank base damage', () => {
    const perRank = [1, 2, 3, 4, 5].map((rank) => breakdown(calculation('ViE'), rank)!.flat);
    expect(perRank).toEqual([10, 30, 50, 70, 90]);
  });
});

/** Wiki: 150/250/350 (+ 90% bonus AD). */
describe('Cease and Desist (R)', () => {
  it('reads three ranks of base damage', () => {
    const perRank = [1, 2, 3].map((rank) => breakdown(calc('ViR', 'Damage'), rank)!.flat);
    expect(perRank).toEqual([150, 250, 350]);
  });

  it('scales with bonus AD', () => {
    expect(evaluate(calc('ViR', 'Damage'), 3, stats({ bonusAd: 100 }))).toBeCloseTo(440, 4);
  });
});

/** Wiki: shields 12% of maximum health for 3 s, cooldown 16 âˆ’ 12 by level. */
describe('Blast Shield (P)', () => {
  it('shields a share of maximum health', () => {
    expect(evaluate(calc('ViPassive', 'TotalShield'), 1, stats({ maxHealth: 2500 }))).toBeCloseTo(300, 4);
  });

  it('reads the level curve with its breakpoint', () => {
    const at = (level: number) => evaluate(calc('ViPassive', 'ShieldCooldown'), 1, stats({ level }));
    expect(at(1)).toBeCloseTo(16, 6);
    expect(at(5)).toBeCloseTo(14, 6);
    expect(at(9)).toBeCloseTo(12, 6);
    // The breakpoint at level 10 stops the scaling; it does not keep falling.
    expect(at(10)).toBeCloseTo(12, 6);
    expect(at(18)).toBeCloseTo(12, 6);
  });

  it('reads the shield duration', () => {
    expect(findDataValue(spell('ViPassive'), 'ShieldDuration', 1)).toBe(3);
  });
});

describe('unreadable formulas', () => {
  const withUnknownStat = {
    'Characters/Test/Spells/TestQ': {
      mScriptName: 'TestQ',
      mSpell: {
        DataValues: [{ name: 'Ratio', values: [1, 1, 1, 1, 1, 1, 1] }],
        mSpellCalculations: {
          Damage: {
            __type: 'GameCalculation',
            mFormulaParts: [
              { __type: 'StatByNamedDataValueCalculationPart', mStat: 47, mDataValue: 'Ratio' },
            ],
          },
        },
      },
    },
  };

  it('refuses to evaluate a formula it did not fully understand', () => {
    const parsed = parseChampionBin(withUnknownStat, 'Test', 'test');
    const calculation = findCalculation(findSpell(parsed, 'TestQ'), 'Damage');
    expect(calculation!.complete).toBe(false);
    expect(calculation!.parts[0]).toMatchObject({ kind: 'unsupported' });
    expect(evaluate(calculation, 1, stats())).toBeNull();
    expect(formatCalculation(calculation, 1)).toBeNull();
    expect(parsed.incomplete).toEqual(['TestQ.Damage']);
  });

  it('interpolates a level curve given as start and end value', () => {
    const raw = {
      'Characters/Test/Spells/TestW': {
        mScriptName: 'TestW',
        mSpell: {
          mSpellCalculations: {
            Amount: {
              __type: 'GameCalculation',
              mFormulaParts: [
                {
                  __type: 'ByCharLevelInterpolationCalculationPart',
                  mStartValue: 70,
                  mEndValue: 410,
                },
              ],
            },
          },
        },
      },
    };
    const calculation = findCalculation(findSpell(parseChampionBin(raw, 'Test', 'test'), 'TestW'), 'Amount');
    expect(evaluate(calculation, 1, stats({ level: 1 }))).toBeCloseTo(70, 6);
    expect(evaluate(calculation, 1, stats({ level: 18 }))).toBeCloseTo(410, 6);
    expect(evaluate(calculation, 1, stats({ level: 6 }))).toBeCloseTo(70 + (340 * 5) / 17, 6);
  });
});

/**
 * Riot changed the file format during season 15, and the patch switcher in the
 * header can select those patches. Three things differ on 15.6:
 *
 *   - named values live in `mDataValues` with `mName`/`mValues`, not in
 *     `DataValues` with `name`/`values`;
 *   - formulas reference unnamed effect slots (`EffectValueCalculationPart`)
 *     instead of named values;
 *   - maximum health is stat id 11, not 12. The id moved with patch 15.7.
 *
 * The expected numbers are Vi's kit as it stood then: Q at 45/70/95/120/145
 * (+ 80% bonus AD) doubling at full charge, and a 14% shield.
 */
describe('older patch formats', () => {
  const OLD_BIN = probe<Record<string, unknown>>('vi-bin-15.6.json');
  const OLD_DDRAGON = probe<{ data: Record<string, DDragonChampionDetail> }>('ddragon-vi-15.6.json').data.Vi!;
  const OLD = parseChampionBin(OLD_BIN, 'Vi', '15.6');
  const oldCalc = (spellKey: string, calcKey: string) =>
    findCalculation(findSpell(OLD, spellKey), calcKey);

  it('reads every formula in the old format too', () => {
    expect(OLD.incomplete).toEqual([]);
  });

  it('reads named values out of the renamed container', () => {
    const perRank = [1, 2, 3, 4, 5].map((rank) => breakdown(oldCalc('ViQ', 'TotalDamage'), rank)!.flat);
    expect(perRank).toEqual([45, 70, 95, 120, 145]);
    expect(ratioFor(oldCalc('ViQ', 'TotalDamage'), 1, 'ad', 'bonus')).toBeCloseTo(0.8, 5);
    // Back then a full charge doubled the damage instead of multiplying by 2.5.
    expect(breakdown(oldCalc('ViQ', 'MaxDamageTooltip'), 1)!.flat).toBeCloseTo(90, 5);
  });

  it('reads formulas that reference unnamed effect slots', () => {
    // W: 4% at rank 1, and 2.857% per 100 bonus AD in that patch.
    const w = oldCalc('ViW', 'TotalDamageTooltip');
    expect(breakdown(w, 1)!.flat).toBeCloseTo(0.04, 6);
    expect(evaluate(w, 1, stats({ bonusAd: 100 }))).toBeCloseTo(0.04 + 0.02857, 5);
  });

  it('uses the stat numbering of the selected patch', () => {
    // Stat id 11 on this patch, 12 from 15.7 on. Both mean maximum health.
    expect(ratioFor(oldCalc('ViPassive', 'TotalShield'), 1, 'maxHealth', 'total')).toBeCloseTo(0.14, 5);
  });

  it('would reject the old file if it were read with the new numbering', () => {
    const misread = parseChampionBin(OLD_BIN, 'Vi', '16.16');
    const shield = findCalculation(findSpell(misread, 'ViPassive'), 'TotalShield');
    expect(shield!.complete).toBe(false);
    expect(shield!.parts[0]).toMatchObject({ reason: 'unknown stat id mStat=11' });
  });

  it('still cross-checks against Data Dragon of that patch', () => {
    const spells = Object.fromEntries(OLD_DDRAGON.spells.map((entry) => [entry.id, entry]));
    const report = validateGameData(OLD, spells);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);
    // Data Dragon still published effect values then, so there is much more to
    // compare than on a current patch.
    expect(report.decisive).toBeGreaterThan(20);
  });
});

describe('statLookup', () => {
  it('maps the canonical stat keys onto the app stat block', () => {
    const lookup = statLookup({
      level: 9,
      baseAttackDamage: 70,
      bonusAttackDamage: 80,
      totalAttackDamage: 150,
      abilityPower: 40,
      maxHealth: 2200,
      bonusHealth: 700,
      bonusAttackSpeed: 0.4,
      totalAttackSpeed: 1.05,
    } as Parameters<typeof statLookup>[0]);

    expect(lookup.level).toBe(9);
    expect(lookup.value('ad', 'total')).toBe(150);
    expect(lookup.value('ad', 'bonus')).toBe(80);
    expect(lookup.value('ap', 'total')).toBe(40);
    expect(lookup.value('maxHealth', 'total')).toBe(2200);
    expect(lookup.value('maxHealth', 'bonus')).toBe(700);
    expect(lookup.value('attackSpeed', 'bonus')).toBeCloseTo(0.4, 6);
  });
});

