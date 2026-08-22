/**
 * Timeline simulation.
 *
 * The combo is walked step by step on a clock. Each step advances time by what
 * it actually costs — a charged Q costs its charge plus dash travel, a basic
 * attack costs its windup and then locks the attack timer for 1/AS seconds —
 * so ordering genuinely matters: an armor shred applied by the third auto
 * changes every hit that lands after it, and nothing before it.
 *
 * Damage instances are recorded with the timestamp at which they land, which
 * is what makes the cumulative damage curve meaningful rather than decorative.
 */

import { getItemEffect, itemAmplifiers, itemRuntimes, type ItemRuntime } from '../model/itemEffects';
import { petEffects } from '../model/petEffects';
import { runeAmplifiers, runeRuntimes, type HitInfo, type RuneRuntime } from '../model/runes';
import {
  cooldownMultiplier,
  hasteFor,
  resolveChampionStats,
  sumStats,
  type StatBlock,
} from '../model/stats';
import type { ChampionModule, ChampionModuleContext } from '../model/champions/types';
import { cooldownValue } from '../model/champions/types';
import type {
  AbilityCharges,
  BasicAttackModifier,
  CastTiming,
  ChampionRuntime,
  DealDamageArgs,
  SimContext,
} from './context';
import { IGNITE, byLevel, smiteById } from '../model/summoners';
import { effectiveResistance, mitigate } from './damage';
import type {
  AbilityAvailability,
  AbilitySlot,
  CritMode,
  DamageInstance,
  SimulationInput,
  SimulationResult,
  EffectKind,
  SpanKind,
  StatSnapshot,
  TimelineEvent,
  TimelineLane,
  TimelineSpan,
} from './types';

interface TimedModifier {
  expiresAt: number;
  label: string;
}

interface ArmorShred extends TimedModifier {
  percent: number;
  flat: number;
}

interface TempStats extends TimedModifier {
  stats: Partial<StatBlock>;
}

interface TargetAmp extends TimedModifier {
  percent: number;
}

interface ScheduledEvent {
  at: number;
  run: () => void;
}

/** Live charge counter for one ability that holds charges. */
interface ChargeState {
  available: number;
  /** When the next charge lands; Infinity while the counter is full. */
  nextChargeAt: number;
  /**
   * Seconds per charge, with ability haste already applied.
   *
   * Frozen when the timer starts rather than read per tick: a haste change
   * mid-recharge would otherwise retroactively move a charge that has been
   * ticking for seconds. Riot rescales the remaining time instead, but nothing
   * in a single combo grants haste, so freezing it is the honest simplification
   * — and it keeps the counter deterministic.
   */
  interval: number;
}

/** Guards against runaway combos if a step somehow never advances the clock. */
const MAX_SIMULATED_SECONDS = 120;

/** The game applies regeneration in half-second steps. */
const REGEN_TICK = 0.5;

/** Stats that raise damage output. Everything else a buff grants is survival. */
const OFFENSIVE_STATS: (keyof StatBlock)[] = [
  'attackDamage',
  'attackSpeed',
  'abilityPower',
  'abilityHaste',
  'critChance',
  'critDamage',
  'armorPenPercent',
  'lethality',
  'attackSpeedOverCap',
  'magicPenPercent',
  'magicPenFlat',
];

/**
 * Whether a buff points at damage or at staying alive.
 *
 * Read from the stats it actually grants rather than declared per effect, so a
 * new item classifies itself: Hail of Blades grants attack speed and is
 * offensive, Sterak's grants health and is not. A buff that grants both counts
 * as offensive — it does contribute to damage, which is the question the colour
 * answers.
 */
function classifyBuff(stats: Partial<StatBlock>): 'offense' | 'defense' {
  const grantsOffense = OFFENSIVE_STATS.some((key) => Math.abs(stats[key] ?? 0) > 0.0001);
  return grantsOffense ? 'offense' : 'defense';
}

