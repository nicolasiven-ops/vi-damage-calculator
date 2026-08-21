/**
 * The state of the fight at the step in focus.
 *
 * One combo, one focused moment, three places that have to agree about it: the
 * bars and tiles in the middle, the attacker's stat sheet on the left, the
 * target's on the right. Each of them deriving it separately is how they drift
 * apart, so it is derived once, here, and handed down.
 */

import type { StatSnapshot } from '../engine/types';
import type { ChampionStats } from '../model/stats';

export interface FightMoment {
  /** The attacker's stats as they stood, buffs included. */
  attacker: ChampionStats;
  /** The attacker's resource at this moment, spent by casts. */
  attackerResource: { current: number; max: number };
  /** What is up and what is on cooldown at this moment. */
  abilities: StatSnapshot['abilities'];
  shieldGained: number;
  target: StatSnapshot['target'];
  /** Seconds into the combo. */
  time: number;
  /**
   * Health the target lost in this very step.
   *
   * The bar draws it as the translucent chunk the client shows for damage just
   * taken, so a step is readable as "this much of that bar was this hit".
   */
  targetLostNow: number;
  /** Which step this is the state after; null for the end of the combo. */
  stepUid: string | null;
  /** Step number as the strip counts them, or null at the end. */
  stepNumber: number | null;
  /** True when this is the last snapshot rather than a focused step. */
  isEnd: boolean;
  /**
   * The moment to measure this one against, so every row can show what moved.
   *
   * A focused step is compared with the step before it — "what did this step
   * change" is the question a focused step asks. With nothing focused the end of
   * the combo is compared with its start, which answers the other one: what did
   * the whole thing do.
   */
  previous: { attacker: ChampionStats; target: StatSnapshot['target'] } | null;
}

/**
 * Pick the snapshot in focus, falling back to the end of the combo and then —
 * for an empty combo, where the simulation has nothing to snapshot — to the
 * build's own figures.
 */
export function fightMoment(
  // Anything that carries snapshots: the raw simulation or the analysed result.
  analysis: { snapshots: StatSnapshot[] } | null,
  focusedStepUid: string | null,
  fallback: { attacker: ChampionStats; target: StatSnapshot['target'] },
): FightMoment {
  const list = analysis?.snapshots ?? [];
  const focused = focusedStepUid
    ? list.find((entry) => entry.stepUid === focusedStepUid)
    : undefined;
  const index = focused ? list.indexOf(focused) : list.length - 1;
  const source = list[index];
  // The step's own damage: what the bar read before it, minus what it reads now.
  const previous = index > 0 ? list[index - 1] : undefined;
  // Unfocused, the comparison is the combo's start rather than its second-last
  // step: the sheet is then showing a result, not a step.
  const against = focused ? previous : index > 0 ? list[0] : undefined;

  if (!source) {
    return {
      attacker: fallback.attacker,
      attackerResource: {
        current: fallback.attacker.maxMana,
        max: fallback.attacker.maxMana,
      },
      abilities: [],
      shieldGained: 0,
      target: fallback.target,
      time: 0,
      targetLostNow: 0,
      stepUid: null,
      stepNumber: null,
      isEnd: true,
      previous: null,
    };
  }

  return {
    attacker: source.attacker,
    attackerResource: source.attackerResource,
    abilities: source.abilities,
    shieldGained: source.shieldGained,
    target: source.target,
    time: source.time,
    targetLostNow: previous
      ? Math.max(0, previous.target.currentHealth - source.target.currentHealth)
      : 0,
    stepUid: focused ? (focused.stepUid ?? null) : null,
    stepNumber: focused ? focused.index + 1 : null,
    isEnd: !focused,
    previous:
      against && against !== source
        ? { attacker: against.attacker, target: against.target }
        : null,
  };
}
