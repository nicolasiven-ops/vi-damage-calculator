/**
 * Vi — the Piltover Enforcer.
 *
 * ## Where the numbers come from
 *
 * Every damage number in this file is read from Riot's own spell formulas for
 * the selected patch (`data/bin.ts`), evaluated against the current stat block.
 * The constants in `FALLBACK` are used only when those formulas cannot be
 * loaded or read, and the formula inspector labels which of the two produced
 * each value, per value.
 *
 * That split exists because Data Dragon stopped shipping ability damage. For
 * Vi it reports 0 base damage on all four abilities and no ratios at all, so
 * "read it from Riot's CDN" is not an option — it has to come from the game
 * data, or from a constant that says out loud that it is a constant.
 *
 * ## The fallback constants
 *
 * Last verified against patch 16.16, cross-checked value by value against the
 * official wiki. Two of them were wrong before that check and are worth
 * calling out, because both produced plausible-looking damage:
 *
 *  - Q scales with **bonus** AD, not total AD. At 60 base and 100 bonus AD,
 *    rank 1 dealt 136 instead of 100.
 *  - R's base damage is 150/250/350, not 150/325/500.
 *
 * That is exactly the failure mode the game-data path removes: these numbers
 * now come from the same file the client reads.
 */

import type {
  AbilityCharges,
  CastTiming,
  ChampionRuntime,
  SimContext,
} from '../../engine/context';
import type { AbilitySlot } from '../../engine/types';
import { num, statLookup } from '../spellcalc';
import {
  calcBase,
  calcRatio,
  calcValue,
  cooldownValue,
  gameValue,
  spellTiming,
  type AbilityMeta,
  type ChampionModule,
  type ChampionModuleContext,
  type SourcedNumber,
  type ValueSource,
} from './types';

const SPELL_IDS = {
  Q: 'ViQ',
  W: 'ViW',
  E: 'ViE',
  R: 'ViR',
  /** The passive's formulas live under its own script name, not the champion's. */
  P: 'ViPassive',
} as const;

/**
 * Maintained fallbacks, used only where the patch's game data cannot answer.
 * Last reviewed against patch 16.16 and the official wiki.
 */
const FALLBACK = {
  q: {
    minBase: [40, 60, 80, 100, 120],
    maxBase: [100, 150, 200, 250, 300],
    /** Bonus AD, not total — see the file header. */
    minBonusAdRatio: 0.6,
    maxBonusAdRatio: 1.5,
    /** Damage and dash range ramp over this window, not over the full hold. */
    maxChargeSeconds: 1.25,
    cooldown: [12, 10.5, 9, 7.5, 6],
  },
  w: {
    /** Fraction of the target's maximum health, per rank. */
    maxHealthPercent: [0.04, 0.05, 0.06, 0.07, 0.08],
    /** Additional max-health fraction per point of bonus AD (3.5 % per 100). */
    perBonusAd: 0.00035,
    /** Hard cap against minions and monsters. */
    monsterCap: 300,
    hitsToProc: 3,
    /** Stacks expire if the next hit lands later than this. */
    markerSeconds: 4,
    armorShredPercent: 0.2,
    shredDurationSeconds: 4,
    attackSpeedBonus: [0.3, 0.35, 0.4, 0.45, 0.5],
    attackSpeedDurationSeconds: 4,
  },
  e: {
    base: [10, 30, 50, 70, 90],
    totalAdRatio: 1.1,
    apRatio: 1.0,
    charges: 2,
    rechargeSeconds: [12, 11, 10, 9, 8],
  },
  r: {
    base: [150, 250, 350],
    bonusAdRatio: 0.9,
    cooldown: [140, 115, 90],
    knockupSeconds: 1.3,
  },
  passive: {
    /** Shield as a fraction of Vi's maximum health. */
    maxHealthPercent: 0.12,
    durationSeconds: 3,
    /**
     * 16 s at level 1, falling 0.5 s per level until it flattens out at 12 s
     * from level 9 on. The game data expresses this as a breakpoint curve whose
     * per-level step stops at level 10, which lands on the same 16–12 range the
     * client shows.
     */
    cooldownAtLevel1: 16,
    cooldownPerLevel: -0.5,
    cooldownFloor: 12,
    /** Denting Blows' proc refunds this much of the shield's remaining cooldown. */
    cooldownRefundOnProc: 4,
  },
} as const;

