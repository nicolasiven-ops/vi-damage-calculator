/**
 * A duel: two runs that feed each other until they agree.
 *
 * The temptation here is a second engine — a loop that steps both sides at once.
 * That would be a fork of the damage model, and a fork is the one thing this app
 * cannot afford: two models that disagree cannot both be shown, and the reader
 * has no way to tell which one lied. So a duel is built out of the engine that
 * already exists, twice.
 *
 * It works because the coupling between the two sides is narrow. What A does to B
 * depends on B's *health* — thresholds like Cut Down, Coup de Grace, Dark Harvest,
 * and current-health items like Blade of the Ruined King — and B's health depends
 * only on A's damage. The cross-link is A's *own* health, which only B can lower,
 * and which A's own effects read: Last Stand, Sterak's, Overlord's.
 *
 * That is a fixed point, and it is reached by iteration:
 *
 *   1. Run A with nothing incoming, run B with nothing incoming.
 *   2. Feed each side's outgoing damage to the other as incoming, and run again.
 *   3. Repeat until the outcome stops moving.
 *
 * Two passes are usually enough and three always were in testing; the loop stops
 * early when the death time and the surviving health both hold still. The passes
 * are reported, because a duel that needed the maximum is a duel whose answer is
 * worth reading with more suspicion.
 *
 * What this does **not** model, and what the display has to say out loud: nobody
 * moves. There is no distance, so no walking out of range, no kiting, no missed
 * skillshot, no dash used to escape rather than engage. Both sides stand in each
 * other's face and press buttons. That is the ceiling of a fight rather than a
 * fight — the same honest limit the one-sided simulation has always had, now
 * applied to both ends of it.
 */

import type { ComboStep, IncomingHit, Interruption, SimulationResult } from './types';

/** One side of the fight: how to run it, and what it has to lose. */
export interface DuelSide {
  name: string;
  /**
   * Runs this side's plan against the other, with whatever is arriving and
   * whatever is stopping them.
   *
   * A closure rather than a build, so the caller keeps ownership of how a side is
   * assembled — items, runes, champion module — and this file never learns.
   */
  run: (incoming: IncomingHit[], stopped: Interruption[]) => SimulationResult | null;
  /** The plan, kept only so the result can report what was pressed. */
  combo: ComboStep[];
  /** Health at the start of the fight, after the health-percent setting. */
  startingHealth: number;
}

export interface DuelOutcome {
  /** Which side is left standing, or null when both survive the horizon. */
  winner: 'a' | 'b' | null;
  /** When the loser died, or the length of the fight when nobody did. */
  endTime: number;
  /** Health each side has left at `endTime`. */
  healthA: number;
  healthB: number;
  /** Health over time, for drawing. One point per damage instance, plus the start. */
  curveA: { time: number; health: number }[];
  curveB: { time: number; health: number }[];
  a: SimulationResult;
  b: SimulationResult;
  /** How many times each side had to be re-run before the answer held still. */
  passes: number;
  /** True when the loop hit its ceiling rather than settling. */
  unsettled: boolean;
}

export interface DuelLimits {
  /** Re-runs per side. Two is usually enough; three always was. */
  maxPasses: number;
  /**
   * Seconds after which a fight nobody wins is called a draw.
   *
   * A duel that has gone fifteen seconds is not a duel any more — somebody has
   * walked away, healed, or been joined by a friend, and none of those are things
   * this model knows about.
   */
  horizonSeconds: number;
}

export const DEFAULT_DUEL_LIMITS: DuelLimits = { maxPasses: 3, horizonSeconds: 15 };

/**
 * The damage one run dealt, as the other side's incoming.
 *
 * Only what actually got through: `mitigated` is post-resistance because in that
 * run the other champion *was* the target. Instances that landed after the fight
 * ended are dropped by the caller, not here — this is a straight translation.
 */
function outgoing(result: SimulationResult, label: string): IncomingHit[] {
  return result.instances
    .filter((instance) => instance.mitigated > 0)
    .map((instance) => ({
      time: instance.time,
      amount: instance.mitigated,
      label: `${label}: ${instance.sourceLabel}`,
    }))
    .sort((first, second) => first.time - second.time);
}

/**
 * The crowd control one run applied, as windows the other side cannot act in.
 *
 * Read off the timeline rather than tracked separately: the engine already records
 * every stun, knock-up and fear as a span in the `cc` lane, because the display
 * needed it. What the duel adds is a consequence.
 */
