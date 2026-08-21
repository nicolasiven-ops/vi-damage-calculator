/**
 * Vocabulary shared by the combo builder, the simulation and the analysis.
 */

import type { DDragonChampionStats } from '../data/types';
import type { ChampionStats, StatBlock } from '../model/stats';
import type { ReductionStep } from './damage';

export type DamageType = 'physical' | 'magic' | 'true';

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  physical: 'Physical',
  magic: 'Magic',
  true: 'True',
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
  /**
   * The combo step that caused this, by its `uid`.
   *
   * A hit knows its source ability, but not which press of it — and a combo
   * with two Qs has two. Carrying the step lets the UI point back at the card
   * the user actually dragged there.
   */
  stepUid?: string;
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
  /**
   * How the raw number was built, term by term.
   *
   * The champion supplies it at the moment of casting: base, ratio × stat,
   * charge scaling. Absent for damage nobody itemised — a rune proc that is
   * simply a number has nothing to break apart.
   */
  build?: DamageTerm[];
  /** The chain from raw to landed, as the engine applied it. */
  reduction?: ReductionStep[];
}

/**
 * One addend of a raw damage figure.
 *
 * `amount` is what it contributed; `detail` says what shape produced it, and
 * `source` where that came from — which is what makes the inspector an audit
 * rather than a restatement.
 */
/** One ability's readiness at a moment: what a game HUD would show. */
export interface AbilityAvailability {
  slot: AbilitySlot;
  /** Seconds until it can be cast again; 0 when it is up. */
  readyIn: number;
  /** The full cooldown this one is counting down from, for the sweep. */
  cooldown: number;
  /**
   * Charges in hand and the maximum, for abilities that hold them.
   *
   * `interval` is the full recharge window the timer is counting down from —
   * hasted, as it was actually set. Without it a view can show how long is left
   * but not how far along it is, and a sweep needs both.
   */
  charges?: { available: number; max: number; nextIn: number; interval: number };
}

export interface DamageTerm {
  label: string;
  amount: number;
  /** e.g. "150% of 0 bonus AD". */
  detail?: string;
  source?: 'gamedata' | 'ddragon' | 'registry';
}

/** Non-damage timeline events worth showing (shields, shreds, buffs). */
export interface TimelineEvent {
  id: string;
  /** Shared ordering with DamageInstance — see the note there. */
  seq: number;
  time: number;
  /** The combo step that caused this — see the note on DamageInstance. */
  stepUid?: string;
  label: string;
  detail: string;
  /**
   * `wait` is idle time the combo was forced to spend — an ability that was
   * still on cooldown or out of charges. It earns its own kind because it is
   * the one event that explains a gap in the timeline rather than something
   * that happened in it.
   */
  kind: 'shield' | 'shred' | 'buff' | 'cast' | 'info' | 'warning' | 'wait' | 'kill';
}

export type AbilitySlot = 'P' | 'Q' | 'W' | 'E' | 'R';

/**
 * A lane on the timeline view: one row per thing that occupies time.
 *
 * Ability slots keep their own lane; everything else is grouped by what it is
 * rather than where it came from, because a row per item passive would produce
 * twenty mostly-empty lanes.
 *
 * The lanes fall into two halves, and the view draws them as such: what the
 * player *does* (abilities, attacks, summoners, and the idle time between them)
 * above, and what that causes (procs, gear effects, champion effects) below.
 *
 * `gear` and `effect` are the same kind of thing — a window with a duration —
 * split by origin: gear effects come from items and runes, `effect` from the
 * champion's own kit. Reading a combo, that is the distinction that matters:
 * one you chose in the shop, the other follows from the buttons you pressed.
 */
export type TimelineLane =
  | AbilitySlot
  | 'AA'
  | 'summoner'
  | 'idle'
  | 'proc'
  | 'buff'
  | 'debuff'
  /** What the target is unable to do, and for how long. */
  | 'cc'
  /** Health and resource going back up while the combo runs. */
  | 'sustain';

/**
 * What a timed effect does, which is what its colour means.
 *
 * The split that matters when reading a combo is not where an effect came from
 * but which way it points: a buff that adds damage, a buff that only keeps you
 * alive, or a debuff on the target. Denting Blows produces one of each — attack
 * speed for Vi and an armour shred on the target — and drawing both in one hue
 * made them look like one thing.
 */
export type EffectKind =
  /** Raises damage output: attack damage, attack speed, penetration, haste. */
  | 'offense'
  /** Keeps you alive without adding damage: shields, health, resistances. */
  | 'defense'
  /** Applied to the target: shreds, damage amplification. */
  | 'debuff';

/** Where a timed effect came from — the champion's kit, or items and runes. */
export type EffectOrigin = 'champion' | 'gear';

/**
 * Something that occupied a stretch of time, with a start and an end.
 *
 * Damage instances are instants and events are points; this is the third kind
 * of thing on the timeline — the duration. Cast times, cooldowns, recharge
 * timers, buff windows and forced idle time all have a start and an end, and
 * the simulation knows all of them exactly. Until now they only survived as
 * prose in an event's detail text ("1,25 s Ladezeit + 0,25 s Sprint"), which a
 * table can print but a chart cannot draw.
 */