/* ------------------------------------------------------------------- helpers */

function pct(fraction: number): string {
  return `${num(fraction * 100)}%`;
}

/** Per-rank constant lookup that clamps instead of returning undefined. */
function atRank(values: readonly number[], rank: number): number {
  const index = Math.max(0, Math.min(values.length - 1, rank - 1));
  return values[index] ?? 0;
}

/** The weakest source among several values, which is what a row can claim. */
function combinedSource(...values: SourcedNumber[]): ValueSource {
  if (values.some((entry) => entry.source === 'registry')) return 'registry';
  if (values.some((entry) => entry.source === 'ddragon')) return 'ddragon';
  return 'gamedata';
}

/** The first explanation any of these values carried, if any. */
function firstNote(...values: SourcedNumber[]): string | undefined {
  return values.find((entry) => entry.note)?.note;
}

function passiveCooldownFallback(level: number): number {
  const { cooldownAtLevel1, cooldownPerLevel, cooldownFloor } = FALLBACK.passive;
  const clamped = Math.max(1, Math.min(18, level));
  return Math.max(cooldownFloor, cooldownAtLevel1 + cooldownPerLevel * (clamped - 1));
}

/* -------------------------------------------------------- ability metadata */

const ABILITIES: AbilityMeta[] = [
  {
    slot: 'P',
    ddragonId: '',
    name: 'Blast Shield',
    maxRank: 1,
    castable: false,
    modelNotes: [
      `Shields ${pct(FALLBACK.passive.maxHealthPercent)} of Vi's maximum health for ${FALLBACK.passive.durationSeconds} s.`,
      'Triggers as soon as an ability hits an enemy — basic attacks do not count.',
      "Cooldown falls with champion level, read from Riot's own level curve.",
    ],
  },
  {
    slot: 'Q',
    ddragonId: SPELL_IDS.Q,
    name: 'Vault Breaker',
    maxRank: 5,
    castable: true,
    chargeable: { maxSeconds: FALLBACK.q.maxChargeSeconds },
    modelNotes: [
      'Damage scales linearly with charge time, between the minimum and the maximum.',
      'Scales with bonus attack damage, not total AD.',
      'Applies a stack of Denting Blows — but not on-hit effects from items and runes.',
      'The cooldown starts on release: the charge is held before it, the dash runs inside it.',
      'Triggers Blast Shield.',
    ],
  },
  {
    slot: 'W',
    ddragonId: SPELL_IDS.W,
    name: 'Denting Blows',
    maxRank: 5,
    castable: false,
    modelNotes: [
      `Every ${FALLBACK.w.hitsToProc}rd hit on the same target triggers it.`,
      'Basic attacks are not the only source: Vault Breaker applies a stack too.',
      `The counter expires if more than ${FALLBACK.w.markerSeconds} s pass between two hits.`,
      'The armor shred applies only to what follows the proc — not to the hit that triggered it, and not to the bonus damage itself.',
      "Bonus damage as a share of the target's maximum health, scaling with bonus AD.",
      `Reduces the target's armor by ${pct(FALLBACK.w.armorShredPercent)} for ${FALLBACK.w.shredDurationSeconds} s.`,
      `Grants Vi attack speed for ${FALLBACK.w.attackSpeedDurationSeconds} s.`,
      `Cuts ${FALLBACK.passive.cooldownRefundOnProc} s off Blast Shield's remaining cooldown.`,
      `Capped at ${FALLBACK.w.monsterCap} damage against minions and monsters.`,
    ],
  },
  {
    slot: 'E',
    ddragonId: SPELL_IDS.E,
    name: 'Relentless Force',
    maxRank: 5,
    castable: true,
    modelNotes: [
      'The step *is* the empowered attack — an attack step after it is a second, ordinary attack.',
      "Replaces the attack's damage instead of adding to it — hence total AD: the attack damage is already inside it.",
      'Resets the attack timer and applies on-hit effects.',
      `${FALLBACK.e.charges} charges on one shared recharge timer — it keeps running across uses instead of restarting, and refills them one at a time. Plus a 1 s static gap between two uses; with no charge available, the combo waits.`,
      'Counts as a basic attack for Denting Blows.',
    ],
  },
  {
    slot: 'R',
    ddragonId: SPELL_IDS.R,
    name: 'Cease and Desist',
    maxRank: 3,
    castable: true,
    modelNotes: [
      'Scales with bonus attack damage, not total AD.',
      'Knocks the target into the air.',
      'Applies no on-hit effects.',
      'Triggers Blast Shield.',
    ],
  },
];

