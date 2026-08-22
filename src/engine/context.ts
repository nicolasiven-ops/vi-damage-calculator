/**
 * The surface a champion module is allowed to touch during a simulation.
 *
 * Champion code never mutates simulation state directly — it asks the context,
 * which keeps bookkeeping (timeline, shred durations, stat recalculation) in
 * one place and makes every champion behave consistently.
 */

import type { DamageTerm } from './types';
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
  /**
   * The addends behind `amount`, for the inspector.
   *
   * Optional, and worth supplying wherever the number has a shape: a hit that
   * can explain itself is the difference between a calculator and an oracle.
   */
  build?: DamageTerm[];
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
  /**
   * Damage that lands later — a burn, a bleed, a delayed detonation.
   *
   * It keeps the identity of the step that caused it, so a burn started by the
   * third attack is still credited to that attack when it ticks two seconds
   * later. Ignite works the same way inside the engine; this is the same
   * facility offered to items, runes and pet buffs.
   */
  scheduleDamage(args: DealDamageArgs & { afterSeconds: number }): void;
  /** Percent shred is a fraction (0.2 === -20% armor). */
  applyArmorShred(args: {
    percent?: number;
    flat?: number;
    durationSeconds: number;
    label: string;
  }): void;
  /**
   * The same, on the target's magic resistance.
   *
   * Kept apart from magic penetration on purpose. Penetration belongs to whoever
   * is hitting and applies to their damage alone; reduction belongs to the target
   * and every attacker meets the reduced number. They also resolve in a different
   * order, so folding one into the other would be right in this simulation and
   * wrong in a fight with two people in it.
   */
  applyMagicResistShred(args: {
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
  /**
   * Crowd control on the target: what it cannot do, and for how long.
   *
   * The simulation does not model the target acting, so this changes no number —
   * it is recorded because a combo is unreadable without it. A knock-up is the
   * reason the next two hits land unanswered, and a timeline that shows the hits
   * but not the airborne window is showing half the story.
   */
  applyCrowdControl(args: {
    label: string;
    durationSeconds: number;
    /**
     * What it stops, when "cannot act" is the wrong claim.
     *
     * A knock-up takes everything; a slow takes movement. Reporting both the
     * same way would overstate the second one.
     */
    detail?: string;
  }): void;
  /**
   * Cut a fraction off what is left of the basic abilities' cooldowns.
   *
   * Not haste: haste decides how long a cooldown is when it is set, this shortens
   * one that is already running. Navori Flickerblade is the reason it exists —
   * "attacks reduce basic ability cooldowns by 15% of their remaining
   * cooldown" — and the distinction matters over a long combo, because haste
   * compounds with itself and this compounds with the clock.
   *
   * Ultimates are untouched, which is what Riot means by "basic abilities".
   */
  reduceBasicCooldowns(args: { fraction: number; label: string }): void;
  addEvent(event: Omit<TimelineEvent, 'id' | 'time' | 'seq'>): void;
  warn(message: string): void;
}

/** A cast's cost in time, and where that time went. */
export interface CastTiming {
  /** Total time before the next combo step may start. */
  seconds: number;
  /** Named contributions, in the order they happen. */
  parts: { label: string; seconds: number }[];
  /**
   * Seconds after the step begins at which the cooldown starts running.
   * Defaults to 0 — the cooldown starts when the button is pressed.
   *
   * Charged abilities are the reason this exists. Vault Breaker's cooldown
   * starts when it is *released* — the charge is held before the cooldown
   * begins, and the dash to the target runs inside it. Counting from the moment
   * of impact instead put the whole dash on top of the cooldown, stretching a
   * 6 s rank 5 Q to 6.25 s between hits and drifting further with every cast.
   */
  cooldownStartsAfter?: number;
  /**
   * Seconds after the effect in which the champion cannot act.
   *
   * Not the same thing as the cast: the effect has already happened, the damage
   * is dealt, and the champion is still committed to the animation. Vi's
   * ultimate is the case that forces the distinction — she grabs the target and
   * is unable to attack for as long as it is airborne, so an attack written
   * after R in a combo cannot land where the cast time alone would put it.
   *
   * The cooldown is unaffected: it started when the button did its work.
   */
  lockAfterSeconds?: number;
}

/**
 * An ability that holds charges instead of sitting on a single cooldown.
 *
 * Riot gates these two ways at once, and both have to hold: a charge must be
 * available, *and* the short static cooldown between two uses must have
 * elapsed. That static cooldown is the one Data Dragon reports (1 s for Vi's
 * E), and unlike a normal cooldown it is not reduced by ability haste —
 * haste shortens the recharge timer instead.
 */
export interface AbilityCharges {
  /** Charges held at once when full. */
  max: number;
  /** Seconds to regain one charge, before ability haste. */
  rechargeSeconds: number;
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
  /** The addends behind the replacement, for the inspector. */
  build?: DamageTerm[];
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
  /**
   * What one cast of this ability costs, in the champion's own resource.
   *
   * Asked of the champion rather than read from a table here, because only the
   * champion knows which patch value applies and at which rank — and because a
   * champion whose abilities cost nothing simply does not implement it.
   */
  abilityCost?(slot: AbilitySlot, ctx: SimContext, rank: number): number;
  /**
   * The charges this ability holds, when a plain cooldown is the wrong model.
   * Return null for abilities that simply go on cooldown.
   *
   * The champion declares the resource because it is the champion that can read
   * it out of the patch's own data; the simulation does the bookkeeping, so
   * every champion's charges behave — and are reported — identically.
   */
  abilityCharges?(slot: AbilitySlot, ctx: SimContext): AbilityCharges | null;
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
