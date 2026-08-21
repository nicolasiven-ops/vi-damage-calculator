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
 * The moment at a point in time, for playback.
 *
 * The same reading as a focused step, addressed differently: the last snapshot
 * at or before the clock. That is what lets the panel be played rather than
 * clicked — the values move because the moment moves, not because anything new
 * is computed.
 */
export function fightMomentAt(
  analysis: { snapshots: StatSnapshot[] } | null,
  seconds: number,
  fallback: { attacker: ChampionStats; target: StatSnapshot['target'] },
): FightMoment {
  const list = analysis?.snapshots ?? [];
  let index = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]!.time <= seconds + 0.0005) index = i;
  }
  if (index < 0) {
    // Before the first snapshot: the state the combo started from.
    return fightMoment(analysis, null, fallback);
  }
  const source = list[index]!;
  const previous = index > 0 ? list[index - 1] : undefined;
  return {
    attacker: source.attacker,
    attackerResource: source.attackerResource,
    /*
     * Cooldowns are carried forward to the real clock rather than left at the
     * snapshot's. Snapshots only exist where something happened, so reading them
     * raw made every cooldown tick down in jumps of a whole step — a number that
     * stood still for a second and then dropped by a second. The countdown is
     * arithmetic on the elapsed time, so it can simply be finished here, and the
     * icons then run down as smoothly as the frame clock allows.
     */
    abilities: advanceCooldowns(source.abilities, seconds - source.time),
    shieldGained: source.shieldGained,
    target: source.target,
    // The live clock, not the last thing that happened: the playhead is here.
    time: Math.max(source.time, seconds),
    targetLostNow: previous
      ? Math.max(0, previous.target.currentHealth - source.target.currentHealth)
      : 0,
    stepUid: source.stepUid ?? null,
    stepNumber: source.index >= 0 ? source.index + 1 : null,
    isEnd: index === list.length - 1,
    previous: previous
      ? { attacker: previous.attacker, target: previous.target }
      : null,
  };
}

/** Count cooldowns down by the seconds passed since the snapshot was taken. */
function advanceCooldowns(
  abilities: StatSnapshot['abilities'],
  elapsed: number,
): StatSnapshot['abilities'] {
  if (elapsed <= 0.0005) return abilities;
  return abilities.map((ability) => {
    const readyIn = Math.max(0, ability.readyIn - elapsed);
    if (readyIn === ability.readyIn) return ability;
    if (!ability.charges) return { ...ability, readyIn };
    // A recharging ability hands itself a charge when its timer runs out.
    const nextIn = Math.max(0, ability.charges.nextIn - elapsed);
    const gained = ability.charges.nextIn > 0 && nextIn === 0 ? 1 : 0;
    return {
      ...ability,
      readyIn,
      charges: {
        ...ability.charges,
        available: Math.min(ability.charges.max, ability.charges.available + gained),
        nextIn,
      },
    };
  });
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
