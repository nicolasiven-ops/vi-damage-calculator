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

/**
 * One step of the chain between what was rolled and what landed.
 *
 * Recorded rather than reconstructed: the inspector shows the same steps the
 * engine took, in the order it took them, which is the only way a breakdown can
 * be trusted. `factor` multiplies, `subtract` is taken off afterwards; a step
 * carries one or the other.
 */
export interface ReductionStep {
  label: string;
  /** What it was called by, e.g. "armor 90 after 20% shred". */
  detail?: string;
  factor?: number;
  subtract?: number;
  /** Damage remaining once this step has been applied. */
  after: number;
}

export interface MitigationResult {
  raw: number;
  mitigated: number;
  /** Effective resistance the hit was computed against, for the breakdown. */
  effectiveResistance: number;
  resistanceMultiplier: number;
  /** The chain from raw to landed, step by step. */
  steps: ReductionStep[];
}

export function mitigate(input: MitigationInput): MitigationResult {
  const steps: ReductionStep[] = [];
  const amplified = input.raw * (1 + input.amplification);
  if (Math.abs(input.amplification) > 0.0005) {
    steps.push({
      label: 'Amplified',
      detail: `+${(input.amplification * 100).toFixed(1)}% from the attacker`,
      factor: 1 + input.amplification,
      after: amplified,
    });
  }

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
  if (input.type === 'true') {
    steps.push({ label: 'True damage', detail: 'resistances do not apply', after: afterResistances });
  } else {
    const source = input.type === 'physical' ? input.armor : input.magicResist;
    const name = input.type === 'physical' ? 'armor' : 'magic resist';
    steps.push({
      label: `Against ${resistance.toFixed(1)} ${name}`,
      detail: describeResistance(source, name),
      factor: multiplier,
      after: afterResistances,
    });
  }

  const afterPercent = afterResistances * (1 - clamp01(input.percentDamageReduction));
  if (input.percentDamageReduction > 0.0005) {
    steps.push({
      label: 'Damage reduction',
      detail: `${(input.percentDamageReduction * 100).toFixed(0)}% on the target`,
      factor: 1 - clamp01(input.percentDamageReduction),
      after: afterPercent,
    });
  }

  const mitigated = Math.max(0, afterPercent - Math.max(0, input.flatDamageReduction));
  if (input.flatDamageReduction > 0.0005) {
    steps.push({
      label: 'Flat reduction',
      detail: `${input.flatDamageReduction.toFixed(0)} taken off after resistances`,
      subtract: Math.max(0, input.flatDamageReduction),
      after: mitigated,
    });
  }

  return {
    raw: amplified,
    mitigated,
    effectiveResistance: resistance,
    resistanceMultiplier: multiplier,
    steps,
  };
}

/**
 * How a resistance got to the number the hit met.
 *
 * Only the parts that actually did something are named: a chain that says
 * "90 armor" when nothing touched it is clearer than one reciting four zeroes.
 */
function describeResistance(source: ResistanceInput, name: string): string {
  const parts: string[] = [`${source.base.toFixed(0)} ${name}`];
  if (source.flatReduction > 0.0005) parts.push(`−${source.flatReduction.toFixed(0)} shred`);
  if (source.percentReduction > 0.0005)
    parts.push(`−${(source.percentReduction * 100).toFixed(0)}% shred`);
  if (source.percentPenetration > 0.0005)
    parts.push(`−${(source.percentPenetration * 100).toFixed(0)}% pen`);
  if (source.flatPenetration > 0.0005) parts.push(`−${source.flatPenetration.toFixed(0)} lethality`);
  return parts.join(' ');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