/* ------------------------------------------------------------------ runtime */

class ViRuntime implements ChampionRuntime {
  /** Basic attacks landed on the current target inside the marker window. */
  private attackCount = 0;
  /** When the current Denting Blows stacks expire. */
  private stacksExpireAt = Number.POSITIVE_INFINITY;
  /** Whether the next basic attack is empowered by E. */
  private empowered = false;
  /** Time at which Blast Shield may proc again. */
  private passiveReadyAt = 0;

  constructor(private readonly ctx: ChampionModuleContext) {}

  /**
   * The name to show for one of Vi's abilities, plus its slot.
   *
   * Read from Data Dragon rather than written here, for the same reason the
   * ability metadata is: Riot renames abilities on rework — this E was
   * "Excessive Force" before it was "Relentless Force" — and a name baked into
   * this file goes stale without anything failing. Worse, it went stale
   * *inconsistently*: the ability list showed Riot's current name while every
   * damage row in the timeline showed the one hardcoded here.
   */
  private label(slot: AbilitySlot, fallback: string): string {
    const live =
      slot === 'P' ? this.ctx.detail?.passive?.name : this.ctx.spellById[SPELL_IDS[slot]]?.name;
    return `${live ?? fallback} (${slot})`;
  }

  resetsAutoAttack(slot: AbilitySlot): boolean {
    return slot === 'E';
  }

  /**
   * Relentless Force holds two charges rather than sitting on a cooldown.
   *
   * Both numbers come from the patch's own spell data: Data Dragon reports the
   * charge count and the 1 s static gap between two uses, the bin file the
   * recharge time. The simulation owns the counter — this only declares it.
   */
  abilityCharges(slot: AbilitySlot, ctx: SimContext): AbilityCharges | null {
    if (slot !== 'E') return null;
    const rank = Math.max(1, ctx.rank('E'));
    return {
      max: spellTiming(this.ctx, SPELL_IDS.E, 'maxAmmo', rank, FALLBACK.e.charges).value,
      rechargeSeconds: spellTiming(
        this.ctx,
        SPELL_IDS.E,
        'ammoRechargeTime',
        rank,
        atRank(FALLBACK.e.rechargeSeconds, rank),
      ).value,
    };
  }

  /**
   * An E step is the empowered attack, not a self-buff waiting for one.
   *
   * The ability does nothing until an attack spends it, so "E" in a combo means
   * what a player means by it: hit them with it. Adding an attack step after E
   * is then a second, ordinary attack rather than the one E paid for.
   */
  attacksOnCast(slot: AbilitySlot): boolean {
    return slot === 'E';
  }

  /** How long Q's damage keeps ramping, from the patch's own channel time. */
  private chargeWindow(ctx: SimContext): number {
    return spellTiming(
      this.ctx,
      SPELL_IDS.Q,
      'channelDuration',
      Math.max(1, ctx.rank('Q')),
      FALLBACK.q.maxChargeSeconds,
    ).value;
  }

  /**
   * What a cast costs in time, itemised.
   *
   * None of these are published by Riot in machine-readable form, so they are
   * assumptions — editable in the Simulation panel and named here so the
   * timeline can show which assumption delayed the first hit.
   */
  castDuration(slot: AbilitySlot, ctx: SimContext, options: { chargeSeconds: number }): CastTiming {
    const parts = (entries: { label: string; seconds: number }[]): CastTiming => ({
      seconds: entries.reduce((sum, entry) => sum + entry.seconds, 0),
      parts: entries,
    });

    switch (slot) {
      case 'Q': {
        // The cooldown starts on release: the charge is held before it begins,
        // the dash to the target runs inside it.
        const charge = Math.min(options.chargeSeconds, this.chargeWindow(ctx));
        return {
          ...parts([
            { label: 'charge', seconds: charge },
            { label: 'dash to target', seconds: ctx.timings.dashTravel },
          ]),
          cooldownStartsAfter: charge,
        };
      }
      case 'R':
        return parts([{ label: 'dash to target', seconds: ctx.timings.dashTravel }]);
      default:
        return parts([{ label: 'input', seconds: ctx.timings.inputDelay }]);
    }
  }

