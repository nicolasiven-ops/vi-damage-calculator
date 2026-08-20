/**
 * The mitigation pipeline.
 *
 * Order matters and is easy to get wrong, so it is spelled out here once:
 *
 *   1. flat resistance *reduction*   (visible on the target, can go negative)
 *   2. percent resistance reduction  (applied to the positive part only)
 *   3. percent resistance *penetration* (attacker-side, invisible to others)
 *   4. flat penetration / lethality  (never takes the value below zero)
 *
 * Reduction changes the target's actual resistance; penetration only changes
 * how one attacker's damage is computed against it. Penetration is skipped
 * entirely once the resistance is already negative — you cannot penetrate past
 * zero into bonus damage.
 */

import type { DamageType } from './types';

export interface ResistanceInput {
  base: number;
  flatReduction: number;
  /** 0..1 */
  percentReduction: number;
  /** 0..1 */
  percentPenetration: number;
  flatPenetration: number;
}

export function effectiveResistance(input: ResistanceInput): number {
  let value = input.base - input.flatReduction;

  // Percent reduction only scales a positive resistance; it never makes an
  // already-negative value worse.
  if (value > 0) value *= 1 - clamp01(input.percentReduction);

  if (value > 0) {
    value *= 1 - clamp01(input.percentPenetration);
    value = Math.max(0, value - Math.max(0, input.flatPenetration));
  }

  return value;
}

/**
 * Resistance → damage multiplier. Negative resistance amplifies damage, but
 * with diminishing returns rather than the linear form used for positives.
 */
export function resistanceMultiplier(resistance: number): number {
  return resistance >= 0 ? 100 / (100 + resistance) : 2 - 100 / (100 - resistance);
}

export interface MitigationInput {
  raw: number;
  type: DamageType;
  armor: ResistanceInput;
  magicResist: ResistanceInput;
  /** Multiplicative reduction on the target, 0..1. */
  percentDamageReduction: number;
  /** Flat reduction applied after resistances. */
  flatDamageReduction: number;
  /** Attacker-side amplification, e.g. 0.08 for +8%. */
  amplification: number;
}

export interface MitigationResult {
  raw: number;
  mitigated: number;
  /** Effective resistance the hit was computed against, for the breakdown. */
  effectiveResistance: number;
  resistanceMultiplier: number;
}

export function mitigate(input: MitigationInput): MitigationResult {
  const amplified = input.raw * (1 + input.amplification);

  let resistance = 0;
  let multiplier = 1;

  if (input.type === 'physical') {
    resistance = effectiveResistance(input.armor);
    multiplier = resistanceMultiplier(resistance);
  } else if (input.type === 'magic') {
    resistance = effectiveResistance(input.magicResist);
    multiplier = resistanceMultiplier(resistance);
  }

  const afterResistances = amplified * multiplier;
  const afterPercent = afterResistances * (1 - clamp01(input.percentDamageReduction));
  const mitigated = Math.max(0, afterPercent - Math.max(0, input.flatDamageReduction));

  return {
    raw: amplified,
    mitigated,
    effectiveResistance: resistance,
    resistanceMultiplier: multiplier,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