export interface TimelineSpan {
  id: string;
  /** The combo step that caused this — see the note on DamageInstance. */
  stepUid?: string;
  lane: TimelineLane;
  kind: SpanKind;
  start: number;
  /** End, clipped to the edge of the simulated window where necessary. */
  end: number;
  /**
   * The full duration, even where `end` was clipped.
   *
   * A view may cut a 140-second cooldown off at the edge of the plot, but it may
   * not *label* it 117 seconds — the length drawn and the duration claimed are
   * two different things.
   */
  fullSeconds: number;
  label: string;
  detail?: string;
  /** Set on effect spans: which way this one points. See EffectKind. */
  effectKind?: EffectKind;
  /** Set on effect spans: the champion's own kit, or gear. */
  effectOrigin?: EffectOrigin;
  /**
   * Named sub-stretches of a cast, in order.
   *
   * A charged Q is 1.25 s of holding and then 0.25 s of dashing, and the two
   * are not interchangeable: the first is time the player chose to spend, the
   * second is travel they cannot avoid. Drawing them as one block would hide
   * exactly the decision the charge slider exists for.
   */
  parts?: { label: string; seconds: number }[];
}

export type SpanKind =
  /** The cast itself occupies the combo. */
  | 'cast'
  /** Not available again until this ends. */
  | 'cooldown'
  /** A charge is regenerating. */
  | 'recharge'
  /** The attack timer between two basic attacks. */
  | 'attack-timer'
  /** A buff, shred or shield that is active for a while. */
  | 'effect'
  /** Time the combo had to wait because nothing was available. */
  | 'idle'
  /** Damage over time, e.g. Ignite. */
  | 'dot';

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
  /**
   * Health regained per five seconds, the way the game states it.
   *
   * The game applies a tenth of it every half second, which over a ten-second
   * combo against a Dr. Mundo is a hundred health the calculator was pretending
   * did not exist. Optional: a hand-typed target has no regeneration unless the
   * number is given.
   */
  healthRegenPerFive?: number;
}

export interface AttackerConfig {
  championId: string;
  /**
   * The summoner spells taken, by Data Dragon id.
   *
   * Not only for casting them: the upgraded Smites carry a jungle pet's buff,
   * which is in force from the first second whether or not Smite is ever cast.
   */
  summonerIds?: string[];
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

/**
 * What both sides looked like at one moment of the combo.
 *
 * The simulation already recomputes the stat block on every hit — buffs come and
 * go, the target's armour is shredded — but only ever used the result and threw
 * it away. Keeping one snapshot per step is what lets the app answer the
 * question a calculator is actually asked: *at this point in the combo, what were
 * the numbers?* Not the build's numbers, which any sheet can show, but the ones
 * in force two seconds in, after the shred and before the buff expired.
 */
export interface StatSnapshot {
  /** The combo step this is the state *after*; absent for the starting state. */
  stepUid?: string;
  /** Position in the combo, or -1 for the state before it starts. */
  index: number;
  time: number;
  /** The attacker's full stat block at this moment, buffs included. */
  attacker: ChampionStats;
  /** The attacker's resource pool at this moment: spent by casts, regenerated. */
  attackerResource: { current: number; max: number };
  /**
   * What is up and what is not, at this instant.
   *
   * The engine knows because it enforces it; without this the sidebar could only
   * show ranks, which say what you *bought* and never what you can press.
   */
  abilities: AbilityAvailability[];
  target: {
    currentHealth: number;
    maxHealth: number;
    /** The target's own armour, before anything this combo did to it. */
    baseArmor: number;
    /**
     * Armour after shred and reduction, before the attacker's penetration.
     *
     * This is the target's armour as the *target* has it — what its own stat
     * sheet should read. `effectiveArmor` folds in penetration, which belongs to
     * whoever is hitting it, not to the target.
     */
    currentArmor: number;
    /**
     * Armour as this attacker's physical damage actually meets it — shred,
     * percent penetration and lethality applied, in that order.
     */
    effectiveArmor: number;
    baseMagicResist: number;
    effectiveMagicResist: number;
    /** Crowd control on the target at this instant, with what is left of it. */
    crowdControl: { label: string; secondsLeft: number }[];
  };
  /** Timed effects in force right now, attacker-side and target-side. */
  active: { label: string; detail: string }[];
  /** Running totals, so the panel can show what the combo has produced so far. */
  damageDone: number;
  shieldGained: number;
  healingDone: number;
}

export interface SimulationResult {
  /** Health the target regenerated while the combo ran. */
  targetRegenerated: number;
  /** Mana the combo spent. */
  manaSpent: number;
  /**
   * Steps the combo never reached, because the target was already dead.
   *
   * They stay in the combo — they are part of the plan — and the strip greys
   * them out rather than pretending they landed.
   */
  unusedSteps: string[];
  instances: DamageInstance[];
  events: TimelineEvent[];
  /** One entry per combo step, plus the state before the first — see StatSnapshot. */
  snapshots: StatSnapshot[];
  /** Everything that occupied a stretch of time — see TimelineSpan. */
  spans: TimelineSpan[];
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
