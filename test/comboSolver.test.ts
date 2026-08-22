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

describe('completing a combo that is already typed', () => {
  const table = {
    slow: { damage: 100, seconds: 1 },
    fast: { damage: 60, seconds: 0.4 },
  };

  it('keeps the typed presses in front of everything it tries', () => {
    const typed: ComboStep[] = [
      { uid: 'typed-1#slow', action: { kind: 'attack' } },
      { uid: 'typed-2#slow', action: { kind: 'attack' } },
    ];

    const result = solveFastestKill({
      actions: [labelled('slow', 'Slow'), labelled('fast', 'Fast')],
      run: runnerFor(table, 260),
      startingHealth: 260,
      prefix: typed,
      limits: { maxSteps: 4, beam: 20, maxSimulations: 800, horizonSeconds: 10 },
    });

    expect(result.best).not.toBeNull();
    // The two typed presses are still the first two, unchanged.
    expect(result.best!.steps.slice(0, 2).map((step) => step.uid)).toEqual([
      'typed-1#slow',
      'typed-2#slow',
    ]);
    // 200 damage from the prefix, 60 more finishes it: one fast press at 2.4 s.
    expect(result.best!.killTime).toBeCloseTo(2.4, 6);
  });

  it('answers with the typed combo itself when that already kills', () => {
    const typed: ComboStep[] = [
      { uid: 'typed-1#slow', action: { kind: 'attack' } },
      { uid: 'typed-2#slow', action: { kind: 'attack' } },
    ];

    const result = solveFastestKill({
      actions: [labelled('fast', 'Fast')],
      run: runnerFor(table, 150),
      startingHealth: 150,
      prefix: typed,
      limits: { maxSteps: 4, beam: 20, maxSimulations: 800, horizonSeconds: 10 },
    });

    // Nothing to search for: appending presses to a corpse only makes the list
    // longer, so the prefix comes back as the answer.
    expect(result.best!.steps).toHaveLength(2);
    expect(result.simulations).toBe(1);
  });
});

describe('presses that earn nothing', () => {
  it('leaves out a press that costs no time and changes no kill time', () => {
    /*
     * "Free" is exactly Smite's shape: no time, a little damage. The search will
     * happily take it, because it is scored on the kill alone — so the answer has
     * to be asked afterwards whether every press in it did anything.
     */
    const table = {
      hit: { damage: 100, seconds: 1 },
      free: { damage: 20, seconds: 0 },
    };

    const result = solveFastestKill({
      actions: [labelled('hit', 'Hit'), labelled('free', 'Free')],
      run: runnerFor(table, 300),
      startingHealth: 300,
      limits: { maxSteps: 6, beam: 40, maxSimulations: 3000, horizonSeconds: 10 },
    });

    // Three hits kill at 3 s with or without the free press alongside them.
    expect(result.best!.killTime).toBeCloseTo(3, 6);
    expect(result.best!.labels).toEqual(['Hit', 'Hit', 'Hit']);
  });

  /**
   * A fight read off a script: this order kills then, that one kills later.
   *
   * The arithmetic runner above cannot express "drop this press and the target
   * still dies, just later" — that needs cooldowns or a burn, which it has none
   * of. So the two cases around the tolerance are simply written down.
   */
  function scripted(script: Record<string, number>, health: number) {
    return (steps: ComboStep[]): SimulationResult => {
      const ids = steps.map((step) => String(step.uid).split('#')[1] ?? '');
      const killTime = script[ids.join('>')] ?? null;
      /*
       * The search treats two prefixes at the same clock with the same health as
       * the same problem, which is the whole point of it — so a fixture where
       * "Main, Extra" and "Extra, Main" leave exactly the same health would have
       * one of them thrown away before it could be expanded. Where the extra press
       * sits therefore has to move the number, as it would in any real fight.
       */
      const spread = ids.reduce((sum, id, at) => sum + (id === 'extra' ? (at + 1) * 7 : 0), 0);
      return {
        duration: steps.length * 0.5,
        killTime,
        targetHpRemaining: killTime === null ? health / 2 - spread : 0,
        totalMitigated: killTime === null ? health / 2 + spread : health,
      } as SimulationResult;
    };
  }

  it('keeps a press that buys more than a tick', () => {
    // 0.90 s with the extra press against 1.00 s without it: a hundred
    // milliseconds is three server ticks, which is a real gain in a real fight.
    const result = solveFastestKill({
      actions: [labelled('main', 'Main'), labelled('extra', 'Extra')],
      run: scripted({ 'main>main': 1.0, 'main>extra>main': 0.9 }, 400),
      startingHealth: 400,
      limits: { maxSteps: 3, beam: 40, maxSimulations: 3000, horizonSeconds: 10 },
    });

    expect(result.best!.killTime).toBeCloseTo(0.9, 6);
    expect(result.best!.labels).toEqual(['Main', 'Extra', 'Main']);
  });

  it('drops a press that buys less than a tick', () => {
    // Same shape, but the press is worth 10 ms. The game itself cannot see that:
    // it ticks thirty times a second, so this is a press for the arithmetic.
    const result = solveFastestKill({
      actions: [labelled('main', 'Main'), labelled('extra', 'Extra')],
      run: scripted({ 'main>main': 1.0, 'main>extra>main': 0.99 }, 400),
      startingHealth: 400,
      limits: { maxSteps: 3, beam: 40, maxSimulations: 3000, horizonSeconds: 10 },
    });

    expect(result.best!.labels).toEqual(['Main', 'Main']);
    expect(result.best!.killTime).toBeCloseTo(1.0, 6);
  });

  it('never trims a press the caller typed', () => {
    // The prefix is his opener, not a suggestion: even a press that contributes
    // nothing stays, because removing it would answer a question nobody asked.
    const table = {
      hit: { damage: 100, seconds: 1 },
      free: { damage: 0, seconds: 0 },
    };
    const typed: ComboStep[] = [{ uid: 'typed-1#free', action: { kind: 'attack' } }];

    const result = solveFastestKill({
      actions: [labelled('hit', 'Hit')],
      run: runnerFor(table, 200),
      startingHealth: 200,
      prefix: typed,
      limits: { maxSteps: 4, beam: 20, maxSimulations: 800, horizonSeconds: 10 },
    });

    expect(result.best!.steps[0]!.uid).toBe('typed-1#free');
    expect(result.best!.steps).toHaveLength(3);
  });
});
