/**
 * Skill points: how many you have, and which of the ones you spent still count.
 *
 * Until now the app stored five rank numbers and let you set any of them to
 * anything. That is a build a player cannot have — the default was Q5 W4 E3 R2 at
 * level 11, which is fourteen points spent out of eleven, and every number in the
 * app was computed from it. A calculator whose starting position is impossible
 * cannot be checked against the game.
 *
 * So ranks stop being state and become a reading of two things that are: the
 * order the points went in, and the level. One point per level, so at level 11
 * the first eleven entries of the order are what you have; anything past that is
 * remembered but not spent. Drag the level down and the last-skilled points go
 * grey in the order they were taken, which is what the client does when you look
 * at a lower-level version of the same page.
 *
 * Keeping the order rather than a count is what makes that possible, and it is
 * also the more truthful thing to store: "Q first, then W" is a decision a player
 * made, and "Q at rank 5" is only its residue.
 *
 * One rule is deliberately absent: the ultimate's 6/11/16 unlock levels. Riot
 * publishes those nowhere machine-readable — they are wiki-only — and a realistic
 * order puts R's first point at position six anyway, so the budget already refuses
 * it in every case except deliberately clicking R first. It is named here so the
 * gap is a decision rather than an oversight.
 */

import type { AbilitySlot } from '../engine/types';

/** The four slots a point can go into. The passive is not skilled. */
export const SKILLABLE: AbilitySlot[] = ['Q', 'W', 'E', 'R'];

/** Points available at a level: one per level, which is where 18 = 5+5+5+3 comes from. */
export function pointsAtLevel(level: number): number {
  return Math.max(1, Math.min(18, Math.round(level)));
}

/**
 * A typical Vi order, used to invent one for a build saved before this existed.
 *
 * Q first and maxed first, W second, R on cooldown at 6/11/16, E last — which is
 * how the champion is played and, more to the point here, a legal order: five,
 * five, five and three, with the ultimate only at the levels it unlocks.
 */
export const DEFAULT_ORDER: AbilitySlot[] = [
  'Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E',
];

export interface SkillState {
  /** Rank per slot, counting only the points the level pays for. */
  ranks: Record<AbilitySlot, number>;
  /** Points the order spends at this level. */
  spent: number;
  /** Points available at this level. */
  available: number;
  /**
   * Points skilled beyond the budget, in order, with the rank each *would* be.
   *
   * The rank matters for drawing: a held-back third point in W has to grey the
   * third pip, not the next free one.
   */
  held: { slot: AbilitySlot; rank: number }[];
}

/**
 * What an order comes to at a level.
 *
 * Walks the order once, spending while the budget lasts and recording the rest.
 * A point that would exceed an ability's maximum is skipped rather than counted —
 * an order can only get into that state by being edited by hand or by a champion
 * changing, and silently granting a sixth rank would be worse than ignoring it.
 */
export function resolveSkills(
  order: AbilitySlot[],
  level: number,
  maxRanks: Partial<Record<AbilitySlot, number>>,
): SkillState {
  const available = pointsAtLevel(level);
  const ranks: Record<AbilitySlot, number> = { P: 1, Q: 0, W: 0, E: 0, R: 0 };
  const held: { slot: AbilitySlot; rank: number }[] = [];
  /** Ranks as the order reaches them, budget or no budget. */
  const reached: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 };
  let spent = 0;

  for (const slot of order) {
    const cap = maxRanks[slot] ?? 5;
    if ((reached[slot] ?? 0) >= cap) continue;
    reached[slot] = (reached[slot] ?? 0) + 1;

    if (spent < available) {
      spent += 1;
      ranks[slot] = reached[slot]!;
    } else {
      held.push({ slot, rank: reached[slot]! });
    }
  }

  return { ranks, spent, available, held };
}

/** Whether another point can go into a slot right now, and why not when it cannot. */
export function canSkill(
  order: AbilitySlot[],
  level: number,
  slot: AbilitySlot,
  maxRanks: Partial<Record<AbilitySlot, number>>,
): { ok: true } | { ok: false; why: string } {
  const state = resolveSkills(order, level, maxRanks);
  const cap = maxRanks[slot] ?? 5;
  if ((state.ranks[slot] ?? 0) >= cap) {
    return { ok: false, why: `${slot} is already at rank ${cap}` };
  }
  if (state.spent >= state.available) {
    return {
      ok: false,
      why: `no points left — ${state.available} at level ${level}, all spent`,
    };
  }
  return { ok: true };
}

/**
 * One more point in a slot, placed where the level can pay for it.
 *
 * Inserted at the end of the *spent* stretch rather than the end of the list. In
 * the ordinary case those are the same index — a point is only ever held because
 * the budget ran out, so nothing can be spent while anything is held. They differ
 * when the order carries an entry no maximum allows, which an edited or
 * champion-swapped build can produce: the new point belongs among the spent ones,
 * not behind an entry that will never be spent at all.
 */
export function skillUp(
  order: AbilitySlot[],
  level: number,
  slot: AbilitySlot,
  maxRanks: Partial<Record<AbilitySlot, number>>,
): AbilitySlot[] {
  if (!canSkill(order, level, slot, maxRanks).ok) return order;
  const { spent } = resolveSkills(order, level, maxRanks);
  return [...order.slice(0, spent), slot, ...order.slice(spent)];
}

/** The last point put into a slot, taken back. */
export function skillDown(order: AbilitySlot[], slot: AbilitySlot): AbilitySlot[] {
  const at = order.lastIndexOf(slot);
  if (at < 0) return order;
  return [...order.slice(0, at), ...order.slice(at + 1)];
}

/** Every point in a slot, taken back — the "click past the last rank" gesture. */
export function clearSkill(order: AbilitySlot[], slot: AbilitySlot): AbilitySlot[] {
  return order.filter((entry) => entry !== slot);
}

/**
 * An order that produces the given ranks, for a build saved before orders existed.
 *
 * Follows `DEFAULT_ORDER` and keeps each entry only while that slot still owes a
 * point, which yields a realistic interleaving rather than a run of five Qs — it
 * matters because the order decides what greys out first. Anything the template
 * cannot place (a rank the template gives later than the points allow) is appended,
 * so no rank is ever silently lost.
 */
export function orderFromRanks(ranks: Partial<Record<AbilitySlot, number>>): AbilitySlot[] {
  const owed: Record<string, number> = {
    Q: ranks.Q ?? 0,
    W: ranks.W ?? 0,
    E: ranks.E ?? 0,
    R: ranks.R ?? 0,
  };
  const order: AbilitySlot[] = [];

  for (const slot of DEFAULT_ORDER) {
    if ((owed[slot] ?? 0) <= 0) continue;
    owed[slot] = (owed[slot] ?? 0) - 1;
    order.push(slot);
  }
  for (const slot of SKILLABLE) {
    for (let left = owed[slot] ?? 0; left > 0; left -= 1) order.push(slot);
  }
  return order;
}