  castAbility(slot: AbilitySlot, ctx: SimContext, options: { chargeSeconds: number }): void {
    switch (slot) {
      case 'Q':
        this.castQ(ctx, options.chargeSeconds);
        break;
      case 'E':
        this.castE(ctx);
        break;
      case 'R':
        this.castR(ctx);
        break;
      case 'W':
        ctx.warn('Denting Blows is passive and cannot be cast — step ignored.');
        break;
      case 'P':
        ctx.warn('Blast Shield is passive and cannot be cast — step ignored.');
        break;
    }
  }

  /**
   * Vault Breaker.
   *
   * Riot ships two formulas: `TotalDamage` for a tap and `MaxDamageTooltip`
   * for a full charge, the latter being the former times a fixed multiplier.
   * Both the flat part and the ratio are interpolated over the charge window,
   * which is what makes a half-charged Q land between the two.
   */
  private castQ(ctx: SimContext, chargeSeconds: number): void {
    const rank = ctx.rank('Q');
    if (rank < 1) {
      ctx.warn('Vault Breaker is not learned — step ignored.');
      return;
    }

    const window = this.chargeWindow(ctx);
    const charge = Math.min(Math.max(0, chargeSeconds), window);
    const ratio = window > 0 ? charge / window : 1;

    const minBase = calcBase(this.ctx, SPELL_IDS.Q, 'TotalDamage', rank, atRank(FALLBACK.q.minBase, rank));
    const maxBase = calcBase(this.ctx, SPELL_IDS.Q, 'MaxDamageTooltip', rank, atRank(FALLBACK.q.maxBase, rank));
    const minRatio = calcRatio(this.ctx, SPELL_IDS.Q, 'TotalDamage', rank, 'ad', 'bonus', FALLBACK.q.minBonusAdRatio);
    const maxRatio = calcRatio(this.ctx, SPELL_IDS.Q, 'MaxDamageTooltip', rank, 'ad', 'bonus', FALLBACK.q.maxBonusAdRatio);

    const base = minBase.value + (maxBase.value - minBase.value) * ratio;
    const adRatio = minRatio.value + (maxRatio.value - minRatio.value) * ratio;
    const amount = base + adRatio * ctx.stats.bonusAttackDamage;

    ctx.dealDamage({
      sourceId: 'Q',
      sourceLabel: this.label('Q', 'Vault Breaker'),
      sourceKind: 'ability',
      slot: 'Q',
      type: 'physical',
      amount,
      isAbilityDamage: true,
      notes: [
        `charged ${(ratio * 100).toFixed(0)}% (${charge.toFixed(2)} s of ${num(window)} s)`,
        `${base.toFixed(0)} base + ${pct(adRatio)} bonus AD`,
      ],
    });

    // Vault Breaker applies Denting Blows to everything it hits.
    this.applyDentingBlows(ctx);
    this.tryPassive(ctx);
  }

  private castE(ctx: SimContext): void {
    const rank = ctx.rank('E');
    if (rank < 1) {
      ctx.warn('Relentless Force is not learned — step ignored.');
      return;
    }

    // Charges are the simulation's business: it has already made sure one was
    // available and spent it, so reaching this point means the attack is
    // empowered. Nothing here needs to count.
    this.empowered = true;
    ctx.addEvent({
      kind: 'buff',
      label: `${this.label('E', 'Relentless Force')} ready`,
      detail: 'Next basic attack is empowered',
    });
  }

