/**
 * The combo that kills fastest, found by searching.
 *
 * The app has always answered "what does this combo do". This answers the
 * question a player actually has in the moment: <em>what should I press?</em>
 *
 * Every candidate is scored by running the real `simulate()` on it — not an
 * approximation of it. That is the expensive choice and the only defensible one:
 * a solver whose model differs from the app's would recommend an order the app
 * then reports as worse, and there is no way for a reader to tell which of the two
 * lied. One simulation is a fraction of a millisecond, and the search is bounded
 * hard enough that a few thousand of them fit inside a click.
 *
 * What the search may change: the order of presses, which presses happen at all,
 * and how long a chargeable ability is held. What it may not: the build, the
 * ranks, the target, or anything about the fight the player did not offer it.
 *
 * What stays honest: the target stands still and every hit lands, exactly as
 * everywhere else in this app. The answer is "the best order against a target
 * that lets you have it", which is the upper bound of a real duel and is stated
 * as such rather than sold as a plan.
 */

import type { ComboStep, SimulationResult } from '../engine/types';

/** One thing the solver may press, in the alphabet it searches over. */
export interface SolverAction {
  /** Stable id, for logging and for the memo key. */
  id: string;
  /** How it reads in the result: "Q (charged)", "AA", "Ignite". */
  label: string;
  make: (uid: string) => ComboStep;
}

export interface SolverLimits {
  /** Longest sequence the search will build. */
  maxSteps: number;
  /** Candidates kept per depth. The beam. */
  beam: number;
  /** Hard ceiling on simulations, so a click cannot hang the page. */
  maxSimulations: number;
  /**
   * Seconds past which a kill is not worth reporting.
   *
   * A fight nobody is in does not last twenty seconds, and without a horizon the
   * search happily "wins" by pressing basic attacks until something dies.
   */
  horizonSeconds: number;
}

/**
 * One server tick: the resolution the game itself runs at.
 *
 * League ticks thirty times a second, so a press that moves the kill by less than
 * a thirtieth of a second moved nothing anybody could observe — it is a press for
 * the arithmetic, not for the fight. That is the line the answer is trimmed
 * against, and it is a physical number rather than a taste.
 */
export const TICK_SECONDS = 1 / 30;

export const DEFAULT_LIMITS: SolverLimits = {
  maxSteps: 8,
  beam: 120,
  maxSimulations: 6000,
  horizonSeconds: 10,
};

export interface SolverCandidate {
  steps: ComboStep[];
  /** The labels in order, for showing the answer as a sentence. */
  labels: string[];
  /** When the target died, or null when it survived. */
  killTime: number | null;
  damage: number;
  /** Health the target had left; zero when it died. */
  remaining: number;
}

export interface SolverResult {
  best: SolverCandidate | null;
  /** The next few, so the answer can be compared rather than trusted. */
  runnersUp: SolverCandidate[];
  simulations: number;
  /** True when the search stopped on its own budget rather than exhausting. */
  hitLimit: boolean;
}

/**
 * What the search needs from the caller: how to run a sequence.
 *
 * The raw simulation rather than an analysis — a candidate is four numbers and a
 * decision, and building a curve for one that is about to be discarded was most
 * of the cost of the search.
 */
export type SolverRunner = (steps: ComboStep[]) => SimulationResult | null;

interface Node {
  steps: ComboStep[];
  labels: string[];
  /** Seconds the sequence takes so far. */
  time: number;
  /** Target health after it. */
  remaining: number;
  damage: number;
}

/**
 * How aggressively two nodes are treated as the same position.
 *
 * The point of the search is that most orderings are not distinct: a hundred
 * prefixes arrive at the same clock with the same health and the same cooldowns,
 * and only one of them needs to be carried forward. Rounding is what turns "the
 * same" from a coincidence into a rule — 50 ms and 5 health are finer than any
 * decision the result reports.
 */
function positionKey(node: Node): string {
  return `${Math.round(node.time * 20)}:${Math.round(node.remaining / 5)}`;
}

