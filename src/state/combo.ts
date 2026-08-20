/**
 * Reordering a combo.
 *
 * These are plain functions on a list rather than methods on component state,
 * for two reasons: they are the part with the off-by-one traps worth testing,
 * and they have to be callable from inside a state updater — where the current
 * list is a parameter, not a prop. See `ComboBuilder`'s `onChange` for why that
 * distinction matters.
 */

import type { ComboStep } from '../engine/types';

function moveIndex(combo: ComboStep[], from: number, to: number): ComboStep[] {
  const next = [...combo];
  const [step] = next.splice(from, 1);
  if (!step) return combo;
  next.splice(to, 0, step);
  return next;
}

/** Drop the dragged step where another one sits. Unknown ids leave the list alone. */
export function reorderStep(combo: ComboStep[], fromUid: string, toUid: string): ComboStep[] {
  const from = combo.findIndex((entry) => entry.uid === fromUid);
  const to = combo.findIndex((entry) => entry.uid === toUid);
  if (from === -1 || to === -1 || from === to) return combo;
  return moveIndex(combo, from, to);
}

/** Nudge one step forwards or backwards. Stops at the ends. */
export function shiftStep(combo: ComboStep[], uid: string, direction: -1 | 1): ComboStep[] {
  const index = combo.findIndex((entry) => entry.uid === uid);
  if (index === -1) return combo;
  const target = index + direction;
  if (target < 0 || target >= combo.length) return combo;
  return moveIndex(combo, index, target);
}
