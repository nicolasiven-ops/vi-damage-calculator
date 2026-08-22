/**
 * The duel driver, against runners made of arithmetic.
 *
 * What is being tested is the coupling, not any champion's numbers: that each
 * side's damage becomes the other's incoming, that the fight ends when the first
 * side falls, that nothing after that counts, and that the loop settles instead of
 * running to its ceiling. A fake runner is the only way to test that — with a real
 * build the assertions would be about Vi.
 */

import { describe, expect, it } from 'vitest';
import { duel, type DuelSide } from '../src/engine/duel';
import type { IncomingHit, SimulationResult } from '../src/engine/types';

/**
 * A side that swings for a fixed amount on a fixed clock.
 *
 * It also reports what it was handed, so a test can check that the driver fed it
 * the other side's damage rather than an empty list.
 */
function swinger(
  perHit: number,
  every: number,
  hits: number,
  seen: IncomingHit[][] = [],
): DuelSide & { seen: IncomingHit[][] } {
  const side = {
    name: 'side',
    combo: [],
    startingHealth: 1000,
    seen,
    run: (incoming: IncomingHit[]): SimulationResult => {
      seen.push(incoming);
      const instances = Array.from({ length: hits }, (_, index) => ({
        id: `h${index}`,
        time: every * (index + 1),
        mitigated: perHit,
        sourceLabel: 'Swing',
      }));
      return {
        instances,
        duration: every * hits,
        totalMitigated: perHit * hits,
        killTime: null,
        targetHpRemaining: 0,
      } as unknown as SimulationResult;
    },
  };
  return side;
}

describe('a duel is two runs feeding each other', () => {
  it('hands each side the other side damage', () => {
    const a = swinger(100, 1, 5);
    const b = swinger(100, 1, 5);
    duel({ ...a, name: 'A' }, { ...b, name: 'B' }, { maxPasses: 2 });

    // First pass with nothing, then with the other's five swings.
    expect(a.seen[0]).toEqual([]);
    expect(a.seen[1]!.length).toBeGreaterThan(0);
    expect(a.seen[1]![0]!.label).toContain('B');
  });

  it('calls it a draw when both sides are identical', () => {
    const result = duel(
      { ...swinger(100, 1, 20), name: 'A', startingHealth: 500 },
      { ...swinger(100, 1, 20), name: 'B', startingHealth: 500 },
    )!;

    // 500 health against 100 a second: both fall on the fifth swing.
    expect(result.endTime).toBeCloseTo(5, 6);
    expect(result.winner).toBeNull();
  });

  it('gives it to whoever kills first, however narrowly', () => {
    const result = duel(
      { ...swinger(100, 1, 20), name: 'A', startingHealth: 500 },
      // B hits marginally slower, so A gets there first.
      { ...swinger(100, 1.05, 20), name: 'B', startingHealth: 500 },
    )!;

    expect(result.winner).toBe('a');
    expect(result.endTime).toBeCloseTo(5, 6);
    // A took four of B's swings before B fell on A's fifth.
    expect(result.healthA).toBeCloseTo(500 - 400, 6);
    expect(result.healthB).toBe(0);
  });

  it('drops what would have arrived after the loser fell', () => {
    const result = duel(
      { ...swinger(250, 1, 20), name: 'A', startingHealth: 2000 },
      { ...swinger(100, 1, 20), name: 'B', startingHealth: 500 },
    )!;

    // B dies on A's second swing, at 2 s. B's own swings past that never land.
    expect(result.winner).toBe('a');
    expect(result.endTime).toBeCloseTo(2, 6);
    expect(result.healthA).toBeCloseTo(2000 - 200, 6);
    expect(result.curveA.every((point) => point.time <= 2.0005)).toBe(true);
  });

  it('settles rather than running to its ceiling', () => {
    const result = duel(
      { ...swinger(100, 1, 10), name: 'A', startingHealth: 450 },
      { ...swinger(80, 1, 10), name: 'B', startingHealth: 900 },
    )!;

    // The fake sides do not react to what they take, so the second pass already
    // agrees with the first — and the loop is expected to notice.
    expect(result.unsettled).toBe(false);
    expect(result.passes).toBeLessThanOrEqual(3);
  });

  it('reports a fight nobody wins as a draw with health left', () => {
    const result = duel(
      { ...swinger(10, 1, 3), name: 'A', startingHealth: 1000 },
      { ...swinger(10, 1, 3), name: 'B', startingHealth: 1000 },
    )!;

    expect(result.winner).toBeNull();
    expect(result.healthA).toBe(970);
    expect(result.healthB).toBe(970);
  });
});