  private castR(ctx: SimContext): void {
    const rank = ctx.rank('R');
    if (rank < 1) {
      ctx.warn('Cease and Desist is not learned — step ignored.');
      return;
    }

    const base = calcBase(this.ctx, SPELL_IDS.R, 'Damage', rank, atRank(FALLBACK.r.base, rank));
    const adRatio = calcRatio(this.ctx, SPELL_IDS.R, 'Damage', rank, 'ad', 'bonus', FALLBACK.r.bonusAdRatio);
    const knockup = gameValue(this.ctx, SPELL_IDS.R, 'RStunDuration', rank, FALLBACK.r.knockupSeconds);

    ctx.dealDamage({
      sourceId: 'R',
      sourceLabel: this.label('R', 'Cease and Desist'),
      sourceKind: 'ability',
      slot: 'R',
      type: 'physical',
      amount: base.value + adRatio.value * ctx.stats.bonusAttackDamage,
      isAbilityDamage: true,
      notes: [`${base.value.toFixed(0)} base + ${pct(adRatio.value)} bonus AD`],
    });

    ctx.addEvent({
      kind: 'info',
      label: 'Knock-up',
      detail: `target is airborne for ${num(knockup.value)} s`,
    });

    this.tryPassive(ctx);
  }

  /**
   * Relentless Force replaces the attack's damage instead of adding to it,
   * which is why its ratio is total AD: the attack itself is inside the 110 %.
   */
  modifyBasicAttack(ctx: SimContext) {
    if (!this.empowered) return null;
    const rank = ctx.rank('E');
    if (rank < 1) return null;

    const base = calcBase(this.ctx, SPELL_IDS.E, 'TotalDamageTooltip', rank, atRank(FALLBACK.e.base, rank));
    const adRatio = calcRatio(this.ctx, SPELL_IDS.E, 'TotalDamageTooltip', rank, 'ad', 'total', FALLBACK.e.totalAdRatio);
    const apRatio = calcRatio(this.ctx, SPELL_IDS.E, 'TotalDamageTooltip', rank, 'ap', 'total', FALLBACK.e.apRatio);

    const total =
      base.value +
      adRatio.value * ctx.stats.totalAttackDamage +
      apRatio.value * ctx.stats.abilityPower;

    // Single-use empowerment: consumed by the attack it modifies.
    this.empowered = false;

    return {
      replacementDamage: total,
      label: this.label('E', 'Relentless Force'),
      slot: 'E' as AbilitySlot,
      notes: [
        `${base.value.toFixed(0)} base + ${pct(adRatio.value)} total AD` +
          (ctx.stats.abilityPower > 0 ? ` + ${pct(apRatio.value)} AP` : ''),
      ],
    };
  }

  onBasicAttackHit(ctx: SimContext): void {
    this.applyDentingBlows(ctx);
  }

