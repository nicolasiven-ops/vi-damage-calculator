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
import { repeatPlan } from '../src/state/runDuel';
import type { IncomingHit, Interruption, SimulationResult } from '../src/engine/types';

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
  /** Crowd control this side applies, which stops the other one. */
  cc: { start: number; end: number; soft?: boolean }[] = [],
  stops: Interruption[][] = [],
): DuelSide & { seen: IncomingHit[][]; stops: Interruption[][] } {
  const side = {
    name: 'side',
    combo: [],
    startingHealth: 1000,
    seen,
    stops,
    run: (incoming: IncomingHit[], stopped: Interruption[]): SimulationResult => {
      seen.push(incoming);
      stops.push(stopped);
      const instances = Array.from({ length: hits }, (_, index) => ({
        id: `h${index}`,
        time: every * (index + 1),
        mitigated: perHit,
        sourceLabel: 'Swing',
      }));
      return {
        instances,
        /* The engine records crowd control as spans in the `cc` lane. */
        spans: cc.map((window, index) => ({
          id: `cc${index}`,
          lane: 'cc',
          start: window.start,
          end: window.end,
          label: window.soft ? 'Slowed 30%' : 'Knocked up',
          stopsActions: !window.soft,
        })),
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

describe('the plan continues', () => {
  it('repeats the typed combo without changing its order', () => {
    const combo = [
      { uid: 'a', action: { kind: 'ability', slot: 'Q' } },
      { uid: 'b', action: { kind: 'attack' } },
    ] as never[];

    const plan = repeatPlan(combo, 10, (index) => `dup-${index}`);

    // The opening is exactly what was typed, uids and all.
    expect(plan.slice(0, 2)).toEqual(combo);
    expect(plan.length).toBeGreaterThan(combo.length);
    // And every round after it is the same order again.
    const kinds = plan.map((step) => (step as { action: { kind: string } }).action.kind);
    expect(kinds.slice(0, 4)).toEqual(['ability', 'attack', 'ability', 'attack']);
    // New presses need new ids, or the timeline cannot tell them apart.
    expect(new Set(plan.map((step) => (step as { uid: string }).uid)).size).toBe(plan.length);
  });

  it('leaves an empty combo empty', () => {
    // Nothing typed is a real answer: she stands there, and the duel says so.
    expect(repeatPlan([], 10, (index) => `dup-${index}`)).toEqual([]);
  });
});

describe('crowd control crosses over', () => {
  it("hands one side's stuns to the other as windows it cannot act in", () => {
    /*
     * The first real interaction between the two sides beyond damage. Vi's ultimate
     * is a 1.3 second knock-up, and until this existed that was a damage spell with
     * a note attached.
     */
    const aStops = [{ start: 1, end: 2.3 }];
    const a = swinger(100, 1, 5, [], aStops);
    const b = swinger(100, 1, 5, []);

    duel({ ...a, name: 'A' }, { ...b, name: 'B' }, { maxPasses: 2 });

    // B is told about A's knock-up; A is told about nothing, because B has none.
    const toldB = b.stops.at(-1) ?? [];
    expect(toldB).toEqual([{ from: 1, to: 2.3, label: 'Knocked up' }]);
    expect(a.stops.at(-1) ?? []).toEqual([]);
  });

  it('counts a change in crowd control as the answer still moving', () => {
    // The settle check compares deaths *and* stuns: a pass that changed only the
    // windows has changed the fight, and stopping there would freeze a half-answer.
    const a = swinger(100, 1, 5, [], [{ start: 0.5, end: 1.5 }]);
    const b = swinger(100, 1, 5, [], [{ start: 2, end: 2.5 }]);

    const result = duel({ ...a, name: 'A' }, { ...b, name: 'B' }, { maxPasses: 3 })!;
    expect(result.passes).toBeGreaterThanOrEqual(2);
  });
});

describe('a slow is not a stun', () => {
  it('only lets action-taking crowd control stop the other lane', () => {
    /*
     * The worst version of this feature was the first one: every crowd-control span
     * became a window of standing still, so Scorchclaw's 30% movement slow — which
     * is on almost every Vi combo — handed her two free seconds. Inventing time is
     * a worse error than ignoring crowd control altogether.
     */
    const hard = swinger(100, 1, 5, [], [{ start: 1, end: 2 }]);
    const target = swinger(100, 1, 5, []);
    duel({ ...hard, name: 'Hard' }, { ...target, name: 'Target' }, { maxPasses: 2 });
    expect(target.stops.at(-1)).toHaveLength(1);

    // The same window, recorded as a slow: the timeline keeps it, the lane does not.
    const soft = swinger(100, 1, 5, [], [{ start: 1, end: 2, soft: true }]);
    const other = swinger(100, 1, 5, []);
    duel({ ...soft, name: 'Soft' }, { ...other, name: 'Other' }, { maxPasses: 2 });
    expect(other.stops.at(-1)).toHaveLength(0);
  });
});