/**
 * Nodes worth expanding, best first.
 *
 * Health removed per second spent, which is the only ranking that answers the
 * question being asked. A node that has already killed is not expanded at all —
 * there is nothing left to press.
 */
function score(node: Node, startingHealth: number): number {
  const removed = startingHealth - node.remaining;
  return node.time > 0.0005 ? removed / node.time : removed;
}

export interface SolveArgs {
  actions: SolverAction[];
  run: SolverRunner;
  /** The health the target starts the fight with, for scoring. */
  startingHealth: number;
  /**
   * Presses the search must keep, in front of everything it tries.
   *
   * "Finish what I typed" is a different question from "what should I press",
   * and it is the more common one: a player has an opener they like and wants to
   * know what closes it. Every candidate is then the prefix plus a tail, so the
   * prefix's own cooldowns, mana and buffs are already spent when the search
   * starts choosing.
   */
  prefix?: ComboStep[];
  limits?: Partial<SolverLimits>;
  /** Makes the uids; injected so results are reproducible in tests. */
  uid?: (index: number) => string;
}

/**
 * The same kill with the free-riders taken out.
 *
 * The search answers "what kills fastest" and nothing else, so a press that adds
 * damage at no cost in time joins the answer even when the target was dying
 * anyway. Smite is the clearest case — it costs no cast time and it costs ninety
 * seconds of recharge, and the search can only see the first half. Reading a combo
 * with a press in it that changes nothing is worse than reading one without it.
 *
 * So every press is asked to justify itself: drop it, run the fight again, and if
 * the target still dies within a tick of the fastest known time, it was never part
 * of the combo. Late presses are tried first, because that is where padding
 * collects, and one accepted drop restarts the pass — removing a press changes the
 * timing of everything after it.
 *
 * The budget is fixed once from the original best, so a chain of drops cannot
 * creep: whatever comes out is at most one tick slower than the fastest order
 * found, and every press in it earns at least that much.
 */
function trimFreeRiders(
  best: SolverCandidate,
  run: SolverRunner,
  keep: number,
): { candidate: SolverCandidate; simulations: number } {
  const budget = (best.killTime ?? 0) + TICK_SECONDS;
  /* A prefix is one label for the whole of it, so label and step indices differ. */
  const labelOffset = keep > 0 ? 1 : 0;

  let steps = best.steps;
  let labels = best.labels;
  let killTime = best.killTime;
  let damage = best.damage;
  let simulations = 0;

  for (let dropping = true; dropping && steps.length > keep; ) {
    dropping = false;
    for (let index = steps.length - 1; index >= keep; index -= 1) {
      const shorter = [...steps.slice(0, index), ...steps.slice(index + 1)];
      const attempt = run(shorter);
      simulations += 1;
      if (!attempt || attempt.killTime === null || attempt.killTime > budget) continue;

      const labelAt = labelOffset + (index - keep);
      steps = shorter;
      labels = labels.filter((_, at) => at !== labelAt);
      killTime = attempt.killTime;
      damage = attempt.totalMitigated;
      dropping = true;
      break;
    }
  }

  return { candidate: { steps, labels, killTime, damage, remaining: 0 }, simulations };
}

