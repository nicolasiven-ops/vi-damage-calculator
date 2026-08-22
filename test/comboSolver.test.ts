import { describe, expect, it } from 'vitest';
import { solveFastestKill, type SolverAction } from '../src/model/comboSolver';
import type { ComboStep, SimulationResult } from '../src/engine/types';

/**
 * The search, against a runner made of arithmetic.
 *
 * The point of these is the search behaviour rather than any champion's numbers:
 * that it finds the fastest order rather than the strongest single press, that it
 * stops at a kill, that it cannot run away with the page, and that it reports how
 * hard it looked.
 */
/**
 * A fake engine: each action has a damage and a cost in seconds, read off the
 * labels the solver appended. Nothing about the real engine is involved, which is
 * what makes these tests about the search.
 */
function runnerFor(
  table: Record<string, { damage: number; seconds: number }>,
  health: number,
): (steps: ComboStep[]) => SimulationResult | null {
  return (steps) => {
    let damage = 0;
    let time = 0;
    let killTime: number | null = null;
    for (const step of steps) {
      const entry = table[String(step.uid).split('#')[1] ?? ''] ?? { damage: 0, seconds: 1 };
      time += entry.seconds;
      damage += entry.damage;
      if (killTime === null && damage >= health) killTime = time;
    }
    return {
      duration: time,
      killTime,
      targetHpRemaining: Math.max(0, health - damage),
      totalMitigated: damage,
    } as SimulationResult;
  };
}

/** The label is carried in the uid, so the fake runner can price a step. */
function labelled(id: string, label: string): SolverAction {
  return {
    id,
    label,
    make: (uid) => ({ uid: `${uid}#${id}`, action: { kind: 'attack' } }) as ComboStep,
  };
}

describe('the fastest-kill search', () => {
  const table = {
    slow: { damage: 100, seconds: 1 },
    fast: { damage: 60, seconds: 0.4 },
  };

  it('prefers the order that kills soonest, not the biggest hit', () => {
    // 300 health: three slow presses take 3 s, five fast ones take 2 s.
    const result = solveFastestKill({
      actions: [labelled('slow', 'Slow'), labelled('fast', 'Fast')],
      run: runnerFor(table, 300),
      startingHealth: 300,
      limits: { maxSteps: 6, beam: 40, maxSimulations: 2000, horizonSeconds: 10 },
    });

    expect(result.best).not.toBeNull();
    expect(result.best!.killTime).toBeCloseTo(2, 6);
    expect(result.best!.labels.every((label) => label === 'Fast')).toBe(true);
  });

  it('reports nothing when nothing kills inside the horizon', () => {
    const result = solveFastestKill({
      actions: [labelled('fast', 'Fast')],
      run: runnerFor(table, 100000),
      startingHealth: 100000,
      limits: { maxSteps: 4, beam: 10, maxSimulations: 500, horizonSeconds: 10 },
    });

    expect(result.best).toBeNull();
  });

  it('stays inside its simulation budget and says when it stopped early', () => {
    const result = solveFastestKill({
      actions: [
        labelled('a', 'A'),
        labelled('b', 'B'),
        labelled('c', 'C'),
      ],
      run: runnerFor(
        { a: { damage: 10, seconds: 0.5 }, b: { damage: 11, seconds: 0.5 }, c: { damage: 12, seconds: 0.5 } },
        100000,
      ),
      startingHealth: 100000,
      limits: { maxSteps: 8, beam: 200, maxSimulations: 50, horizonSeconds: 30 },
    });

    expect(result.simulations).toBeLessThanOrEqual(50);
    expect(result.hitLimit).toBe(true);
  });

  it('offers runners-up, and never the same order twice', () => {
    const result = solveFastestKill({
      actions: [labelled('slow', 'Slow'), labelled('fast', 'Fast')],
      run: runnerFor(table, 180),
      startingHealth: 180,
      limits: { maxSteps: 5, beam: 40, maxSimulations: 2000, horizonSeconds: 10 },
    });

    const orders = [result.best!, ...result.runnersUp].map((entry) => entry.labels.join('>'));
    expect(new Set(orders).size).toBe(orders.length);
    // And they are in order: the best is the fastest.
    const times = [result.best!, ...result.runnersUp].map((entry) => entry.killTime ?? Infinity);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
