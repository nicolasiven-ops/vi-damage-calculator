import { describe, expect, it } from 'vitest';
import type { ComboAnalysis } from '../src/engine/analysis';
import { itemValues, killCarriedBy } from '../src/model/itemValue';

/**
 * The arithmetic of the ledger, on made-up runs.
 *
 * The measurement itself is the engine's job and is covered where the engine is
 * covered; what is worth pinning here is what the ledger does with two numbers —
 * the ranking, the price per gold, and the one claim it makes on its own ("this
 * item carries the kill").
 */
function analysisStub(total: number, killTime: number | null): ComboAnalysis {
  return { totalMitigated: total, killTime } as unknown as ComboAnalysis;
}

const ITEMS = [
  { id: 'a', name: 'Dear', imageFile: 'a.png', gold: 3000 },
  { id: 'b', name: 'Cheap', imageFile: 'b.png', gold: 1000 },
  { id: 'c', name: 'Free', imageFile: 'c.png', gold: 0 },
];

function run(withoutTotals: Record<string, number>, kills: Record<string, boolean> = {}) {
  return itemValues({
    items: ITEMS,
    base: analysisStub(1000, 3),
    runWithout: (id) => analysisStub(withoutTotals[id] ?? 1000, kills[id] === false ? null : 1),
    isModelled: (id) => id === 'a',
  });
}

describe('item value', () => {
  it('measures a contribution as what the combo loses without the item', () => {
    const rows = run({ a: 700, b: 900, c: 990 });
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]!.contribution).toBe(300);
    expect(rows[0]!.share).toBeCloseTo(0.3, 6);
  });

  it('prices contributions per thousand gold, and refuses to for free items', () => {
    const rows = run({ a: 700, b: 900, c: 990 });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // 300 damage for 3,000 g is a hundred per thousand; 100 for 1,000 g is a
    // hundred as well — the ranking by contribution and the ranking by value
    // are different questions, which is the whole reason both columns exist.
    expect(byId.get('a')!.perThousandGold).toBeCloseTo(100, 6);
    expect(byId.get('b')!.perThousandGold).toBeCloseTo(100, 6);
    expect(byId.get('c')!.perThousandGold).toBeNull();
  });

  it('ranks the cheaper of two equal contributors first', () => {
    const rows = run({ a: 800, b: 800, c: 1000 });
    expect(rows[0]!.id).toBe('b');
  });

  it('names the item that carries the kill, and only when it is the only one', () => {
    const one = run({ a: 700, b: 900, c: 990 }, { a: false });
    expect(killCarriedBy(one)?.id).toBe('a');

    const two = run({ a: 700, b: 900, c: 990 }, { a: false, b: false });
    // Two items that each break the kill means neither one carries it.
    expect(killCarriedBy(two)).toBeNull();
  });

  it('marks items whose passive is not modelled', () => {
    const rows = run({ a: 700, b: 900, c: 990 });
    expect(rows.filter((row) => !row.passiveModelled).map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('reports a negative contribution rather than hiding it', () => {
    // Ability haste can genuinely lose damage: a compressed timeline can drop a
    // proc against its own internal cooldown. A ledger that clamps at zero
    // would hide exactly the case worth seeing.
    const rows = run({ a: 1100, b: 900, c: 1000 });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('a')!.contribution).toBe(-100);
  });
});
