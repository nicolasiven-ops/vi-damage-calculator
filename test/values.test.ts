import { describe, expect, it } from 'vitest';
import { cooldownValue, effectValue } from '../src/model/champions/types';
import type { DDragonSpell } from '../src/data/types';
import { FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * Riot ships zero-filled `effect` arrays for reworked kits. Vi is one of them:
 * live Data Dragon reports 0 for every base damage in her kit. Those zeros must
 * never win over the maintained constants — accepting them silently deletes the
 * entire base-damage component of the combo.
 */
function zeroFilledSpell(): DDragonSpell {
  return {
    ...FIXTURE_SPELLS_BY_ID.ViQ!,
    effect: [null, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
    cooldown: [0, 0, 0, 0, 0],
  };
}

describe('effectValue', () => {
  it('prefers a usable Data Dragon value', () => {
    const result = effectValue(FIXTURE_SPELLS_BY_ID.ViQ, 1, 5, [999]);
    expect(result).toEqual({ value: 120, source: 'ddragon' });
  });

  it('treats a Data Dragon zero as missing and keeps the registry constant', () => {
    const result = effectValue(zeroFilledSpell(), 1, 5, [40, 60, 80, 100, 120]);
    expect(result.value).toBe(120);
    expect(result.source).toBe('registry');
    expect(result.note).toMatch(/Data Dragon returns 0 here/);
  });

  it('falls back when the spell is missing entirely', () => {
    const result = effectValue(undefined, 1, 3, [40, 60, 80, 100, 120]);
    expect(result).toMatchObject({ value: 80, source: 'registry' });
  });

  it('clamps the rank to the fallback range instead of returning zero', () => {
    expect(effectValue(undefined, 1, 9, [10, 20, 30]).value).toBe(30);
    expect(effectValue(undefined, 1, 0, [10, 20, 30]).value).toBe(10);
  });

  it('rejects a negative Data Dragon value', () => {
    const spell = { ...FIXTURE_SPELLS_BY_ID.ViQ!, effect: [null, [-5, -5, -5, -5, -5]] };
    expect(effectValue(spell, 1, 1, [40]).source).toBe('registry');
  });
});

describe('cooldownValue', () => {
  it('uses Data Dragon cooldowns, which Riot does keep populated', () => {
    expect(cooldownValue(FIXTURE_SPELLS_BY_ID.ViQ, 1, [99])).toEqual({
      value: 10,
      source: 'ddragon',
    });
  });

  it('treats a zero cooldown as missing', () => {
    const result = cooldownValue(zeroFilledSpell(), 1, [14, 12.5, 11, 9.5, 8]);
    expect(result.value).toBe(14);
    expect(result.source).toBe('registry');
  });
});
