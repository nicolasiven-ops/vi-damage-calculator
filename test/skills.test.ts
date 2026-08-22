/**
 * Skill points: the budget, and what happens to the points it cannot pay for.
 *
 * The old model let any rank be set to any number, and the app's own default was
 * fourteen points at level eleven. These tests are the rule that replaced it, and
 * the interesting half is not the arithmetic — it is the order. Which point goes
 * grey when the level drops is a question only a stored order can answer, and
 * getting it wrong would look like the app forgetting a decision.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER,
  canSkill,
  clearSkill,
  orderFromRanks,
  pointsAtLevel,
  resolveSkills,
  skillDown,
  skillUp,
} from '../src/model/skills';
import type { AbilitySlot } from '../src/engine/types';

/** Vi's own maximums. */
const CAPS: Partial<Record<AbilitySlot, number>> = { Q: 5, W: 5, E: 5, R: 3 };

describe('the point budget', () => {
  it('gives one point per level, and eighteen is exactly a full page', () => {
    expect(pointsAtLevel(1)).toBe(1);
    expect(pointsAtLevel(11)).toBe(11);
    // 5 + 5 + 5 + 3 = 18, which is why the maximums add up to the last level.
    expect(pointsAtLevel(18)).toBe(18);
    expect(DEFAULT_ORDER).toHaveLength(18);
  });

  it('reads the whole order when the level pays for it', () => {
    const state = resolveSkills(DEFAULT_ORDER, 18, CAPS);
    expect(state.ranks).toMatchObject({ Q: 5, W: 5, E: 5, R: 3 });
    expect(state.spent).toBe(18);
    expect(state.held).toHaveLength(0);
  });

  it('spends only what the level covers', () => {
    const state = resolveSkills(DEFAULT_ORDER, 11, CAPS);
    expect(state.spent).toBe(11);
    expect(state.available).toBe(11);
    // The first eleven entries of a typical Vi order.
    expect(state.ranks).toMatchObject({ Q: 5, W: 3, E: 1, R: 2 });
  });

  it('refuses a point there is no level for, and says which rule stopped it', () => {
    const full = DEFAULT_ORDER.slice(0, 11);
    const refusal = canSkill(full, 11, 'E', CAPS);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.why).toContain('no points left');

    // And the other rule, which is the ability's own maximum.
    const maxed = canSkill(DEFAULT_ORDER, 18, 'R', CAPS);
    expect(maxed.ok).toBe(false);
    if (!maxed.ok) expect(maxed.why).toContain('rank 3');
  });
});

describe('what the level cannot pay for goes grey, newest first', () => {
  it('holds back the last points taken, in the order they were taken', () => {
    // Level 9 against an order of eleven: the tenth and eleventh points are held.
    const order = DEFAULT_ORDER.slice(0, 11);
    const state = resolveSkills(order, 9, CAPS);

    expect(state.spent).toBe(9);
    expect(state.held).toHaveLength(2);
    // Positions ten and eleven of a typical Vi order are W and R.
    expect(state.held.map((entry) => entry.slot)).toEqual([order[9], order[10]]);
    // And each held point knows which pip it is, so W's fourth pip greys and not
    // whichever one happens to be free.
    expect(state.held[0]).toEqual({ slot: 'W', rank: 3 });
    expect(state.held[1]).toEqual({ slot: 'R', rank: 2 });
  });

  it('remembers them: raising the level again spends them', () => {
    const order = DEFAULT_ORDER.slice(0, 11);
    const low = resolveSkills(order, 9, CAPS);
    const back = resolveSkills(order, 11, CAPS);

    expect(low.ranks.R).toBe(1);
    expect(back.ranks.R).toBe(2);
    expect(back.held).toHaveLength(0);
  });

  it('never grants a rank past the ability maximum, whatever the order says', () => {
    const silly: AbilitySlot[] = ['R', 'R', 'R', 'R', 'R', 'R'];
    const state = resolveSkills(silly, 18, CAPS);
    expect(state.ranks.R).toBe(3);
    // The extra presses are not held either — they could never be spent.
    expect(state.held).toHaveLength(0);
    expect(state.spent).toBe(3);
  });
});

describe('spending and taking back', () => {
  it('spends a new point straight away, never behind a held one', () => {
    // Level 12 against an eleven-point order: one point spare, and the click uses
    // it rather than landing at the end of the list.
    const order = DEFAULT_ORDER.slice(0, 11);
    const after = skillUp(order, 12, 'E', CAPS);
    const state = resolveSkills(after, 12, CAPS);

    expect(state.spent).toBe(12);
    expect(state.ranks.E).toBe(2);
    expect(state.held).toHaveLength(0);
  });

  it('cannot spend at all while points are held back', () => {
    /*
     * Worth stating, because it is the shape of the whole model: a point is only
     * held when the budget ran out, so "points held back" and "a point to spend"
     * cannot both be true. Lower the level and the strip refuses every click until
     * the level comes back up or something is taken back.
     */
    const order = DEFAULT_ORDER.slice(0, 11);
    expect(resolveSkills(order, 9, CAPS).held).toHaveLength(2);
    expect(canSkill(order, 9, 'E', CAPS).ok).toBe(false);
  });

  it('changes nothing when there is nothing to spend', () => {
    const order = DEFAULT_ORDER.slice(0, 11);
    expect(skillUp(order, 11, 'E', CAPS)).toBe(order);
  });

  it('takes back the last point in an ability, not the first', () => {
    const order: AbilitySlot[] = ['Q', 'W', 'Q', 'E', 'Q'];
    expect(skillDown(order, 'Q')).toEqual(['Q', 'W', 'Q', 'E']);
    expect(skillDown(order, 'W')).toEqual(['Q', 'Q', 'E', 'Q']);
  });

  it('clears an ability entirely, which is the click past the last rank', () => {
    const order: AbilitySlot[] = ['Q', 'W', 'Q', 'E', 'Q'];
    expect(clearSkill(order, 'Q')).toEqual(['W', 'E']);
  });
});

describe('a build saved before orders existed', () => {
  it('gets an order that reproduces its ranks', () => {
    const order = orderFromRanks({ Q: 5, W: 3, E: 1, R: 2 });
    expect(order).toHaveLength(11);
    expect(resolveSkills(order, 11, CAPS).ranks).toMatchObject({ Q: 5, W: 3, E: 1, R: 2 });
  });

  it('interleaves rather than grouping, because the order decides what greys out', () => {
    // Five Qs in a row would mean dropping a level takes a Q; a realistic order
    // takes the most recent point instead, which is what the client shows.
    const order = orderFromRanks({ Q: 5, W: 3, E: 1, R: 2 });
    expect(order.slice(0, 3)).toEqual(['Q', 'W', 'E']);
  });

  it('loses no rank even when the template cannot place it', () => {
    // Three R points but no Q, W or E: the template puts R at 6, 11 and 16, and
    // the leftovers are appended rather than dropped.
    const order = orderFromRanks({ R: 3 });
    expect(order.filter((slot) => slot === 'R')).toHaveLength(3);
    expect(resolveSkills(order, 18, CAPS).ranks.R).toBe(3);
  });
});
