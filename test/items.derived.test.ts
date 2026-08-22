import { describe, expect, it } from 'vitest';
import { itemDerivedStats } from '../src/model/itemEffects';
import { emptyStats, resolveChampionStats } from '../src/model/stats';
import { FIXTURE_CHAMPION_STATS } from './fixtures';

/**
 * Items whose stat line is a function of the build.
 *
 * Every expected value is arithmetic on a literal from Riot's bin, not on the
 * module's own constant — a test that reads the constant the implementation reads
 * proves only that the file is self-consistent.
 */
function baselineWith(bonus: Partial<ReturnType<typeof emptyStats>>) {
  return resolveChampionStats(FIXTURE_CHAMPION_STATS, 14, { ...emptyStats(), ...bonus });
}

function derivedFor(id: string, bonus: Partial<ReturnType<typeof emptyStats>> = {}) {
  const baseline = baselineWith(bonus);
  const blocks = itemDerivedStats([id], { level: 14, baseline });
  return { baseline, block: blocks[0] ?? {} };
}

describe("Sterak's Gage (3053)", () => {
  it('grants half of base attack damage', () => {
    // Items/3053 BonusAD = mStat 2 (attack damage), mStatFormula 1 (base),
    // ADtoAD 0.5.
    const { baseline, block } = derivedFor('3053', { attackDamage: 100 });
    expect(block.attackDamage).toBeCloseTo(baseline.baseAttackDamage * 0.5, 6);
    // Explicitly *not* half of total: the bonus 100 must not be counted.
    expect(block.attackDamage).toBeLessThan((baseline.baseAttackDamage + 100) * 0.5);
  });
});

describe('Manamune (3004)', () => {
  it('grants 2% of maximum mana as attack damage', () => {
    // Items/3004 BonusADFromMana coefficient 0.02.
    const { baseline, block } = derivedFor('3004', { mana: 500 });
    expect(block.attackDamage).toBeCloseTo(baseline.maxMana * 0.02, 6);
  });
});

describe("Archangel's Staff (3003)", () => {
  it('grants 1% of bonus mana as ability power', () => {
    // Items/3003 APFromMana 0.01, and Riot's text says *bonus* mana, so the
    // champion's own mana pool must not be counted.
    const { block } = derivedFor('3003', { mana: 800 });
    expect(block.abilityPower).toBeCloseTo(800 * 0.01, 6);
  });
});

describe("Winter's Approach (3119)", () => {
  it('grants 15% of bonus mana as health', () => {
    // Items/3119 BonusHPFromMana coefficient 0.15, mStatFormula 2 (bonus).
    const { block } = derivedFor('3119', { mana: 600 });
    expect(block.hp).toBeCloseTo(600 * 0.15, 6);
  });
});

describe('Endless Hunger (2517)', () => {
  it('grants 5 ability haste plus 13% of bonus attack damage', () => {
    // Items/2517, melee formula: 5 + 0.13 x mStat 2 mStatFormula 2 (bonus AD).
    const { block } = derivedFor('2517', { attackDamage: 200 });
    expect(block.abilityHaste).toBeCloseTo(5 + 200 * 0.13, 6);
  });
});

describe('Swiftmarch (3170)', () => {
  it('turns 5% of movement speed into attack damage at the adaptive rate', () => {
    // Items/3170 MSAdaptiveRatio 0.05, and one Adaptive Force is 0.6 attack
    // damage.
    const { baseline, block } = derivedFor('3170', { moveSpeedFlat: 65 });
    expect(block.attackDamage).toBeCloseTo(baseline.moveSpeed * 0.05 * 0.6, 6);
  });
});

describe("Rabadon's Deathcap (3089)", () => {
  it('adds 30% of the ability power the build already has', () => {
    // Items/3089 APAmp 0.30.
    const { block } = derivedFor('3089', { abilityPower: 300 });
    expect(block.abilityPower).toBeCloseTo(300 * 0.3, 6);
  });

  it('adds nothing to a build with no ability power', () => {
    const { block } = derivedFor('3089', { attackDamage: 300 });
    expect(block.abilityPower ?? 0).toBeCloseTo(0, 6);
  });
});

describe("Overlord's Bloodmail (2501)", () => {
  it('grants 2.5% of bonus health as attack damage', () => {
    // Items/2501 HPToADPercentage 0.025 on mStat 12 mStatFormula 2 (bonus
    // health), so the champion's own health pool is not counted.
    const { block } = derivedFor('2501', { hp: 1000 });
    expect(block.attackDamage).toBeCloseTo(1000 * 0.025, 6);
  });
});

describe('the derived pass as a whole', () => {
  it('returns nothing for items that derive nothing', () => {
    expect(itemDerivedStats(['3071'], { level: 14, baseline: baselineWith({}) })).toEqual([]);
  });

  it('reads one baseline, so two derived items do not compound', () => {
    /*
     * Rabadon's reads the ability power resolved before the derived pass, so
     * Archangel's mana-to-ability-power does not feed it. That is a deliberate
     * limit — one pass, no second-order effects — and it is worth pinning,
     * because the alternative (iterating to a fixed point) would quietly inflate
     * every build that owns both.
     */
    const baseline = baselineWith({ mana: 800, abilityPower: 100 });
    const [archangels, rabadons] = itemDerivedStats(['3003', '3089'], { level: 14, baseline });
    expect(archangels!.abilityPower).toBeCloseTo(8, 6);
    expect(rabadons!.abilityPower).toBeCloseTo(30, 6);
  });
});