function stopsFrom(result: SimulationResult): Interruption[] {
  return result.spans
    /*
     * Only the crowd control that takes an action. A slow is crowd control and
     * belongs on the timeline, and treating it as a window of standing still
     * invented two free seconds on every combo that carries Scorchclaw.
     */
    .filter((span) => span.lane === 'cc' && span.stopsActions === true && span.end > span.start)
    .map((span) => ({ from: span.start, to: span.end, label: span.label }))
    .sort((first, second) => first.from - second.from);
}

/** A health curve from a starting pool and the hits that arrive. */
function curveOf(startingHealth: number, hits: IncomingHit[]): { time: number; health: number }[] {
  const curve = [{ time: 0, health: startingHealth }];
  let health = startingHealth;
  for (const hit of hits) {
    health = Math.max(0, health - hit.amount);
    curve.push({ time: hit.time, health });
    if (health <= 0) break;
  }
  return curve;
}

/** The moment a pool of health runs out, or null when it does not. */
function deathTime(startingHealth: number, hits: IncomingHit[]): number | null {
  let health = startingHealth;
  for (const hit of hits) {
    health -= hit.amount;
    if (health <= 0) return hit.time;
  }
  return null;
}

export function duel(
  a: DuelSide,
  b: DuelSide,
  limits: Partial<DuelLimits> = {},
): DuelOutcome | null {
  const { maxPasses, horizonSeconds } = { ...DEFAULT_DUEL_LIMITS, ...limits };

  let intoA: IncomingHit[] = [];
  let intoB: IncomingHit[] = [];
  let stopA: Interruption[] = [];
  let stopB: Interruption[] = [];
  let runA = a.run(intoA, stopA);
  let runB = b.run(intoB, stopB);
  if (!runA || !runB) return null;

  let passes = 1;
  let unsettled = true;
  let previous = '';

  for (; passes <= maxPasses; passes += 1) {
    intoA = outgoing(runB, b.name);
    intoB = outgoing(runA, a.name);
    /*
     * Each side's crowd control stops the other. This is what makes the loop a
     * fixed point over more than damage: A stuns B, so B acts later, so B's damage
     * lands later, so A lives longer — which can change when A's own stun lands.
     */
    stopA = stopsFrom(runB);
    stopB = stopsFrom(runA);

    /*
     * The fight ends when the first side falls, so anything arriving after that
     * never happened — including the loser's own last cast, which in a real duel
     * they did not live to finish.
     */
    const deathA = deathTime(a.startingHealth, intoA);
    const deathB = deathTime(b.startingHealth, intoB);
    const ends = [deathA, deathB].filter((value): value is number => value !== null);
    const cut = ends.length > 0 ? Math.min(...ends) : Infinity;

    const settled = `${deathA ?? -1}|${deathB ?? -1}|${stopA.length}|${stopB.length}`;
    if (settled === previous) {
      unsettled = false;
      break;
    }
    previous = settled;

    const nextA = a.run(intoA.filter((hit) => hit.time <= cut + 0.0005), stopA);
    const nextB = b.run(intoB.filter((hit) => hit.time <= cut + 0.0005), stopB);
    if (!nextA || !nextB) return null;
    runA = nextA;
    runB = nextB;
  }

  // The last word, from the runs as they finally stand.
  const finalIntoA = outgoing(runB, b.name);
  const finalIntoB = outgoing(runA, a.name);
  const deathA = deathTime(a.startingHealth, finalIntoA);
  const deathB = deathTime(b.startingHealth, finalIntoB);

  /*
   * Both dying is not a draw: whoever died first stopped dealing damage, so the
   * earlier death decides it. Equal to the millisecond is a genuine trade, and it
   * is reported as nobody winning rather than picked arbitrarily.
   */
  let winner: 'a' | 'b' | null = null;
  let endTime = Math.max(runA.duration, runB.duration);
  if (deathA !== null || deathB !== null) {
    const timeA = deathA ?? Infinity;
    const timeB = deathB ?? Infinity;
    endTime = Math.min(timeA, timeB);
    if (Math.abs(timeA - timeB) > 0.0005) winner = timeA < timeB ? 'b' : 'a';
  }
  endTime = Math.min(endTime, horizonSeconds);

  const inA = finalIntoA.filter((hit) => hit.time <= endTime + 0.0005);
  const inB = finalIntoB.filter((hit) => hit.time <= endTime + 0.0005);
  const curveA = curveOf(a.startingHealth, inA);
  const curveB = curveOf(b.startingHealth, inB);

  return {
    winner,
    endTime,
    healthA: curveA[curveA.length - 1]?.health ?? a.startingHealth,
    healthB: curveB[curveB.length - 1]?.health ?? b.startingHealth,
    curveA,
    curveB,
    a: runA,
    b: runB,
    passes,
    unsettled,
  };
}
