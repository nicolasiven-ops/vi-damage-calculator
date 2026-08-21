/**
 * Turns a raw simulation result into the numbers the analysis panel shows.
 *
 * Nothing here re-derives damage — it only aggregates what the simulation
 * already recorded, so the table, the chart and the totals can never disagree
 * with each other.
 */

import type { ChampionStats } from '../model/stats';
import { resistanceMultiplier } from './damage';
import type {
  DamageInstance,
  DamageType,
  SimulationResult,
  TargetConfig,
  TimelineEvent,
  TimelineSpan,
  StatSnapshot,
} from './types';

export interface SourceBreakdown {
  key: string;
  label: string;
  kind: DamageInstance['sourceKind'];
  raw: number;
  mitigated: number;
  hits: number;
  share: number;
}

export interface TypeBreakdown {
  type: DamageType;
  mitigated: number;
  raw: number;
  share: number;
}

/** One point on the cumulative damage curve. */
export interface CurvePoint {
  time: number;
  cumulative: number;
  /** Target health remaining after this point. */
  targetHp: number;
  instance: DamageInstance;
}

export interface EffectiveHealth {
  vsPhysical: number;
  vsMagic: number;
  /** Mixed value weighted by the actual damage composition of this combo. */
  vsThisCombo: number;
}

export interface ComboAnalysis {
  totalRaw: number;
  totalMitigated: number;
  /** Damage absorbed by resistances and reductions. */
  absorbed: number;
  /** Fraction of raw damage that actually landed. */
  throughput: number;
  duration: number;
  /** Mitigated damage per second across the combo window. */
  dps: number;
  /** Damage within one second of the first hit — the number that decides trades. */
  burst1s: number;
  burst3s: number;
  /** Wind-up before the combo's first damage lands. */
  timeToFirstDamage: number;
  killTime: number | null;
  targetHpRemaining: number;
  overkill: number;
  /** Damage still missing to secure the kill, 0 when the target dies. */
  missingDamage: number;
  bySource: SourceBreakdown[];
  byType: TypeBreakdown[];
  curve: CurvePoint[];
  effectiveHealth: EffectiveHealth;
  hitCount: number;
  largestHit: DamageInstance | null;
  shieldGained: number;
  healingDone: number;
  /** Health the target regenerated while the combo ran. */
  targetRegenerated: number;
  /** Steps the combo never reached, because the target was already dead. */
  unusedSteps: string[];
  warnings: string[];
  /**
   * Everything that happened but dealt no damage: casts and their timing,
   * shields, shreds, buffs, stack counters.
   *
   * The simulation always recorded these; nothing showed them, which left the
   * app unable to explain its own timeline — why a charged Q lands 1.5 s in,
   * for instance.
   */
  events: TimelineEvent[];
  /**
   * Everything that occupied a stretch of time, for the timeline view.
   *
   * Passed straight through: aggregating spans would lose exactly what makes
   * them useful, which is that each one is a real interval the simulation ran.
   */
  spans: TimelineSpan[];
  /** State of both sides after each combo step — see StatSnapshot. */
  snapshots: StatSnapshot[];
}

