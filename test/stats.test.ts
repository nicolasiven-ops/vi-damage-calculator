import { describe, expect, it } from 'vitest';
import {
  cooldownMultiplier,
  emptyStats,
  resolveChampionStats,
  sumStats,
  withPublishedGrowth,
} from '../src/model/stats';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

describe('sumStats', () => {
  it('adds ordinary stats', () => {
    const total = sumStats([{ attackDamage: 45 }, { attackDamage: 30 }, { hp: 400 }]);
    expect(total.attackDamage).toBe(75);
    expect(total.hp).toBe(400);
  });

  it('stacks armor penetration multiplicatively, not additively', () => {
    // Lord Dominik's 35% + Serylda's 30% leaves 0.65 × 0.70 = 45.5% armor.
    const total = sumStats([{ armorPenPercent: 0.35 }, { armorPenPercent: 0.3 }]);
    expect(total.armorPenPercent).toBeCloseTo(1 - 0.65 * 0.7, 10);
    expect(total.armorPenPercent).toBeLessThan(0.65);
  });

  it('stacks magic penetration and tenacity the same way', () => {
    expect(sumStats([{ magicPenPercent: 0.4 }, { magicPenPercent: 0.4 }]).magicPenPercent).toBeCloseTo(
      0.64,
      10,
    );
    expect(sumStats([{ tenacity: 0.3 }, { tenacity: 0.2 }]).tenacity).toBeCloseTo(0.44, 10);
  });

  it('leaves a single source untouched', () => {
    expect(sumStats([{ armorPenPercent: 0.35 }]).armorPenPercent).toBeCloseTo(0.35, 10);
  });

  it('reports zero penetration when nothing grants it', () => {
    expect(sumStats([{ attackDamage: 10 }]).armorPenPercent).toBe(0);
  });
});

describe('resolveChampionStats', () => {
  it('separates base from bonus attack damage', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, {
      ...emptyStats(),
      attackDamage: 100,
    });
    expect(stats.bonusAttackDamage).toBe(100);
    expect(stats.totalAttackDamage).toBeCloseTo(stats.baseAttackDamage + 100, 10);
  });

  it('scales attack speed off the ratio, not the total', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 1, {
      ...emptyStats(),
      attackSpeed: 1,
    });
    // base + ratio × bonus, with ratio equal to base attack speed.
    expect(stats.totalAttackSpeed).toBeCloseTo(0.65 + 0.65 * 1, 10);
  });

  it('derives flat armor penetration from lethality one-to-one', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, {
      ...emptyStats(),
      lethality: 18,
    });
    expect(stats.flatArmorPen).toBe(18);
  });
});

describe('cooldownMultiplier', () => {
  it('halves cooldowns at 100 ability haste', () => {
    expect(cooldownMultiplier(100)).toBeCloseTo(0.5, 10);
  });

  it('is neutral at zero and never amplifies for negative input', () => {
    expect(cooldownMultiplier(0)).toBe(1);
    expect(cooldownMultiplier(-50)).toBe(1);
  });
});

/**
 * The gap that made a level 11 Vi hit like a level 1 Vi.
 *
 * Data Dragon ships `attackdamageperlevel: 0` for every champion in 16.16.1, in
 * the summary file and the per-champion file alike. Read straight, that is a
 * champion whose attack damage never grows: 63 at level 11 where the game says
 * 94, and every total that reads attack damage short by the difference. Riot does
 * publish the number, in the champion's own character record.
 */
describe('withPublishedGrowth', () => {
  const zeroed = { ...FIXTURE_CHAMPION_STATS, attackdamage: 63, attackdamageperlevel: 0 };

  it('fills in the growth Data Dragon stopped shipping', () => {
    const fixed = withPublishedGrowth(zeroed, 3.5);
    expect(fixed.attackdamageperlevel).toBe(3.5);

    // Riot's own curve at level 11: 63 + 3.5 × 10 × (0.7025 + 0.175) = 93.7,
    // which is the 94 the in-game HUD shows for Vi.
    const stats = resolveChampionStats(fixed, 11, emptyStats());
    expect(stats.baseAttackDamage).toBeCloseTo(93.7125, 4);
  });

  it('leaves a value Data Dragon does ship alone', () => {
    // The day Riot starts publishing it again is not the day to start ignoring it.
    const shipped = { ...zeroed, attackdamageperlevel: 4 };
    expect(withPublishedGrowth(shipped, 3.5).attackdamageperlevel).toBe(4);
  });

  it('changes nothing when the character record is missing', () => {
    expect(withPublishedGrowth(zeroed, null)).toBe(zeroed);
  });
});
