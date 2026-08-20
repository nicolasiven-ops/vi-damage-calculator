/**
 * Vocabulary shared by the combo builder, the simulation and the analysis.
 */

import type { DDragonChampionStats } from '../data/types';
import type { ChampionStats, StatBlock } from '../model/stats';

export type DamageType = 'physical' | 'magic' | 'true';

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  physical: 'Physisch',
  magic: 'Magisch',
  true: 'Absolut',
};

export type SourceKind = 'ability' | 'attack' | 'passive' | 'rune' | 'item' | 'summoner';

/** One resolved hit on the timeline. */
export interface DamageInstance {
  id: string;
  /**
   * Position in the order things actually resolved.
   *
   * Timestamps are not enough to order a timeline: a proc lands at the same
   * instant as the attack that triggered it, and which came first is the whole
   * point. Damage and events share one counter so they can be interleaved.
   */
  seq: number;
  /** Seconds since the combo started. */
  time: number;
  sourceId: string;
  sourceLabel: string;
  sourceKind: SourceKind;
  /** Ability slot this belongs to, when applicable — used for grouping. */
  slot?: AbilitySlot;
  type: DamageType;
  /** Damage before the target's resistances. */
  raw: number;
  /** Damage actually dealt after resistances and reductions. */
  mitigated: number;
  crit: boolean;
  /** Target health remaining after this instance. */
  targetHpAfter: number;
  notes: string[];
}

/** Non-damage timeline events worth showing (shields, shreds, buffs). */
export interface TimelineEvent {
  id: string;
  /** Shared ordering with DamageInstance — see the note there. */
  seq: number;
  time: number;
  label: string;
  detail: string;
  kind: 'shield' | 'shred' | 'buff' | 'cast' | 'info' | 'warning';
}

export type AbilitySlot = 'P' | 'Q' | 'W' | 'E' | 'R';

export type ComboActionType =
  | { kind: 'ability'; slot: AbilitySlot }
  | { kind: 'attack' }
  | { kind: 'wait'; seconds: number }
  | { kind: 'summoner'; summonerId: string }
  | { kind: 'item'; itemId: string };

/** One entry in the user's combo, in the order they dragged it. */
export interface ComboStep {
  /** Stable id for drag & drop. */
  uid: string;
  action: ComboActionType;
  /** Q charge time in seconds, for charged abilities. */
  chargeSeconds?: number;
}

export interface TargetConfig {
  name: string;
  level: number;
  maxHealth: number;
  currentHealthPercent: number;
  armor: number;
  magicResist: number;
  /** Flat post-mitigation damage reduction, e.g. from Doran's Shield. */
  flatDamageReduction: number;
  /** Multiplicative damage reduction, 0..1 — Exhaust, Wardens, etc. */
  percentDamageReduction: number;
  /** Bonus health, needed by effects that scale off it. */
  bonusHealth: number;
  /** Set when the target is a minion or monster, which caps some effects. */
  unitType: 'champion' | 'minion' | 'monster';
}

export interface AttackerConfig {
  championId: string;
  level: number;
  /** Rank 0 means unlearned. */
  ranks: Record<AbilitySlot, number>;
  itemIds: string[];
  runeIds: number[];
  /** Stat shards, keyed by row. */
  shardIds: number[];
  /** Extra stats the user typed in by hand. */
  manualStats: Partial<StatBlock>;
}

export type CritMode = 'expected' | 'always' | 'never';

export interface SimulationInput {
  attacker: AttackerConfig;
  /** Champion base stats straight from Data Dragon, for recomputing buffs. */
  championBaseStats: DDragonChampionStats;
  /** Stats at combo start, for display and as the simulation's starting point. */
  attackerStats: ChampionStats;
  /** Bonus stats from items, runes and manual entry. */
  bonusStats: StatBlock;
  target: TargetConfig;
  combo: ComboStep[];
  timings: TimingConfig;
  critMode: CritMode;
}

/**
 * Cast/animation timings. Data Dragon does not publish these, so they live
 * here as named, user-editable constants rather than hidden magic numbers.
 */
export interface TimingConfig {
  /** Fraction of the attack cycle before damage lands. */
  attackWindup: number;
  /** Delay before a dash actually connects, in seconds. */
  dashTravel: number;
  /** Seconds a queued action costs even when it is effectively instant. */
  inputDelay: number;
}

export const DEFAULT_TIMINGS: TimingConfig = {
  attackWindup: 0.1667,
  dashTravel: 0.25,
  inputDelay: 0.05,
};

export interface SimulationResult {
  instances: DamageInstance[];
  events: TimelineEvent[];
  totalRaw: number;
  totalMitigated: number;
  duration: number;
  /** Time at which the target's health would hit zero, if it does. */
  killTime: number | null;
  targetHpRemaining: number;
  /** Shield Vi gained over the combo. */
  shieldGained: number;
  /** Health Vi recovered from lifesteal/omnivamp. */
  healingDone: number;
  warnings: string[];
}
