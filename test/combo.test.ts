/**
 * Combo list editing.
 *
 * The reordering helpers live outside the component precisely so they can be
 * checked here: an off-by-one in a move silently reorders someone's combo, and
 * order changes the damage in this app.
 *
 * The component itself is guarded by its type rather than by a test. Its
 * `onChange` takes an updater, so an edit derived from a stale render prop does
 * not compile — which is what dropped a step when several actions were added in
 * quick succession.
 */

import { describe, expect, it } from 'vitest';
import { reorderStep, shiftStep } from '../src/state/combo';
import { step as makeStep } from '../src/state/build';
import type { ComboStep } from '../src/engine/types';

function combo(): ComboStep[] {
  return [
    makeStep({ kind: 'ability', slot: 'Q' }, 1.25),
    makeStep({ kind: 'attack' }),
    makeStep({ kind: 'ability', slot: 'E' }),
  ];
}

const kinds = (steps: ComboStep[]) =>
  steps.map((entry) => (entry.action.kind === 'ability' ? entry.action.slot : entry.action.kind));

describe('reorderStep', () => {
  it('drops the dragged step onto the target position', () => {
    const list = combo();
    expect(kinds(reorderStep(list, list[2]!.uid, list[0]!.uid))).toEqual(['E', 'Q', 'attack']);
    expect(kinds(reorderStep(list, list[0]!.uid, list[2]!.uid))).toEqual(['attack', 'E', 'Q']);
  });

  it('leaves the list alone for unknown or identical ids', () => {
    const list = combo();
    expect(reorderStep(list, 'nope', list[0]!.uid)).toBe(list);
    expect(reorderStep(list, list[0]!.uid, 'nope')).toBe(list);
    expect(reorderStep(list, list[1]!.uid, list[1]!.uid)).toBe(list);
  });

  it('never loses or duplicates a step', () => {
    const list = combo();
    const moved = reorderStep(list, list[1]!.uid, list[2]!.uid);
    expect(moved).toHaveLength(list.length);
    expect(new Set(moved.map((entry) => entry.uid)).size).toBe(list.length);
  });
});

describe('shiftStep', () => {
  it('nudges a step one position', () => {
    const list = combo();
    expect(kinds(shiftStep(list, list[1]!.uid, -1))).toEqual(['attack', 'Q', 'E']);
    expect(kinds(shiftStep(list, list[1]!.uid, 1))).toEqual(['Q', 'E', 'attack']);
  });

  it('stops at the ends instead of wrapping around', () => {
    const list = combo();
    expect(shiftStep(list, list[0]!.uid, -1)).toBe(list);
    expect(shiftStep(list, list[2]!.uid, 1)).toBe(list);
  });

  it('ignores an unknown step', () => {
    const list = combo();
    expect(shiftStep(list, 'nope', 1)).toBe(list);
  });
});