/** Short durations, as the timeline reports them. */
function seconds(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * "1.25 s charge + 0.25 s dash = 1.5 s".
 *
 * The breakdown is the point: a combo whose first damage lands 1.5 s in should
 * be able to say why, without anyone reading the source.
 */
function describeCastTiming(timing: CastTiming): string {
  const parts = timing.parts.filter((part) => part.seconds > 0.001);
  if (parts.length === 0) return 'no cast time';
  const listed = parts.map((part) => `${seconds(part.seconds)} s ${part.label}`).join(' + ');
  return parts.length > 1 ? `${listed} = ${seconds(timing.seconds)} s` : listed;
}

export function simulate(
  input: SimulationInput,
  module: ChampionModule,
  moduleCtx: ChampionModuleContext,
): SimulationResult {
  const instances: DamageInstance[] = [];
  const events: TimelineEvent[] = [];
  const spans: TimelineSpan[] = [];
  const warnings: string[] = [];

  const targetMaxHealth = Math.max(1, input.target.maxHealth);
  let targetCurrentHealth = targetMaxHealth * clamp01(input.target.currentHealthPercent);

  let time = 0;
  let nextAttackReadyAt = 0;
  let shieldGained = 0;
  let healingDone = 0;
  /**
   * Health the target regenerated, kept apart from the attacker's own healing.
   *
   * Both are "healing" and they belong to opposite sides of the fight; one
   * number for the two would read as sustain the attacker got.
   */
  let targetRegenerated = 0;
  const regenPerTick = Math.max(0, input.target.healthRegenPerFive ?? 0) / 10;
  let lastRegenAt = 0;

  /**
   * The attacker's resource pool.
   *
   * Starts full — a combo is a thing you open a fight with — and is spent by
   * casts and refilled by regeneration on the same half-second clock the game
   * uses. A combo that runs out of mana is not a combo, and until now the app
   * reported one as though it were.
   */
  let currentMana = input.attackerStats.maxMana;
  let manaSpent = 0;
  const manaRegenPerTick = Math.max(0, input.attackerStats.manaRegen) / 10;
  let instanceCounter = 0;
  let eventCounter = 0;
  let spanCounter = 0;
  /** Shared across damage and events, so the timeline can interleave them. */
  let sequence = 0;
  /** Depth guard so rune and item procs cannot trigger each other forever. */
  let procDepth = 0;
  /**
   * The combo step being resolved, stamped onto everything it produces.
   *
   * Set by the main loop and restored around scheduled work, so an Ignite tick
   * that lands four steps later is still credited to the step that cast it.
   */
  let currentStepUid: string | undefined;

  /** Run `fn` with damage and events credited to the given step. */
  function attributedTo<T>(uid: string | undefined, fn: () => T): T {
    const previous = currentStepUid;
    currentStepUid = uid;
    try {
      return fn();
    } finally {
      currentStepUid = previous;
    }
  }

  /**
   * Which lane an effect window belongs on, tracked while item and rune code
   * runs.
   *
   * Champion abilities and gear both ask for effects through the same context
   * methods, so the context alone cannot tell a Blast Shield from a Hail of
   * Blades. Rather than widen the contract — and make every champion and item
   * declare where it lives — the simulation notes whose hook it is currently
   * inside. Item and rune runtimes only ever run through the wrapper below.
   */
  let effectLane: 'effect' | 'gear' = 'effect';

  /** Run gear code, so anything it applies lands on the gear lane. */
  function asGear<T>(fn: () => T): T {
    const previous = effectLane;
    effectLane = 'gear';
    try {
      return fn();
    } finally {
      effectLane = previous;
    }
  }

  const shreds: ArmorShred[] = [];
  /** The same, on magic resistance — see applyMagicResistShred. */
  const magicShreds: ArmorShred[] = [];
  const tempStats: TempStats[] = [];
  const targetAmps: TargetAmp[] = [];
  /** Crowd control on the target: label and when it ends. */
  const crowdControl: { label: string; expiresAt: number }[] = [];
  const scheduled: ScheduledEvent[] = [];
  const cooldowns = new Map<AbilitySlot, number>();
  /**
   * How long the running cooldown actually is, per slot.
   *
   * Not the base value: ability haste shortens it, and a HUD that divides the
   * remaining time by the base duration draws a wedge that is wrong by exactly
   * the haste — always too small, and never obviously so.
   */
  const cooldownTotals = new Map<AbilitySlot, number>();
  const chargeStates = new Map<AbilitySlot, ChargeState>();
  /** Open effect windows by identity — see addEffectSpan. */
  const openEffects = new Map<string, TimelineSpan>();
  const snapshots: StatSnapshot[] = [];

  /**
   * Record what both sides look like right now.
   *
   * Taken after each combo step, so the app can answer "what were the numbers at
   * this point" rather than only "what does the build add up to". The effective
   * resistances are computed the same way `applyDamage` computes them — same
   * function, same order — so the panel cannot drift from the damage.
   */
  /**
   * What each ability's state is right now.
   *
   * Read out of the same maps the cast path checks, so the sidebar cannot
   * disagree with what the simulation would allow.
   */
  function availability(): AbilityAvailability[] {
    return (['P', 'Q', 'W', 'E', 'R'] as AbilitySlot[])
      .filter((slot) => (module.abilities.find((ability) => ability.slot === slot)?.castable ?? false))
      .map((slot) => {
        const rank = input.attacker.ranks[slot] ?? 0;
        const readyAt = cooldowns.get(slot) ?? 0;
        const spec = chargeSpec(slot);
        const state = spec ? chargeState(slot, spec) : null;
        return {
          slot,
          readyIn: Math.max(0, readyAt - time),
          /*
           * The cooldown this one is counting down from — the one that was set,
           * haste included. Falls back to the base value for an ability that has
           * not been cast yet, where there is nothing running to measure.
           */
          cooldown:
            cooldownTotals.get(slot) ?? (rank > 0 ? baseCooldownOf(slot, rank) : 0),
          ...(spec && state
            ? {
                charges: {
                  available: state.available,
                  max: spec.max,
                  nextIn:
                    state.nextChargeAt === Number.POSITIVE_INFINITY
                      ? 0
                      : Math.max(0, state.nextChargeAt - time),
                  /*
                   * The recharge window as it was set, haste included. Falls
                   * back to the unhasted value before the first cast, where
                   * nothing is running to have been shortened.
                   */
                  interval: state.interval > 0 ? state.interval : spec.rechargeSeconds,
                },
              }
            : {}),
        };
      });
  }

  function takeSnapshot(index: number, stepUid?: string): void {
    const stats = currentStats();
    const shred = combinedShred();
    const magicShred = combinedMagicShred();

    snapshots.push({
      stepUid,
      index,
      time,
      attacker: stats,
      /** The attacker's resource at this instant, so the bar can move. */
      attackerResource: { current: currentMana, max: input.attackerStats.maxMana },
      abilities: availability(),
      target: {
        currentHealth: targetCurrentHealth,
        maxHealth: targetMaxHealth,
        baseArmor: input.target.armor,
        currentArmor: effectiveResistance({
          base: input.target.armor,
          flatReduction: shred.flat,
          percentReduction: shred.percent,
          percentPenetration: 0,
          flatPenetration: 0,
        }),
        effectiveArmor: effectiveResistance({
          base: input.target.armor,
          flatReduction: shred.flat,
          percentReduction: shred.percent,
          percentPenetration: stats.armorPenPercent,
          flatPenetration: stats.flatArmorPen,
        }),
        crowdControl: crowdControl
          .filter((entry) => entry.expiresAt > time + 0.0005)
          .map((entry) => ({ label: entry.label, secondsLeft: entry.expiresAt - time })),
        baseMagicResist: input.target.magicResist,
        effectiveMagicResist: effectiveResistance({
          base: input.target.magicResist,
          flatReduction: magicShred.flat,
          percentReduction: magicShred.percent,
          percentPenetration: stats.magicPenPercent,
          flatPenetration: stats.magicPenFlat,
        }),
      },
      active: [
        ...shreds.map((entry) => ({
          label: entry.label,
          detail:
            entry.percent > 0
              ? `−${(entry.percent * 100).toFixed(0)}% armor · ${seconds(Math.max(0, entry.expiresAt - time))} s left`
              : `−${entry.flat.toFixed(0)} armor · ${seconds(Math.max(0, entry.expiresAt - time))} s left`,
        })),
        ...tempStats.map((entry) => ({
          label: entry.label,
          detail: `${seconds(Math.max(0, entry.expiresAt - time))} s left`,
        })),
        ...targetAmps.map((entry) => ({
          label: entry.label,
          detail: `+${(entry.percent * 100).toFixed(0)}% damage taken · ${seconds(Math.max(0, entry.expiresAt - time))} s left`,
        })),
      ],
      damageDone: instances.reduce((sum, entry) => sum + entry.mitigated, 0),
      shieldGained,
      healingDone,
    });
  }

  const championRuntime: ChampionRuntime = module.createRuntime(moduleCtx);
  const runes: { id: number; runtime: RuneRuntime }[] = runeRuntimes([
    ...input.attacker.runeIds,
    ...input.attacker.shardIds,
  ]);
  const items: { id: string; runtime: ItemRuntime }[] = itemRuntimes(input.attacker.itemIds);
  /*
   * The jungle pet's buff is not an item and not a cast: it is simply there
   * because of the Smite you took, so it is built from the picked spells and
   * runs on the same hooks the items use.
   */
  const pets = petEffects(input.attacker.summonerIds ?? []);
  const petRuntimes = pets.map((pet) => pet.createRuntime?.()).filter(Boolean) as ItemRuntime[];
  const amplifierRunes = runeAmplifiers([...input.attacker.runeIds, ...input.attacker.shardIds]);
  const amplifierItems = itemAmplifiers(input.attacker.itemIds);

  /* -------------------------------------------------------------- state views */

  function prune(): void {
    dropExpired(shreds, time);
    dropExpired(magicShreds, time);
    dropExpired(tempStats, time);
    dropExpired(targetAmps, time);
  }

  function currentStats() {
    prune();
    const bonus = sumStats([input.bonusStats, ...tempStats.map((entry) => entry.stats)]);
    return resolveChampionStats(input.championBaseStats, input.attacker.level, bonus);
  }

  /** Percent resistance reductions stack multiplicatively, not additively. */
  function combine(list: ArmorShred[]): { percent: number; flat: number } {
    prune();
    let remaining = 1;
    let flat = 0;
    for (const shred of list) {
      remaining *= 1 - clamp01(shred.percent);
      flat += shred.flat;
    }
    return { percent: 1 - remaining, flat };
  }

  function combinedShred(): { percent: number; flat: number } {
    return combine(shreds);
  }

  function combinedMagicShred(): { percent: number; flat: number } {
    return combine(magicShreds);
  }

  /**
   * Record a resistance reduction, on whichever resistance it belongs to.
   *
   * Re-applying the same source refreshes rather than stacks, which is how the
   * game treats a debuff from one item: Black Cleaver's fifth stack does not
   * become a sixth by hitting again.
   */
  function applyShred(
    list: ArmorShred[],
    what: 'armor' | 'magic resist',
    {
      percent = 0,
      flat = 0,
      durationSeconds,
      label,
    }: { percent?: number; flat?: number; durationSeconds: number; label: string },
  ): void {
    const existing = list.find((entry) => entry.label === label);
    if (existing) {
      existing.percent = Math.max(existing.percent, percent);
      existing.flat = Math.max(existing.flat, flat);
      existing.expiresAt = time + durationSeconds;
    } else {
      list.push({ percent, flat, expiresAt: time + durationSeconds, label });
    }
    const detail =
      percent > 0
        ? `−${(percent * 100).toFixed(0)}% ${what} for ${durationSeconds} s`
        : `−${flat.toFixed(0)} ${what} for ${durationSeconds} s`;
    addEvent({ kind: 'shred', label, detail });
    addEffectSpan(`shred:${label}`, label, detail, time + durationSeconds, 'debuff');
  }

  function combinedTargetAmp(): number {
    prune();
    return targetAmps.reduce((acc, amp) => acc * (1 + amp.percent), 1) - 1;
  }

  /* ------------------------------------------------------------------- clock */

  function advanceTo(target: number): void {
    const clamped = Math.min(target, MAX_SIMULATED_SECONDS);
    while (scheduled.length > 0) {
      scheduled.sort((a, b) => a.at - b.at);
      const next = scheduled[0]!;
      if (next.at > clamped) break;
      scheduled.shift();
      time = Math.max(time, next.at);
      regenerate();
      next.run();
    }
    time = Math.max(time, clamped);
    regenerate();
  }

  /**
   * The target's regeneration, accrued as the clock moves.
   *
   * The game applies a tenth of the per-five-seconds figure every half second.
   * Accrued rather than scheduled: a scheduled tick is an event, and events out
   * to the simulation horizon would make every combo report itself as two
   * minutes long. This only ever adds health for time the combo actually spent.
   */
  function regenerate(): void {
    if (regenPerTick <= 0 && manaRegenPerTick <= 0) return;
    const ticks = Math.floor((time - lastRegenAt) / REGEN_TICK);
    if (ticks <= 0) return;
    lastRegenAt += ticks * REGEN_TICK;

    // The dead do not heal, and nothing regenerates past full.
    if (regenPerTick > 0 && targetCurrentHealth > 0 && targetCurrentHealth < targetMaxHealth) {
      const healed = Math.min(ticks * regenPerTick, targetMaxHealth - targetCurrentHealth);
      targetCurrentHealth += healed;
      targetRegenerated += healed;
    }

    if (manaRegenPerTick > 0) {
      currentMana = Math.min(
        input.attackerStats.maxMana,
        currentMana + ticks * manaRegenPerTick,
      );
    }
  }

  function advance(seconds: number): void {
    if (seconds > 0) advanceTo(time + seconds);
  }

  /* ------------------------------------------------------------------ context */

  const ctx: SimContext = {
    get time() {
      return time;
    },
    get timings() {
      return input.timings;
    },
    get stats() {
      return currentStats();
    },
    get target() {
      return input.target;
    },
    get targetMaxHealth() {
      return targetMaxHealth;
    },
    get targetCurrentHealth() {
      return targetCurrentHealth;
    },
    rank: (slot) => input.attacker.ranks[slot] ?? 0,

    dealDamage(args) {
      return applyDamage(args);
    },

    applyArmorShred(args) {
      applyShred(shreds, 'armor', args);
    },

    applyMagicResistShred(args) {
      applyShred(magicShreds, 'magic resist', args);
    },

    grantShield({ amount, durationSeconds, label }) {
      shieldGained += amount;
      const detail = `+${amount.toFixed(0)} shield for ${durationSeconds} s`;
      addEvent({ kind: 'shield', label, detail });
      addEffectSpan(`shield:${label}`, label, detail, time + durationSeconds, 'defense');
    },

    applyTemporaryStats({ stats, durationSeconds, label }) {
      const existing = tempStats.find((entry) => entry.label.split(' · ')[0] === label.split(' · ')[0]);
      if (existing) {
        existing.stats = stats;
        existing.expiresAt = time + durationSeconds;
        existing.label = label;
      } else {
        tempStats.push({ stats, expiresAt: time + durationSeconds, label });
      }
      // Only the buff going up is news. Hail of Blades refreshes its window
      // on every attack, and a line per refresh buries the timeline.
      if (!existing) addEvent({ kind: 'buff', label, detail: `${durationSeconds} s` });
      /*
       * Identity is the name before the ' · ', the same way `tempStats` itself
       * tracks a buff. Conqueror writes its stack count into its label, so
       * keying on the whole text produced a new bar for each of its twelve
       * stacks; keying on the prefix keeps one bar that updates its own name.
       */
      addEffectSpan(
        `buff:${label.split(' · ')[0]}`,
        label,
        `${durationSeconds} s`,
        time + durationSeconds,
        classifyBuff(stats),
      );
    },

    clearTemporaryStats(label) {
      const index = tempStats.findIndex((entry) => entry.label.split(' · ')[0] === label);
      if (index === -1) return;
      const [removed] = tempStats.splice(index, 1);
      addEvent({ kind: 'buff', label: `${removed!.label} ends`, detail: 'spent' });

      /*
       * Hail of Blades runs out of attacks before it runs out of time, so the
       * bar has to end where the buff actually ended and not where it was
       * scheduled to — otherwise the drawing claims attack speed Vi never had.
       *
       * Looked up by identity rather than by scanning labels: Denting Blows
       * grants a shred and a buff under the same name prefix, and a label scan
       * could cut the shred short instead.
       */
      const open = openEffects.get(`buff:${label}`);
      if (open && open.end > time) {
        setSpanEnd(open, time, `${open.detail ?? ''} · spent early`.trim());
      }
    },

    applyTargetAmplification({ percent, durationSeconds, label }) {
      targetAmps.push({ percent, expiresAt: time + durationSeconds, label });
      const detail = `+${(percent * 100).toFixed(0)}% damage taken for ${durationSeconds} s`;
      addEvent({ kind: 'buff', label, detail });
      // Same treatment as shreds and shields: it has a window, so it gets a bar.
      addEffectSpan(`amp:${label}`, label, detail, time + durationSeconds, 'debuff');
    },

    scheduleDamage({ afterSeconds, ...damage }) {
      const owner = currentStepUid;
      scheduled.push({
        at: time + Math.max(0, afterSeconds),
        run: () => attributedTo(owner, () => applyDamage(damage)),
      });
    },

    applyCrowdControl({ label, durationSeconds, detail: what }) {
      const until = time + durationSeconds;
      crowdControl.push({ label, expiresAt: until });
      const detail = `${seconds(durationSeconds)} s`;
      addEvent({ kind: 'info', label, detail: `target is ${label.toLowerCase()} for ${detail}` });
      addSpan({
        lane: 'cc',
        kind: 'effect',
        start: time,
        end: until,
        label,
        detail: `${what ?? 'target cannot act'} · ${detail}`,
        effectKind: 'debuff',
        effectOrigin: 'champion',
      });
    },

    addEvent(event) {
      addEvent(event);
    },

    warn(message) {
      if (!warnings.includes(message)) warnings.push(message);
    },
  };

  function addEvent(event: Omit<TimelineEvent, 'id' | 'time' | 'seq'>): void {
    /*
     * Nothing is logged after the kill except the kill.
     *
     * The fight is over: an animation lock, a cooldown starting, a buff expiring
     * — all true, all irrelevant, and all of it read as though the combo were
     * still happening. The last line of the log is the one worth arriving at.
     */
    if (targetCurrentHealth <= 0 && event.kind !== 'kill') return;

    eventCounter += 1;
    sequence += 1;
    events.push({ ...event, id: `ev${eventCounter}`, seq: sequence, time, stepUid: currentStepUid });
  }

  /**
   * Record a stretch of occupied time.
   *
   * Zero-length spans are dropped: an instant is already covered by an event or
   * a damage instance, and a bar of no width is noise in every view that draws
   * these. The clamp keeps a span from running past the simulated window, so a
   * 115 s ultimate cooldown does not stretch a four-second chart.
   */
  function addSpan(span: {
    lane: TimelineLane;
    kind: SpanKind;
    start: number;
    end: number;
    label: string;
    detail?: string;
    parts?: { label: string; seconds: number }[];
    effectKind?: EffectKind;
    effectOrigin?: 'champion' | 'gear';
  }): void {
    const start = Math.max(0, span.start);
    const end = Math.min(span.end, MAX_SIMULATED_SECONDS);
    if (end - start <= 0.0005) return;
    spanCounter += 1;
    spans.push({
      ...span,
      id: `sp${spanCounter}`,
      start,
      end,
      fullSeconds: span.end - start,
      stepUid: currentStepUid,
    });
  }

  /**
   * Move a span's end, keeping its stated duration in step.
   *
   * `end` and `fullSeconds` describe the same interval from two angles, and a
   * span whose end moves — a cancelled attack timer, a buff spent early, a
   * refreshed effect — has to move both. Editing one and forgetting the other
   * leaves a bar that draws one length and claims another.
   */
  function setSpanEnd(span: TimelineSpan, end: number, detail?: string): void {
    span.end = Math.min(end, MAX_SIMULATED_SECONDS);
    span.fullSeconds = Math.max(0, span.end - span.start);
    if (detail !== undefined) span.detail = detail;
  }

  /**
   * One bar per effect window, not one per application.
   *
   * Effects that refresh — Hail of Blades renews itself on every attack, Denting
   * Blows re-applies its shred — would otherwise stack up as a pile of
   * overlapping bars describing a single continuous buff. Extending the open one
   * keeps the drawing honest: the bar is exactly as long as the effect was up.
   *
   * Matched by `key`, not by label, because a label can legitimately change
   * while the effect continues: Conqueror writes its stack count into its own
   * name, so keying on the text produced a fresh bar for every one of its twelve
   * stacks. Conversely two effects can share a name prefix — Denting Blows
   * grants a shred *and* attack speed — so the key carries what it is as well as
   * what it is called.
   */
  function addEffectSpan(
    key: string,
    label: string,
    detail: string,
    endsAt: number,
    effectKind: EffectKind,
  ): void {
    const open = openEffects.get(key);
    if (open && open.end >= time - 0.0005) {
      setSpanEnd(open, Math.max(open.end, endsAt), detail);
      // The newest label wins: a stacking buff should read as its current state.
      open.label = label;
      open.effectKind = effectKind;
      return;
    }
    const before = spans.length;
    addSpan({
      // Debuffs sit on the target, so they get their own lane whatever applied
      // them; buffs are grouped together and told apart by colour.
      lane: effectKind === 'debuff' ? 'debuff' : 'buff',
      kind: 'effect',
      start: time,
      end: endsAt,
      label,
      detail,
      effectKind,
      effectOrigin: effectLane === 'gear' ? 'gear' : 'champion',
    });
    if (spans.length > before) openEffects.set(key, spans[spans.length - 1]!);
  }

  /* ------------------------------------------------------------------ damage */

  /**
   * A damage instance that never happened, for the paths that must return one.
   *
   * Nothing reads it: it exists because `dealDamage` promises an instance and a
   * dead target means there is none. Zeroes rather than a null so no caller has
   * to guard, and it is never pushed into the timeline.
   */
  function noDamage(args: DealDamageArgs): DamageInstance {
    sequence += 1;
    return {
      id: 'dmg-none',
      seq: sequence,
      time,
      stepUid: currentStepUid,
      sourceId: args.sourceId,
      sourceLabel: args.sourceLabel,
      sourceKind: args.sourceKind,
      slot: args.slot,
      type: args.type,
      raw: 0,
      mitigated: 0,
      crit: false,
      targetHpAfter: 0,
      notes: ['the target was already dead'],
    };
  }

  function applyDamage(args: DealDamageArgs): DamageInstance {
    /*
     * Damage after the kill is not damage.
     *
     * Ignite keeps ticking, a burn keeps burning, and the scheduler happily
     * delivers both into a corpse — which inflated every total, stretched the
     * chart seconds past the moment that decided the fight, and made the DPS a
     * rate over time nobody was fighting for.
     */
    if (targetCurrentHealth <= 0) return noDamage(args);

    const stats = currentStats();
    const shred = combinedShred();
    const magicShred = combinedMagicShred();

    /*
     * Amplifications stack multiplicatively with each other, and every amplifier
     * is told the same thing about the hit — including where it came from, which
     * is what an ability-only amplifier needs.
     */
    const amplifiable = {
      sourceId: args.sourceId,
      sourceKind: args.sourceKind,
      type: args.type,
      isAbilityDamage: args.isAbilityDamage ?? false,
      triggersOnHit: args.triggersOnHit ?? false,
    };
    let ampFactor = 1 + combinedTargetAmp();
    for (const rune of amplifierRunes) {
      ampFactor *= 1 + rune.amplify!(ctx, amplifiable);
    }
    for (const item of amplifierItems) {
      ampFactor *= 1 + item.amplify!(ctx, amplifiable);
    }
    // Amplifiers that had to remember something to know their own value.
    for (const { runtime } of items) {
      if (runtime.amplify) ampFactor *= 1 + runtime.amplify(ctx, amplifiable);
    }

    const result = mitigate({
      raw: args.amount,
      type: args.type,
      armor: {
        base: input.target.armor,
        flatReduction: shred.flat,
        percentReduction: shred.percent,
        percentPenetration: stats.armorPenPercent,
        flatPenetration: stats.flatArmorPen,
      },
      magicResist: {
        base: input.target.magicResist,
        flatReduction: magicShred.flat,
        percentReduction: magicShred.percent,
        percentPenetration: stats.magicPenPercent,
        flatPenetration: stats.magicPenFlat,
      },
      percentDamageReduction: input.target.percentDamageReduction,
      flatDamageReduction: input.target.flatDamageReduction,
      amplification: ampFactor - 1,
    });

    const healthBefore = targetCurrentHealth;
    targetCurrentHealth = Math.max(0, targetCurrentHealth - result.mitigated);

    instanceCounter += 1;
    sequence += 1;
    const instance: DamageInstance = {
      id: `dmg${instanceCounter}`,
      seq: sequence,
      time,
      stepUid: currentStepUid,
      sourceId: args.sourceId,
      sourceLabel: args.sourceLabel,
      sourceKind: args.sourceKind,
      slot: args.slot,
      type: args.type,
      raw: result.raw,
      mitigated: result.mitigated,
      crit: (args.canCrit ?? false) && input.critMode === 'always',
      targetHpAfter: targetCurrentHealth,
      build: args.build,
      reduction: result.steps,
      notes: [
        ...(args.notes ?? []),
        `effective ${args.type === 'magic' ? 'MR' : 'armor'}: ${result.effectiveResistance.toFixed(1)}`,
        ...(ampFactor !== 1 ? [`amplified ×${ampFactor.toFixed(3)}`] : []),
      ],
    };
    instances.push(instance);

    /*
     * The kill gets its own line, once.
     *
     * It is the moment the whole page is about, and in a table of thirty hits it
     * was previously readable only by noticing that a health column had reached
     * zero. The overkill is on the same line, because "dead with 300 to spare"
     * and "dead by 4" are different answers.
     */
    if (healthBefore > 0 && targetCurrentHealth <= 0) {
      const overkill = Math.max(0, result.mitigated - healthBefore);
      addEvent({
        kind: 'kill',
        label: 'Target eliminated',
        detail:
          overkill > 0.5
            ? `by ${args.sourceLabel} · ${overkill.toFixed(0)} overkill`
            : `by ${args.sourceLabel}`,
      });
    }

    // Vamp. Physical vamp applies to physical damage only; omnivamp to all.
    const vampRate =
      stats.omnivamp + (args.type === 'physical' ? stats.physicalVamp : 0) +
      (args.triggersOnHit ? stats.lifesteal : 0);
    if (vampRate > 0) healingDone += result.mitigated * vampRate;

    // Rune and item procs. Damage that itself came from a proc does not
    // re-trigger procs, which keeps Electrocute from feeding itself.
    if (procDepth === 0 && args.sourceKind !== 'rune' && args.sourceKind !== 'item') {
      const hit: HitInfo = {
        sourceId: args.sourceId,
        sourceKind: args.sourceKind,
        type: args.type,
        isAbilityDamage: args.isAbilityDamage ?? false,
        triggersOnHit: args.triggersOnHit ?? false,
        mitigated: result.mitigated,
        targetHealthPercentAfter: targetCurrentHealth / targetMaxHealth,
      };
      procDepth += 1;
      try {
        asGear(() => {
          for (const { runtime } of runes) runtime.onHitLanded?.(ctx, hit);
          for (const { runtime } of items) runtime.onHitLanded?.(ctx, hit);
          for (const runtime of petRuntimes) runtime.onHitLanded?.(ctx, hit);
        });
      } finally {
        procDepth -= 1;
      }
    }

    return instance;
  }

  /* ------------------------------------------------------------------ actions */

  function performAttack(): void {
    // Before anything is measured: a keystone may still put a buff in place
    // that changes this very attack.
    asGear(() => {
      for (const { runtime } of runes) runtime.onBeforeAttack?.(ctx);
    });

    const idleSince = time;
    advanceTo(Math.max(time, nextAttackReadyAt));
    const attackStart = time;
    const waited = attackStart - idleSince;

    /*
     * Stats are read *after* the wait, not before it.
     *
     * Waiting for the attack timer can outlast a buff: Denting Blows' attack
     * speed runs 4 s, and an attack queued behind a slow timer may begin after
     * it has expired. Reading the stats before the wait computed the wind-up —
     * and the next attack timer — from attack speed Vi no longer had by the time
     * she swung.
     */
    const stats = currentStats();
    const windup = input.timings.attackWindup / Math.max(0.1, stats.totalAttackSpeed);
    advance(windup);

    const modifier: BasicAttackModifier | null =
      championRuntime.modifyBasicAttack?.(ctx) ?? null;

    const statsAtHit = currentStats();
    const critFactor = critMultiplierFor(
      statsAtHit.critChance,
      statsAtHit.critMultiplier,
      input.critMode,
    );

    const baseAmount = modifier?.replacementDamage ?? statsAtHit.totalAttackDamage;
    const withBonus = baseAmount + (modifier?.bonusDamage ?? 0);

    applyDamage({
      sourceId: modifier?.slot ?? 'AA',
      sourceLabel: modifier?.label ?? 'Basic attack',
      sourceKind: modifier?.slot ? 'ability' : 'attack',
      slot: modifier?.slot,
      type: modifier?.type ?? 'physical',
      amount: withBonus * critFactor,
      canCrit: true,
      triggersOnHit: true,
      /*
       * An unmodified attack is one term — the attack damage itself — and that
       * is worth saying out loud rather than leaving the inspector with a bare
       * number and nothing to point at.
       */
      build: modifier?.build ?? [
        {
          label: 'attack damage',
          amount: baseAmount,
          detail: `${statsAtHit.baseAttackDamage.toFixed(0)} base + ${statsAtHit.bonusAttackDamage.toFixed(0)} bonus`,
        },
        ...(critFactor !== 1
          ? [
              {
                label: 'crit factor',
                amount: baseAmount * (critFactor - 1),
                detail: `×${critFactor.toFixed(3)} at ${(statsAtHit.critChance * 100).toFixed(0)}% chance`,
              },
            ]
          : []),
      ],
      notes: [
        ...(modifier?.notes ?? []),
        `${seconds(windup)} s wind-up` +
          (waited > 0.001 ? ` after ${seconds(waited)} s of attack timer` : ''),
        ...(critFactor !== 1 ? [`crit factor ×${critFactor.toFixed(3)}`] : []),
      ],
    });

    // On-hit riders from items land as their own instances.
    for (const { id, runtime } of items) {
      const rider = runtime.onBasicAttack?.(ctx);
      if (!rider || rider.amount <= 0) continue;
      applyDamage({
        sourceId: `item:${id}`,
        sourceLabel: rider.label,
        sourceKind: 'item',
        type: rider.type,
        amount: rider.amount,
        triggersOnHit: true,
        notes: rider.notes,
      });
    }

    championRuntime.onBasicAttackHit?.(ctx);

    /*
     * The attack timer runs on the attack speed the attack *left behind*, not
     * the one it started with. Denting Blows and Hail of Blades both grant
     * attack speed as part of the hit, and taking the pre-hit value made the
     * very next attack come at the old rate — the buff showed up one attack
     * late, which is most of the point of a three-attack keystone.
     *
     * Attack speed acts on what is still ahead: the wind-up already elapsed at
     * the old rate, and only the rest of the cycle is rescaled. Recomputing the
     * whole cycle at the new speed instead would hand back time that was
     * already spent.
     */
    const speedBefore = Math.max(0.1, stats.totalAttackSpeed);
    const speedAfter = Math.max(0.1, currentStats().totalAttackSpeed);
    const remainingAtOldSpeed = Math.max(0, 1 / speedBefore - (time - attackStart));
    nextAttackReadyAt = time + remainingAtOldSpeed * (speedBefore / speedAfter);

    /*
     * An empowered attack belongs on the ability's lane, not on the attack lane.
     *
     * Relentless Force replaces the attack, and its damage is already filed
     * under E — putting the wind-up that produced it on the AA lane split one
     * action across two rows, with the bar in one and the hit in the other.
     */
    addSpan({
      lane: modifier?.slot ?? 'AA',
      kind: 'cast',
      start: attackStart,
      end: time,
      label: modifier?.label ?? 'Basic attack',
      detail: `${seconds(windup)} s wind-up`,
    });
    addSpan({
      lane: 'AA',
      kind: 'attack-timer',
      start: time,
      end: nextAttackReadyAt,
      label: 'Attack timer',
      detail: `${seconds(nextAttackReadyAt - time)} s at ${speedAfter.toFixed(3)} attack speed`,
    });
  }

  /* --------------------------------------------------------- ability gating */

  /** The charge model for a slot, or null when a plain cooldown applies. */
  function chargeSpec(slot: AbilitySlot): AbilityCharges | null {
    const spec = championRuntime.abilityCharges?.(slot, ctx) ?? null;
    return spec && spec.max > 0 && spec.rechargeSeconds > 0 ? spec : null;
  }

  /** The charge counter, caught up to the current time before it is read. */
  function chargeState(slot: AbilitySlot, spec: AbilityCharges): ChargeState {
    let state = chargeStates.get(slot);
    if (!state) {
      state = { available: spec.max, nextChargeAt: Number.POSITIVE_INFINITY, interval: 0 };
      chargeStates.set(slot, state);
    }
    // Charges refill on their own clock, whether or not anyone was looking.
    while (state.available < spec.max && time >= state.nextChargeAt) {
      state.available += 1;
      state.nextChargeAt =
        state.available < spec.max
          ? state.nextChargeAt + state.interval
          : Number.POSITIVE_INFINITY;
    }
    return state;
  }

  /** The base cooldown Riot ships for this slot at this rank, unmodified. */
  function baseCooldownOf(slot: AbilitySlot, rank: number): number {
    const meta = module.abilities.find((ability) => ability.slot === slot);
    const spell = meta?.ddragonId ? moduleCtx.spellById[meta.ddragonId] : undefined;
    return cooldownValue(spell, rank, [0]).value;
  }

  /**
   * What is keeping this ability from being cast right now, if anything.
   *
   * Both gates have to be open for an ability with charges: a charge has to be
   * available *and* the static cooldown between two uses has to have elapsed.
   */
  function blockedUntil(slot: AbilitySlot): { at: number; reason: string } | null {
    const cooldownAt = cooldowns.get(slot) ?? 0;
    const onCooldown = time < cooldownAt ? { at: cooldownAt, reason: 'cooldown' } : null;

    const spec = chargeSpec(slot);
    if (!spec) return onCooldown;

    const state = chargeState(slot, spec);
    if (state.available >= 1) return onCooldown;

    return {
      at: Math.max(cooldownAt, state.nextChargeAt),
      reason: 'no charge',
    };
  }

  function castAbility(slot: AbilitySlot, chargeSeconds: number): void {
    const rank = input.attacker.ranks[slot] ?? 0;
    if (rank < 1) {
      ctx.warn(`${slot} is not learned — step skipped.`);
      return;
    }

    /*
     * An ability that is not up yet costs the combo idle time.
     *
     * The old behaviour was to warn and cast anyway, which let a combo of three
     * Qs report a burst no player can produce. Waiting is what actually happens
     * — and the wait is written into the timeline, so the gap between two casts
     * has a stated reason instead of being a mystery.
     */
    /*
     * The resource is checked before anything else about the cast.
     *
     * Waiting for mana is not the same as waiting for a cooldown: the game does
     * not queue the cast, it refuses it. So this reports what was missing and
     * moves on rather than advancing the clock to a moment that might never
     * come — regeneration alone can take a minute.
     */
    const cost = championRuntime.abilityCost?.(slot, ctx, rank) ?? 0;
    if (cost > currentMana + 0.0005) {
      ctx.warn(
        `${slot} costs ${cost.toFixed(0)} mana and only ${currentMana.toFixed(0)} is left — step skipped.`,
      );
      return;
    }

    const blocked = blockedUntil(slot);
    if (blocked) {
      if (blocked.at > MAX_SIMULATED_SECONDS) {
        ctx.warn(
          `${slot} would not be ready until ${seconds(blocked.at)} s (${blocked.reason}) — step skipped.`,
        );
        return;
      }
      addEvent({
        kind: 'wait',
        label: `Idle ${seconds(blocked.at - time)} s`,
        detail: `${slot}: ${blocked.reason} — combo waits until ${seconds(blocked.at)} s`,
      });
      addSpan({
        lane: 'idle',
        kind: 'idle',
        start: time,
        end: blocked.at,
        label: `wait ${seconds(blocked.at - time)} s`,
        detail: `${slot}: ${blocked.reason}`,
      });
      advanceTo(blocked.at);
    }

    if (cost > 0) {
      currentMana = Math.max(0, currentMana - cost);
      manaSpent += cost;
      addEvent({
        kind: 'info',
        label: `${slot} costs ${cost.toFixed(0)}`,
        detail: `${currentMana.toFixed(0)} of ${input.attackerStats.maxMana.toFixed(0)} left`,
      });
    }

    const castStart = time;
    const timing: CastTiming = championRuntime.castDuration?.(slot, ctx, { chargeSeconds }) ?? {
      seconds: 0,
      parts: [],
    };
    addEvent({ kind: 'cast', label: `${slot} cast`, detail: describeCastTiming(timing) });
    advance(timing.seconds);

    const lock = Math.max(0, timing.lockAfterSeconds ?? 0);
    addSpan({
      lane: slot,
      kind: 'cast',
      start: castStart,
      // The lock is part of the same block: it is one stretch of time in which
      // the champion is busy, and the parts say which half is which.
      end: castStart + timing.seconds + lock,
      label: `${slot} cast`,
      detail: describeCastTiming(timing),
      parts: [
        ...timing.parts.filter((part) => part.seconds > 0.001),
        ...(lock > 0.001 ? [{ label: 'locked', seconds: lock }] : []),
      ],
    });

    /*
     * The resource is paid before the effect happens, and the cooldown is
     * counted from when the button did its work — which for a charged ability
     * is the release, not the moment the dash connects.
     */
    const cooldownFrom = castStart + Math.max(0, timing.cooldownStartsAfter ?? 0);
    const baseCooldown = baseCooldownOf(slot, rank);
    const spec = chargeSpec(slot);

    if (spec) {
      const state = chargeState(slot, spec);
      state.available = Math.max(0, state.available - 1);
      if (state.nextChargeAt === Number.POSITIVE_INFINITY) {
        state.interval =
          spec.rechargeSeconds * cooldownMultiplier(hasteFor(currentStats(), slot));
        state.nextChargeAt = cooldownFrom + state.interval;
      }
      // Ability haste shortens the recharge timer, never this static gap.
      if (baseCooldown > 0) {
        cooldowns.set(slot, cooldownFrom + baseCooldown);
        cooldownTotals.set(slot, baseCooldown);
      }
      addEvent({
        kind: 'info',
        label: `${slot} charges`,
        detail:
          `${state.available}/${spec.max} left` +
          (state.available < spec.max
            ? ` · next in ${seconds(Math.max(0, state.nextChargeAt - time))} s`
            : ''),
      });

      /*
       * One bar per recharge window, not per cast.
       *
       * The recharge timer keeps running across uses — spending the second charge
       * does not restart it — so casting twice inside one window used to draw the
       * same interval twice, and the row assignment then stacked the duplicate
       * into a second lane row. Two bars for one timer.
       */
      if (state.nextChargeAt < Number.POSITIVE_INFINITY) {
        const detail = `${state.available}/${spec.max} · ${seconds(state.interval)} s per charge`;
        const openRecharge = spans.find(
          (entry) =>
            entry.lane === slot &&
            entry.kind === 'recharge' &&
            Math.abs(entry.end - state.nextChargeAt) < 0.0005,
        );
        if (openRecharge) {
          openRecharge.detail = detail;
        } else {
          addSpan({
            lane: slot,
            kind: 'recharge',
            start: state.nextChargeAt - state.interval,
            end: state.nextChargeAt,
            label: 'Recharge',
            detail,
          });
        }
      }
      addSpan({
        lane: slot,
        kind: 'cooldown',
        start: cooldownFrom,
        end: cooldownFrom + baseCooldown,
        label: 'Static gap',
        detail: `${seconds(baseCooldown)} s between uses · not reduced by ability haste`,
      });
    } else if (baseCooldown > 0) {
      /*
        * The ultimate is discounted by plain haste only.
        *
        * Basic-ability haste — Shojin, Legend: Haste — says so in its own text,
        * and one shared number would have a 3,100 g item shortening a
        * ninety-second ultimate it cannot touch.
        */
      const effective = baseCooldown * cooldownMultiplier(hasteFor(currentStats(), slot));
      cooldowns.set(slot, cooldownFrom + effective);
      cooldownTotals.set(slot, effective);
      addSpan({
        lane: slot,
        kind: 'cooldown',
        start: cooldownFrom,
        end: cooldownFrom + effective,
        label: 'Cooldown',
        detail:
          `${seconds(effective)} s` +
          (effective < baseCooldown - 0.001
            ? ` · from ${seconds(baseCooldown)} s via ability haste`
            : ''),
      });
    }

    championRuntime.castAbility?.(slot, ctx, { chargeSeconds });

    asGear(() => {
      for (const { runtime } of items) runtime.onAbilityCast?.(ctx, slot);
    });

    /*
     * The lock is spent after the effect, not before it.
     *
     * The damage has landed by now — that is what makes this different from cast
     * time — and what the lock costs is everything the champion would otherwise
     * do next: the clock moves, and the attack timer cannot come due earlier
     * than the moment she is free again.
     */
    if (lock > 0.001) {
      addEvent({
        kind: 'info',
        label: `${slot} locks`,
        detail: `cannot act for ${seconds(lock)} s`,
      });
      advance(lock);
      nextAttackReadyAt = Math.max(nextAttackReadyAt, time);
    }

    if (championRuntime.resetsAutoAttack?.(slot)) {
      nextAttackReadyAt = time;
      addEvent({ kind: 'info', label: 'Attack timer reset', detail: slot });

      /*
       * A reset ends the running attack timer; it does not merely shorten it.
       * Leaving the old span at its original length drew a timer that was still
       * counting down next to the attack that had already cancelled it.
       */
      const openTimer = spans.find(
        (entry) => entry.kind === 'attack-timer' && entry.end > time && entry.start <= time,
      );
      if (openTimer) {
        setSpanEnd(openTimer, time, `cancelled by ${slot}`);
      }

      asGear(() => {
        for (const { runtime } of runes) runtime.onAttackReset?.(ctx);
      });
    }

    // An ability whose whole point is the attack it empowers carries that
    // attack itself, so one step in the combo is one action by the player.
    if (championRuntime.attacksOnCast?.(slot)) performAttack();
  }

  function castSummoner(summonerId: string): void {
    const stats = currentStats();
    if (summonerId === IGNITE.id) {
      const total = byLevel(IGNITE.total, stats.level);
      const perTick = total / IGNITE.ticks;
      addEvent({
        kind: 'cast',
        label: IGNITE.label,
        detail: `${total.toFixed(0)} over ${IGNITE.ticks} s`,
      });
      addSpan({
        lane: 'summoner',
        kind: 'dot',
        start: time,
        end: time + IGNITE.ticks,
        label: IGNITE.label,
        detail: `${total.toFixed(0)} true damage over ${IGNITE.ticks} s`,
      });
      // Ticks land long after this step is done, so they carry its identity
      // with them rather than being credited to whatever is running then.
      const owner = currentStepUid;
      for (let tick = 1; tick <= IGNITE.ticks; tick += 1) {
        const at = time + tick;
        scheduled.push({
          at,
          run: () =>
            attributedTo(owner, () =>
              applyDamage({
                sourceId: 'summoner:ignite',
                sourceLabel: `${IGNITE.label} (tick ${tick}/${IGNITE.ticks})`,
                sourceKind: 'summoner',
                type: 'true',
                amount: perTick,
              }),
            ),
        });
      }
      advance(input.timings.inputDelay);
      return;
    }

    const smite = smiteById(summonerId);
    if (smite) {
      const champion = input.target.unitType === 'champion';
      /*
       * Base Smite cannot be pointed at a champion at all; the upgrades can, for
       * a levelled amount rather than the monster execute. Pointing a spell at
       * something it cannot hit is a mistake worth naming, not a zero to add.
       */
      if (champion && !smite.championDamage) {
        ctx.warn(`${smite.label} does not affect champions — step skipped.`);
        return;
      }
      const amount = champion
        ? byLevel(smite.championDamage!, stats.level)
        : smite.monsterDamage;
      const smiteStart = time;
      applyDamage({
        sourceId: `summoner:${smite.id}`,
        sourceLabel: smite.label,
        sourceKind: 'summoner',
        type: 'true',
        amount,
        notes: [champion ? 'levelled value against champions' : 'fixed value against monsters'],
      });
      if (smite.rider) ctx.warn(`${smite.label}: ${smite.rider}`);
      advance(input.timings.inputDelay);
      // Short, but it is time the combo spent, and every other cast shows its.
      addSpan({
        lane: 'summoner',
        kind: 'cast',
        start: smiteStart,
        end: time,
        label: smite.label,
        detail: `${seconds(input.timings.inputDelay)} s input`,
      });
      return;
    }

    ctx.warn(`Summoner spell ${summonerId} is not modelled — step skipped.`);
  }

  /* --------------------------------------------------------------- main loop */

  // The state before anything happens, so the first step has something to be a
  // change *from*.
  // What the pet gives you before anything is pressed.
  for (const pet of pets) pet.onStart?.(ctx);

  takeSnapshot(-1);

  /** Steps the combo never got to, because the target was already dead. */
  const unusedSteps: string[] = [];

  for (const [stepIndex, step] of input.combo.entries()) {
    if (time >= MAX_SIMULATED_SECONDS) {
      ctx.warn(`Simulation stopped after ${MAX_SIMULATED_SECONDS} s.`);
      break;
    }
    /*
     * The combo stops when the target does.
     *
     * Everything after the kill is damage into a corpse: it inflated the totals,
     * stretched the timeline past the moment that mattered and made the DPS a
     * rate over seconds nobody was fighting for. The steps are kept — they are
     * still part of the plan you typed — and reported as unused so the strip can
     * grey them out.
     */
    if (targetCurrentHealth <= 0) {
      unusedSteps.push(...input.combo.slice(stepIndex).map((entry) => entry.uid));
      break;
    }
    currentStepUid = step.uid;
    switch (step.action.kind) {
      case 'attack':
        performAttack();
        break;
      case 'ability':
        castAbility(step.action.slot, step.chargeSeconds ?? 0);
        break;
      case 'wait': {
        /*
         * A deliberate pause is drawn like forced idle time, because it costs
         * the combo exactly the same — but it is labelled differently: this one
         * the player asked for. Without a bar it was a silent gap in the
         * timeline, which is the one thing this view exists to prevent.
         */
        const seconds = Math.max(0, step.action.seconds);
        addSpan({
          lane: 'idle',
          kind: 'idle',
          start: time,
          end: time + seconds,
          label: `wait ${seconds} s`,
          detail: 'deliberate pause in the combo',
        });
        advance(seconds);
        break;
      }
      case 'summoner':
        castSummoner(step.action.summonerId);
        break;
      case 'item': {
        const effect = getItemEffect(step.action.itemId);
        ctx.warn(
          effect
            ? `Item active ${effect.name} is only modelled as a passive — step skipped.`
            : 'Item actives are not modelled yet — step skipped.',
        );
        break;
      }
    }
    // The state this step left behind, before the next one starts.
    takeSnapshot(stepIndex, step.uid);
    currentStepUid = undefined;
  }

  /*
   * Let scheduled damage-over-time finish — but only if there is anything left
   * to hurt. With the target down, draining the queue would only move the clock,
   * and the clock is what the chart's width and the DPS window are made of.
   */
  if (targetCurrentHealth > 0) {
    const lastScheduled = scheduled.reduce((max, entry) => Math.max(max, entry.at), time);
    advanceTo(lastScheduled);
  }


  const totalRaw = instances.reduce((sum, instance) => sum + instance.raw, 0);
  const totalMitigated = instances.reduce((sum, instance) => sum + instance.mitigated, 0);
  const killer = instances.find((instance) => instance.targetHpAfter <= 0);

  /*
   * One bar for the whole regenerated amount, not one per tick.
   *
   * Twenty ticks would be twenty bars saying the same thing; what a reader wants
   * is the window it happened over and the total it came to.
   */
  if (targetRegenerated > 0.5) {
    addSpan({
      lane: 'sustain',
      kind: 'effect',
      start: 0,
      end: time,
      label: 'Target regenerates',
      detail: `+${targetRegenerated.toFixed(0)} health over ${seconds(time)} s`,
      effectKind: 'defense',
      effectOrigin: 'champion',
    });
  }

  return {
    instances,
    events,
    snapshots,
    unusedSteps,
    // Sorted so a view can draw them in the order they began, whatever order
    // the simulation happened to record them in.
    spans: [...spans].sort((a, b) => a.start - b.start || a.end - b.end),
    totalRaw,
    totalMitigated,
    /*
     * As long as the fight, not as long as the plan.
     *
     * With the target down, the clock kept running through the last cast's
     * animation lock — which stretched the chart and diluted the damage per
     * second over seconds in which nothing was at stake.
     */
    duration: killer ? killer.time : time,
    killTime: killer?.time ?? null,
    targetHpRemaining: targetCurrentHealth,
    shieldGained,
    healingDone,
    manaSpent,
    targetRegenerated,
    warnings,
  };
}

/**
 * Crit is folded into damage as a multiplier rather than rolled, because a
 * calculator wants a reproducible number. `expected` gives the statistical
 * average, which is what build comparisons should use; `always` and `never`
 * bracket the best and worst case.
 */
function critMultiplierFor(chance: number, multiplier: number, mode: CritMode): number {
  if (mode === 'always') return multiplier;
  if (mode === 'never') return 1;
  return 1 + chance * (multiplier - 1);
}

function dropExpired(list: { expiresAt: number }[], now: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.expiresAt <= now) list.splice(i, 1);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
