/**
 * The surface a champion module is allowed to touch during a simulation.
 *
 * Champion code never mutates simulation state directly — it asks the context,
 * which keeps bookkeeping (timeline, shred durations, stat recalculation) in
 * one place and makes every champion behave consistently.
 */

import type { ChampionStats, StatBlock } from '../model/stats';
import type {
  AbilitySlot,
  DamageInstance,
  DamageType,
  SourceKind,
  TargetConfig,
  TimelineEvent,
  TimingConfig,
} from './types';

export interface DealDamageArgs {
  sourceId: string;
  sourceLabel: string;
  sourceKind: SourceKind;
  slot?: AbilitySlot;
  type: DamageType;
  /** Pre-mitigation damage. */
  amount: number;
  /** Whether crit modifiers apply (basic attacks and a few abilities). */
  canCrit?: boolean;
  /** Whether this hit triggers on-hit effects and rune procs. */
  triggersOnHit?: boolean;
  /** Whether this counts as ability damage for runes and Blast Shield. */
  isAbilityDamage?: boolean;
  notes?: string[];
}

export interface SimContext {
  readonly time: number;
  readonly timings: TimingConfig;
  /** Attacker stats including any temporary buffs active right now. */
  readonly stats: ChampionStats;
  readonly target: TargetConfig;
  readonly targetMaxHealth: number;
  readonly targetCurrentHealth: number;
  readonly rank: (slot: AbilitySlot) => number;

  dealDamage(args: DealDamageArgs): DamageInstance;
  /** Percent shred is a fraction (0.2 === -20% armor). */
  applyArmorShred(args: {
    percent?: number;
    flat?: number;
    durationSeconds: number;
    label: string;
  }): void;
  grantShield(args: { amount: number; durationSeconds: number; label: string }): void;
  applyTemporaryStats(args: {
    stats: Partial<StatBlock>;
    durationSeconds: number;
    label: string;
  }): void;
  /**
   * Make the target take more damage from all sources for a while
   * (Press the Attack, Exhaust in reverse, and similar).
   */
  applyTargetAmplification(args: {
    percent: number;
    durationSeconds: number;
    label: string;
  }): void;
  addEvent(event: Omit<TimelineEvent, 'id' | 'time'>): void;
  warn(message: string): void;
}

export interface BasicAttackModifier {
  /** Replaces the attack's damage completely. */
  replacementDamage?: number;
  /** Added on top of the attack's normal damage. */
  bonusDamage?: number;
  type?: DamageType;
  label?: string;
  slot?: AbilitySlot;
  notes?: string[];
}

/** Hooks a champion module can implement. All are optional. */
export interface ChampionRuntime {
  /** Called when the combo casts one of this champion's abilities. */
  castAbility?(slot: AbilitySlot, ctx: SimContext, options: { chargeSeconds: number }): void;
  /**
   * Time in seconds the cast occupies before the next combo step may start.
   * Returning 0 means the ability is effectively instant.
   */
  castDuration?(slot: AbilitySlot, ctx: SimContext, options: { chargeSeconds: number }): number;
  /** True when casting this ability resets the auto-attack timer. */
  resetsAutoAttack?(slot: AbilitySlot): boolean;
  /**
   * Called exactly once per basic attack, before its damage is computed.
   * Implementations may consume single-use empowerments here.
   *
   * `replacementDamage` overrides the attack's damage entirely (the way Vi's
   * Excessive Force does); `bonusDamage` is added on top of a normal attack.
   */
  modifyBasicAttack?(ctx: SimContext): BasicAttackModifier | null;
  /** Called after a basic attack has landed. */
  onBasicAttackHit?(ctx: SimContext): void;
  /**
   * Called once after the last combo step, before the result is reported.
   *
   * For pointing out what the combo left on the table — an empowerment that
   * never got consumed, a stack count that never reached its threshold.
   */
  onComboEnd?(ctx: SimContext): void;
  /** Called after any ability damage has landed. */
  onAbilityDamage?(ctx: SimContext): void;
}