  /**
   * One stack of Denting Blows on the current target.
   *
   * Basic attacks are not the only source: Vault Breaker applies a stack too
   * ("applying Denting Blows to all enemies hit" in its own tooltip), which
   * makes Q → AA → E a three-stack sequence that procs on the E.
   *
   * The counter is a buff on the target with its own duration, so a combo slow
   * enough to let it lapse starts over — the same way it does in the client.
   *
   * Order matters and is deliberate: the caller has already dealt its damage
   * when this runs, and the proc deals its own damage *before* applying the
   * armor reduction. Riot resolves it the same way — the shred never applies
   * to the hit that triggered it, only to what comes after.
   */
  private applyDentingBlows(ctx: SimContext): void {
    const rank = ctx.rank('W');
    if (rank < 1) return;

    const markerSeconds = gameValue(this.ctx, SPELL_IDS.W, 'MarkerBuffDuration', rank, FALLBACK.w.markerSeconds).value;
    const stacksBefore = gameValue(this.ctx, SPELL_IDS.W, 'StacksBeforeEffect', rank, FALLBACK.w.hitsToProc - 1).value;
    const hitsToProc = stacksBefore + 1;

    if (ctx.time > this.stacksExpireAt) {
      this.attackCount = 0;
      ctx.addEvent({
        kind: 'info',
        label: this.label('W', 'Denting Blows'),
        detail: `counter expired (${num(markerSeconds)} s without a hit)`,
      });
    }

    this.attackCount += 1;
    this.stacksExpireAt = ctx.time + markerSeconds;

    if (this.attackCount % hitsToProc !== 0) {
      ctx.addEvent({
        kind: 'info',
        label: this.label('W', 'Denting Blows'),
        detail: `${this.attackCount % hitsToProc}/${hitsToProc} hits`,
      });
      return;
    }

    const flat = calcBase(this.ctx, SPELL_IDS.W, 'TotalDamageTooltip', rank, atRank(FALLBACK.w.maxHealthPercent, rank));
    const perAd = calcRatio(this.ctx, SPELL_IDS.W, 'TotalDamageTooltip', rank, 'ad', 'bonus', FALLBACK.w.perBonusAd);
    const fromAd = perAd.value * ctx.stats.bonusAttackDamage;
    const percent = flat.value + fromAd;

    let amount = ctx.targetMaxHealth * percent;
    const notes = [
      `${pct(flat.value)} + ${pct(fromAd)} from ${ctx.stats.bonusAttackDamage.toFixed(0)} bonus AD`,
      `= ${pct(percent)} of maximum health`,
    ];

    const cap = gameValue(this.ctx, SPELL_IDS.W, 'MonsterDamageCap', rank, FALLBACK.w.monsterCap).value;
    if (ctx.target.unitType !== 'champion' && amount > cap) {
      amount = cap;
      notes.push(`capped at ${cap} (minion/monster)`);
    }

    ctx.dealDamage({
      sourceId: 'W',
      sourceLabel: this.label('W', 'Denting Blows'),
      sourceKind: 'passive',
      slot: 'W',
      type: 'physical',
      amount,
      notes,
    });

    const shred = gameValue(this.ctx, SPELL_IDS.W, 'ShredAmount', rank, FALLBACK.w.armorShredPercent * 100).value;
    const buffDuration = gameValue(
      this.ctx,
      SPELL_IDS.W,
      'SharedBuffsDuration',
      rank,
      FALLBACK.w.shredDurationSeconds,
    ).value;

    ctx.applyArmorShred({
      // Riot stores the shred as whole percent; the engine wants a fraction.
      percent: shred / 100,
      durationSeconds: buffDuration,
      label: this.label('W', 'Denting Blows'),
    });

    const attackSpeed = gameValue(
      this.ctx,
      SPELL_IDS.W,
      'AttackSpeed',
      rank,
      atRank(FALLBACK.w.attackSpeedBonus, rank) * 100,
    ).value;

    ctx.applyTemporaryStats({
      stats: { attackSpeed: attackSpeed / 100 },
      durationSeconds: buffDuration,
      label: `${this.label('W', 'Denting Blows')} · +${num(attackSpeed)}% attack speed`,
    });

    this.refundPassiveCooldown(ctx);
  }

  /**
   * Denting Blows shortens Blast Shield's remaining cooldown, which is the only
   * way the shield can come back inside one combo. Riot keeps the amount on the
   * passive, not on W.
   */
  private refundPassiveCooldown(ctx: SimContext): void {
    if (this.passiveReadyAt <= ctx.time) return;
    const refund = gameValue(
      this.ctx,
      SPELL_IDS.P,
      'CDReductionOn3Hit',
      1,
      FALLBACK.passive.cooldownRefundOnProc,
    ).value;
    if (refund <= 0) return;

    this.passiveReadyAt = Math.max(ctx.time, this.passiveReadyAt - refund);
    ctx.addEvent({
      kind: 'info',
      label: this.label('P', 'Blast Shield'),
      detail: `cooldown cut by ${num(refund)} s · ready again in ${num(Math.max(0, this.passiveReadyAt - ctx.time))} s`,
    });
  }

  /** Blast Shield: any ability damage, on its own level-scaled cooldown. */
  private tryPassive(ctx: SimContext): void {
    if (ctx.time < this.passiveReadyAt) return;

    const stats = statLookup(ctx.stats);
    const shieldRatio = calcRatio(this.ctx, SPELL_IDS.P, 'TotalShield', 1, 'maxHealth', 'total', FALLBACK.passive.maxHealthPercent);
    const duration = gameValue(this.ctx, SPELL_IDS.P, 'ShieldDuration', 1, FALLBACK.passive.durationSeconds);
    const cooldown = calcValue(
      this.ctx,
      SPELL_IDS.P,
      'ShieldCooldown',
      1,
      stats,
      passiveCooldownFallback(ctx.stats.level),
    );

    ctx.grantShield({
      amount: ctx.stats.maxHealth * shieldRatio.value,
      durationSeconds: duration.value,
      label: this.label('P', 'Blast Shield'),
    });

    this.passiveReadyAt = ctx.time + cooldown.value;
  }
}