export function solveFastestKill(args: SolveArgs): SolverResult {
  const limits = { ...DEFAULT_LIMITS, ...args.limits };
  const uid = args.uid ?? ((index: number) => `solve-${index}`);

  let simulations = 0;
  let counter = 0;
  let hitLimit = false;

  const found: SolverCandidate[] = [];
  const prefix = args.prefix ?? [];

  /*
   * The starting position: nothing pressed, or everything the caller insists on.
   *
   * A prefix that already kills is the answer — there is nothing to search for,
   * and appending presses to a corpse would only make the list longer.
   */
  let root: Node = { steps: prefix, labels: [], time: 0, remaining: args.startingHealth, damage: 0 };
  if (prefix.length > 0) {
    const start = args.run(prefix);
    simulations += 1;
    if (start) {
      root = {
        steps: prefix,
        labels: ['(as typed)'],
        time: start.duration,
        remaining: Math.max(0, start.targetHpRemaining),
        damage: start.totalMitigated,
      };
      if (start.killTime !== null) {
        return {
          best: {
            steps: prefix,
            labels: ['(as typed)'],
            killTime: start.killTime,
            damage: start.totalMitigated,
            remaining: 0,
          },
          runnersUp: [],
          simulations,
          hitLimit: false,
        };
      }
    }
  }

  let frontier: Node[] = [root];

  for (let depth = 0; depth < limits.maxSteps; depth += 1) {
    const next: Node[] = [];
    const seen = new Map<string, number>();

    for (const node of frontier) {
      for (const action of args.actions) {
        if (simulations >= limits.maxSimulations) {
          hitLimit = true;
          break;
        }

        counter += 1;
        const steps = [...node.steps, action.make(uid(counter))];
        const run = args.run(steps);
        simulations += 1;
        if (!run) continue;

        /*
         * The engine reports the whole run, so a sequence that kills on its
         * third press reports that time however many presses were appended
         * after it. Which means a killing prefix is a finished answer and the
         * tail is noise — the candidate is recorded with the steps that mattered.
         */
        const killTime = run.killTime;
        const candidate: Node = {
          steps,
          labels: [...node.labels, action.label],
          time: run.duration,
          remaining: Math.max(0, run.targetHpRemaining),
          damage: run.totalMitigated,
        };

        if (killTime !== null) {
          if (killTime <= limits.horizonSeconds) {
            found.push({
              steps,
              labels: candidate.labels,
              killTime,
              damage: candidate.damage,
              remaining: 0,
            });
          }
          // A dead target ends this branch: nothing after it can be faster.
          continue;
        }

        if (candidate.time > limits.horizonSeconds) continue;

        /*
         * One node per position, keeping the one that got there having done more
         * damage. Two prefixes at the same clock with the same health left are
         * the same problem from here on.
         */
        const key = positionKey(candidate);
        const at = seen.get(key);
        if (at === undefined) {
          seen.set(key, next.length);
          next.push(candidate);
        } else if (candidate.damage > next[at]!.damage) {
          next[at] = candidate;
        }
      }
      if (hitLimit) break;
    }

    if (next.length === 0) break;
    next.sort((a, b) => score(b, args.startingHealth) - score(a, args.startingHealth));
    frontier = next.slice(0, limits.beam);
    if (hitLimit) break;
  }

  /*
   * Fastest kill wins; among equal times the one with fewer presses, because a
   * shorter list is a plan a person can actually execute.
   */
  found.sort(
    (a, b) => (a.killTime ?? Infinity) - (b.killTime ?? Infinity) || a.steps.length - b.steps.length,
  );

  /*
   * One entry per genuinely different answer.
   *
   * Two filters, and the second is the one that matters. Identical orders are
   * dropped, obviously — but so are orders that kill at the same moment with more
   * presses, because those are the winning plan with something harmless appended.
   * "E → Smite" and "E → Flash → Smite" at the same 0.28 s are one answer and a
   * padded copy of it, and showing both as alternatives is how a runners-up list
   * becomes noise.
   */
  const unique: SolverCandidate[] = [];
  const seenOrders = new Set<string>();
  for (const candidate of found) {
    const key = candidate.labels.join('>');
    if (seenOrders.has(key)) continue;
    seenOrders.add(key);

    const padded = unique.some(
      (kept) =>
        Math.abs((kept.killTime ?? 0) - (candidate.killTime ?? 0)) < 0.005 &&
        kept.steps.length < candidate.steps.length,
    );
    if (padded) continue;

    unique.push(candidate);
    if (unique.length >= 5) break;
  }

  const winner = unique[0];
  if (!winner) return { best: null, runnersUp: [], simulations, hitLimit };

  const trimmed = trimFreeRiders(winner, args.run, prefix.length);
  simulations += trimmed.simulations;

  /*
   * A trimmed winner can turn out to be an order the list already held further
   * down, which would then read as its own alternative.
   */
  const order = trimmed.candidate.labels.join('>');
  return {
    best: trimmed.candidate,
    runnersUp: unique.slice(1).filter((other) => other.labels.join('>') !== order),
    simulations,
    hitLimit,
  };
}
