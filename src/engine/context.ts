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
   * End a temporary buff early, by the label it was applied with.
   *
   * Some buffs run out of uses rather than time — Hail of Blades lasts three
   * attacks, whichever comes first. Expressing that as a duration alone would
   * either keep the attack speed past the last attack or cut it short.
   */
  clearTemporaryStats(label: string): void;
  /**
   * Make the target take more damage from all sources for a while
   * (Press the Attack, Exhaust in reverse, and similar).
   */
  applyTargetAmplification(args: {
    percent: number;
    durationSeconds: number;
    label: string;
  }): void;
  addEvent(event: Omit<TimelineEvent, 'id' | 'time' | 'seq'>): void;
  warn(message: string): void;
}

/** A cast's cost in time, and where that time went. */
export interface CastTiming {
  /** Total time before the next combo step may start. */
  seconds: number;
  /** Named contributions, in the order they happen. */
  parts: { label: string; seconds: number }[];
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
   * How long the cast occupies the combo, broken into named parts.
   *
   * The parts are what the timeline shows. Without them the first damage of a
   * charged Q appears out of nowhere 1.5 s in, and there is no way to tell
   * from the app that this is 1.25 s of charge plus a dash.
   */
  castDuration?(
    slot: AbilitySlot,
    ctx: SimContext,
    options: { chargeSeconds: number },
  ): CastTiming;
  /** True when casting this ability resets the auto-attack timer. */
  resetsAutoAttack?(slot: AbilitySlot): boolean;
  /**
   * True when the cast includes the basic attack it empowers.
   *
   * Abilities like Vi's Relentless Force do nothing on their own — they exist
   * to be spent on the next attack. In a combo, "E" therefore means "empowered
   * attack", and a step that quietly produced no damage until an attack was
   * appended by hand was a worse model of the player's intent than this.
   * A following attack step is then simply another, ordinary attack.
   */
  attacksOnCast?(slot: AbilitySlot): boolean;
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
  /** Called after any ability damage has landed. */
  onAbilityDamage?(ctx: SimContext): void;
}