/* ------------------------------------------------------------- module export */

export const VI_MODULE: ChampionModule = {
  championId: 'Vi',
  displayName: 'Vi',
  constantsReviewedPatch: '16.16',
  abilities: ABILITIES,
  createRuntime: (ctx) => new ViRuntime(ctx),

  describeValues(ctx, ranks) {
    const rows: ReturnType<ChampionModule['describeValues']> = [];
    const row = (
      slot: AbilitySlot,
      label: string,
      value: string,
      ...sourced: SourcedNumber[]
    ): void => {
      rows.push({
        slot,
        label,
        value,
        source: combinedSource(...sourced),
        note: firstNote(...sourced),
        formula: sourced.find((entry) => entry.formula)?.formula,
      });
    };

    /* ------------------------------------------------------------------ Q */
    const qRank = Math.max(1, ranks.Q);
    const qMin = calcBase(ctx, SPELL_IDS.Q, 'TotalDamage', qRank, atRank(FALLBACK.q.minBase, qRank));
    const qMax = calcBase(ctx, SPELL_IDS.Q, 'MaxDamageTooltip', qRank, atRank(FALLBACK.q.maxBase, qRank));
    const qMinRatio = calcRatio(ctx, SPELL_IDS.Q, 'TotalDamage', qRank, 'ad', 'bonus', FALLBACK.q.minBonusAdRatio);
    const qMaxRatio = calcRatio(ctx, SPELL_IDS.Q, 'MaxDamageTooltip', qRank, 'ad', 'bonus', FALLBACK.q.maxBonusAdRatio);
    const qCharge = spellTiming(ctx, SPELL_IDS.Q, 'channelDuration', qRank, FALLBACK.q.maxChargeSeconds);
    const qCd = cooldownValue(ctx.spellById[SPELL_IDS.Q], qRank, [...FALLBACK.q.cooldown]);

    row('Q', 'Base damage (tapped)', qMin.value.toFixed(0), qMin);
    row('Q', 'Base damage (fully charged)', qMax.value.toFixed(0), qMax);
    row('Q', 'Bonus AD ratio', `${pct(qMinRatio.value)} → ${pct(qMaxRatio.value)}`, qMinRatio, qMaxRatio);
    row('Q', 'Charge time to maximum', `${num(qCharge.value)} s`, qCharge);
    row('Q', 'Cooldown', `${num(qCd.value)} s`, qCd);

    /* ------------------------------------------------------------------ W */
    const wRank = Math.max(1, ranks.W);
    const wFlat = calcBase(ctx, SPELL_IDS.W, 'TotalDamageTooltip', wRank, atRank(FALLBACK.w.maxHealthPercent, wRank));
    const wPerAd = calcRatio(ctx, SPELL_IDS.W, 'TotalDamageTooltip', wRank, 'ad', 'bonus', FALLBACK.w.perBonusAd);
    const wShred = gameValue(ctx, SPELL_IDS.W, 'ShredAmount', wRank, FALLBACK.w.armorShredPercent * 100);
    const wBuff = gameValue(ctx, SPELL_IDS.W, 'SharedBuffsDuration', wRank, FALLBACK.w.shredDurationSeconds);
    const wAs = gameValue(ctx, SPELL_IDS.W, 'AttackSpeed', wRank, atRank(FALLBACK.w.attackSpeedBonus, wRank) * 100);
    const wStacks = gameValue(ctx, SPELL_IDS.W, 'StacksBeforeEffect', wRank, FALLBACK.w.hitsToProc - 1);
    const wMarker = gameValue(ctx, SPELL_IDS.W, 'MarkerBuffDuration', wRank, FALLBACK.w.markerSeconds);
    const wCap = gameValue(ctx, SPELL_IDS.W, 'MonsterDamageCap', wRank, FALLBACK.w.monsterCap);

    row('W', 'Max-health damage', pct(wFlat.value), wFlat);
    row('W', 'per 100 bonus AD', pct(wPerAd.value * 100), wPerAd);
    row('W', 'Armor shred', `${num(wShred.value)}% for ${num(wBuff.value)} s`, wShred, wBuff);
    row('W', 'Attack speed', `+${num(wAs.value)}% for ${num(wBuff.value)} s`, wAs, wBuff);
    row('W', 'Hits to proc', `${wStacks.value + 1} · counter lasts ${num(wMarker.value)} s`, wStacks, wMarker);
    row('W', 'Cap vs minions and monsters', wCap.value.toFixed(0), wCap);

    /* ------------------------------------------------------------------ E */
    const eRank = Math.max(1, ranks.E);
    const eBase = calcBase(ctx, SPELL_IDS.E, 'TotalDamageTooltip', eRank, atRank(FALLBACK.e.base, eRank));
    const eAd = calcRatio(ctx, SPELL_IDS.E, 'TotalDamageTooltip', eRank, 'ad', 'total', FALLBACK.e.totalAdRatio);
    const eAp = calcRatio(ctx, SPELL_IDS.E, 'TotalDamageTooltip', eRank, 'ap', 'total', FALLBACK.e.apRatio);
    const eCharges = spellTiming(ctx, SPELL_IDS.E, 'maxAmmo', eRank, FALLBACK.e.charges);
    const eRecharge = spellTiming(ctx, SPELL_IDS.E, 'ammoRechargeTime', eRank, atRank(FALLBACK.e.rechargeSeconds, eRank));

    row('E', 'Base damage', eBase.value.toFixed(0), eBase);
    row('E', 'Total AD ratio', pct(eAd.value), eAd);
    row('E', 'AP ratio', pct(eAp.value), eAp);
    row('E', 'Charges', eCharges.value.toFixed(0), eCharges);
    row('E', 'Recharge time', `${num(eRecharge.value)} s`, eRecharge);

    /* ------------------------------------------------------------------ R */
    const rRank = Math.max(1, ranks.R);
    const rBase = calcBase(ctx, SPELL_IDS.R, 'Damage', rRank, atRank(FALLBACK.r.base, rRank));
    const rAd = calcRatio(ctx, SPELL_IDS.R, 'Damage', rRank, 'ad', 'bonus', FALLBACK.r.bonusAdRatio);
    const rKnockup = gameValue(ctx, SPELL_IDS.R, 'RStunDuration', rRank, FALLBACK.r.knockupSeconds);
    const rCd = cooldownValue(ctx.spellById[SPELL_IDS.R], rRank, [...FALLBACK.r.cooldown]);

    row('R', 'Base damage', rBase.value.toFixed(0), rBase);
    row('R', 'Bonus AD ratio', pct(rAd.value), rAd);
    row('R', 'Knock-up', `${num(rKnockup.value)} s`, rKnockup);
    row('R', 'Cooldown', `${num(rCd.value)} s`, rCd);

    /* ------------------------------------------------------------------ P */
    const pShield = calcRatio(ctx, SPELL_IDS.P, 'TotalShield', 1, 'maxHealth', 'total', FALLBACK.passive.maxHealthPercent);
    const pDuration = gameValue(ctx, SPELL_IDS.P, 'ShieldDuration', 1, FALLBACK.passive.durationSeconds);
    const pCooldownLow = calcValue(ctx, SPELL_IDS.P, 'ShieldCooldown', 1, { level: 1, value: () => 0 }, passiveCooldownFallback(1));
    const pCooldownHigh = calcValue(ctx, SPELL_IDS.P, 'ShieldCooldown', 1, { level: 18, value: () => 0 }, passiveCooldownFallback(18));

    const pRefund = gameValue(ctx, SPELL_IDS.P, 'CDReductionOn3Hit', 1, FALLBACK.passive.cooldownRefundOnProc);

    row('P', 'Shield', `${pct(pShield.value)} maximum health`, pShield);
    row('P', 'Shield duration', `${num(pDuration.value)} s`, pDuration);
    row('P', 'Reduction from Denting Blows', `${num(pRefund.value)} s`, pRefund);
    row(
      'P',
      'Cooldown',
      `${num(pCooldownLow.value)} s (level 1) → ${num(pCooldownHigh.value)} s (level 18)`,
      pCooldownLow,
      pCooldownHigh,
    );

    return rows;
  },
};

export { FALLBACK as VI_CONSTANTS };