export function analyse(
  result: SimulationResult,
  target: TargetConfig,
  attacker: ChampionStats,
): ComboAnalysis {
  const instances = result.instances;
  const totalRaw = result.totalRaw;
  const totalMitigated = result.totalMitigated;

  const bySourceMap = new Map<string, SourceBreakdown>();
  for (const instance of instances) {
    const key = instance.sourceId;
    const entry = bySourceMap.get(key) ?? {
      key,
      label: instance.sourceLabel,
      kind: instance.sourceKind,
      raw: 0,
      mitigated: 0,
      hits: 0,
      share: 0,
    };
    entry.raw += instance.raw;
    entry.mitigated += instance.mitigated;
    entry.hits += 1;
    // Multi-hit sources keep the shortest label, which reads better than
    // "Ignite (tick 5/5)".
    if (instance.sourceLabel.length < entry.label.length) entry.label = instance.sourceLabel;
    bySourceMap.set(key, entry);
  }
  const bySource = [...bySourceMap.values()]
    .map((entry) => ({
      ...entry,
      share: totalMitigated > 0 ? entry.mitigated / totalMitigated : 0,
    }))
    .sort((a, b) => b.mitigated - a.mitigated);

  const byTypeMap = new Map<DamageType, { raw: number; mitigated: number }>();
  for (const instance of instances) {
    const entry = byTypeMap.get(instance.type) ?? { raw: 0, mitigated: 0 };
    entry.raw += instance.raw;
    entry.mitigated += instance.mitigated;
    byTypeMap.set(instance.type, entry);
  }
  const byType: TypeBreakdown[] = (['physical', 'magic', 'true'] as DamageType[])
    .map((type) => {
      const entry = byTypeMap.get(type) ?? { raw: 0, mitigated: 0 };
      return {
        type,
        raw: entry.raw,
        mitigated: entry.mitigated,
        share: totalMitigated > 0 ? entry.mitigated / totalMitigated : 0,
      };
    })
    .filter((entry) => entry.mitigated > 0);

  let running = 0;
  const curve: CurvePoint[] = instances.map((instance) => {
    running += instance.mitigated;
    return {
      time: instance.time,
      cumulative: running,
      targetHp: instance.targetHpAfter,
      instance,
    };
  });

  // Burst is measured from the first hit, not from combo start: a fully charged
  // Q spends 1.5 s before anything lands, and "0 damage in the first second"
  // would describe the wind-up rather than the trade.
  const firstHitAt = instances[0]?.time ?? 0;
  const damageWithin = (seconds: number): number =>
    instances
      .filter((instance) => instance.time <= firstHitAt + seconds)
      .reduce((sum, instance) => sum + instance.mitigated, 0);

  const startingHp = target.maxHealth * clamp01(target.currentHealthPercent);
  const overkill = Math.max(0, totalMitigated - startingHp);
  const missingDamage = Math.max(0, startingHp - totalMitigated);

  const physicalMultiplier = resistanceMultiplier(target.armor);
  const magicMultiplier = resistanceMultiplier(target.magicResist);
  const physicalShare = byType.find((entry) => entry.type === 'physical')?.share ?? 0;
  const magicShare = byType.find((entry) => entry.type === 'magic')?.share ?? 0;
  const trueShare = byType.find((entry) => entry.type === 'true')?.share ?? 0;
  const blendedMultiplier =
    physicalShare * physicalMultiplier + magicShare * magicMultiplier + trueShare * 1;

  const largestHit = instances.reduce<DamageInstance | null>(
    (max, instance) => (max === null || instance.mitigated > max.mitigated ? instance : max),
    null,
  );

  return {
    totalRaw,
    totalMitigated,
    absorbed: Math.max(0, totalRaw - totalMitigated),
    throughput: totalRaw > 0 ? totalMitigated / totalRaw : 0,
    duration: result.duration,
    dps: result.duration > 0 ? totalMitigated / result.duration : totalMitigated,
    burst1s: damageWithin(1),
    burst3s: damageWithin(3),
    timeToFirstDamage: firstHitAt,
    killTime: result.killTime,
    targetHpRemaining: result.targetHpRemaining,
    overkill,
    missingDamage,
    bySource,
    byType,
    curve,
    effectiveHealth: {
      vsPhysical: startingHp / Math.max(0.0001, physicalMultiplier),
      vsMagic: startingHp / Math.max(0.0001, magicMultiplier),
      vsThisCombo: blendedMultiplier > 0 ? startingHp / blendedMultiplier : startingHp,
    },
    hitCount: instances.length,
    largestHit,
    shieldGained: result.shieldGained,
    healingDone: result.healingDone,
    targetRegenerated: result.targetRegenerated,
    unusedSteps: result.unusedSteps,
    warnings: [...result.warnings, ...hardLimitWarnings(attacker)],
    events: result.events,
    spans: result.spans,
    snapshots: result.snapshots,
  };
}

/**
 * Limits the simulation actually ran into.
 *
 * Deliberately *not* build advice. This used to also point out ability power and
 * magic penetration that Vi cannot use, which is commentary on someone's item
 * choices rather than a fact about the calculation — and it sat under every
 * result whether or not anyone wanted it. What is left is a cap the engine
 * enforced: past 2.5 attack speed the number stops moving, and a result that
 * silently ignores added stats has to say so.
 */
function hardLimitWarnings(attacker: ChampionStats): string[] {
  const warnings: string[] = [];
  if (attacker.totalAttackSpeed >= 2.5) {
    warnings.push('Attack speed is at the 2.5 cap — any more of it does nothing.');
  }
  return warnings;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
