import { describe, expect, it } from 'vitest';
import { effectiveResistance, mitigate, resistanceMultiplier } from '../src/engine/damage';

const NO_RESIST = {
  base: 0,
  flatReduction: 0,
  percentReduction: 0,
  percentPenetration: 0,
  flatPenetration: 0,
};

describe('resistanceMultiplier', () => {
  it('halves damage at 100 armor', () => {
    expect(resistanceMultiplier(100)).toBeCloseTo(0.5, 10);
  });

  it('is neutral at zero', () => {
    expect(resistanceMultiplier(0)).toBe(1);
  });

  it('amplifies with diminishing returns when negative', () => {
    // -100 armor gives +50%, not +100%.
    expect(resistanceMultiplier(-100)).toBeCloseTo(1.5, 10);
    expect(resistanceMultiplier(-200)).toBeCloseTo(2 - 100 / 300, 10);
  });
});

describe('effectiveResistance', () => {
  it('applies flat reduction before percent reduction', () => {
    // 100 armor − 20 flat = 80, then −50% = 40.
    // The other order would give 100 → 50 → 30.
    const value = effectiveResistance({
      ...NO_RESIST,
      base: 100,
      flatReduction: 20,
      percentReduction: 0.5,
    });
    expect(value).toBeCloseTo(40, 10);
  });

  it('applies percent penetration before flat penetration', () => {
    // 100 armor, 30% pen → 70, then 20 lethality → 50.
    // Flat-first would give 100 → 80 → 56.
    const value = effectiveResistance({
      ...NO_RESIST,
      base: 100,
      percentPenetration: 0.3,
      flatPenetration: 20,
    });
    expect(value).toBeCloseTo(50, 10);
  });

  it('never lets penetration push resistance below zero', () => {
    const value = effectiveResistance({ ...NO_RESIST, base: 30, flatPenetration: 100 });
    expect(value).toBe(0);
  });

  it('lets reduction push resistance negative, unlike penetration', () => {
    const value = effectiveResistance({ ...NO_RESIST, base: 30, flatReduction: 50 });
    expect(value).toBeCloseTo(-20, 10);
  });

  it('does not let percent reduction amplify an already negative resistance', () => {
    const value = effectiveResistance({
      ...NO_RESIST,
      base: 10,
      flatReduction: 30,
      percentReduction: 0.5,
    });
    // −20 must stay −20 rather than becoming −10 or −30.
    expect(value).toBeCloseTo(-20, 10);
  });
});

describe('mitigate', () => {
  const base = {
    armor: { ...NO_RESIST, base: 100 },
    magicResist: { ...NO_RESIST, base: 100 },
    percentDamageReduction: 0,
    flatDamageReduction: 0,
    amplification: 0,
  };

  it('ignores resistances for true damage', () => {
    const result = mitigate({ ...base, raw: 500, type: 'true' });
    expect(result.mitigated).toBeCloseTo(500, 10);
  });

  it('applies armor to physical damage only', () => {
    expect(mitigate({ ...base, raw: 500, type: 'physical' }).mitigated).toBeCloseTo(250, 10);
    expect(mitigate({ ...base, raw: 500, type: 'magic' }).mitigated).toBeCloseTo(250, 10);
  });

  it('amplifies before resistances, reduces after', () => {
    const result = mitigate({
      ...base,
      raw: 500,
      type: 'physical',
      amplification: 0.1,
      percentDamageReduction: 0.2,
      flatDamageReduction: 25,
    });
    // 500 × 1.1 = 550 → ×0.5 armor = 275 → ×0.8 = 220 → −25 = 195.
    expect(result.mitigated).toBeCloseTo(195, 10);
  });

  it('never returns negative damage', () => {
    const result = mitigate({ ...base, raw: 10, type: 'physical', flatDamageReduction: 500 });
    expect(result.mitigated).toBe(0);
  });
});
