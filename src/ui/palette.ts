/**
 * The one place a lane or a damage type becomes a colour.
 *
 * Three charts and a Gantt draw the same fight, and each one used to pick its own
 * colours: a basic attack was light gold in the timeline and dark orange in the
 * rate graph, which makes two views of one moment look like two moments. The
 * colours themselves are tokens (see styles/tokens.css); this is the mapping.
 *
 * Two families, deliberately kept apart:
 *
 *   LANE_COLOR — *who* did it: an ability slot, an auto, a summoner spell, or a
 *                kind of effect (proc, buff, debuff, crowd control, sustain).
 *   TYPE_COLOR — *what kind of damage* it was: physical, magic, true.
 *
 * A view that mixes the two ends up saying "physical" when it means "auto
 * attack", which is why the auto's colour is not the physical series.
 */

import type { AbilitySlot, DamageType, TimelineLane } from '../engine/types';

export const SLOT_COLOR: Record<AbilitySlot, string> = {
  P: 'var(--slot-p)',
  Q: 'var(--slot-q)',
  W: 'var(--slot-w)',
  E: 'var(--slot-e)',
  R: 'var(--slot-r)',
};

export const LANE_COLOR: Record<TimelineLane, string> = {
  ...SLOT_COLOR,
  AA: 'var(--lane-attack)',
  summoner: 'var(--lane-summoner)',
  idle: 'var(--lane-idle)',
  proc: 'var(--lane-proc)',
  buff: 'var(--lane-buff)',
  debuff: 'var(--lane-debuff)',
  cc: 'var(--lane-cc)',
  sustain: 'var(--lane-sustain)',
};

export const TYPE_COLOR: Record<DamageType, string> = {
  physical: 'var(--series-physical)',
  magic: 'var(--series-magic)',
  true: 'var(--series-true)',
};

/** The colour for a lane, with a readable fallback for anything unmapped. */
export function laneColor(lane: TimelineLane): string {
  return LANE_COLOR[lane] ?? 'var(--text-dim)';
}
