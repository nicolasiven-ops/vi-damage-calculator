/**
 * Vi — die Sheriffin von Piltover.
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

import type { ChampionRuntime, SimContext } from '../../engine/context';
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
     * from level 9 on. The game data expresses this as a breakpoint curve.
     */
    cooldownAtLevel1: 16,
    cooldownPerLevel: -0.5,
    cooldownFloor: 12,
  },
} as const;

/* ------------------------------------------------------------------- helpers */

function pct(fraction: number): string {
  return `${num(fraction * 100)} %`;
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
    name: 'Explosionsschild',
    maxRank: 1,
    castable: false,
    modelNotes: [
      `Schild über ${pct(FALLBACK.passive.maxHealthPercent)} von Vis maximalem Leben für ${FALLBACK.passive.durationSeconds} s.`,
      'Löst aus, sobald eine Fähigkeit einen Gegner trifft — Basisangriffe zählen nicht.',
      'Abklingzeit sinkt mit dem Championlevel und wird aus Riots Levelkurve gelesen.',
    ],
  },
  {
    slot: 'Q',
    ddragonId: SPELL_IDS.Q,
    name: 'Tresorknacker',
    maxRank: 5,
    castable: true,
    chargeable: { maxSeconds: FALLBACK.q.maxChargeSeconds },
    modelNotes: [
      'Schaden skaliert linear mit der Ladezeit zwischen Minimum und Maximum.',
      'Skaliert mit Bonus-Angriffsschaden, nicht mit Gesamt-AD.',
      'Wendet keine Treffereffekte an.',
      'Löst das Explosionsschild aus.',
    ],
  },
  {
    slot: 'W',
    ddragonId: SPELL_IDS.W,
    name: 'Beulenschläge',
    maxRank: 5,
    castable: false,
    modelNotes: [
      `Jeder ${FALLBACK.w.hitsToProc}. Basisangriff auf dasselbe Ziel löst aus.`,
      `Die Zähler verfallen, wenn zwischen zwei Treffern mehr als ${FALLBACK.w.markerSeconds} s liegen.`,
      'Zusatzschaden in % des maximalen Lebens des Ziels, skaliert mit Bonus-AD.',
      `Reduziert die Rüstung des Ziels um ${pct(FALLBACK.w.armorShredPercent)} für ${FALLBACK.w.shredDurationSeconds} s.`,
      `Gewährt Vi Angriffstempo für ${FALLBACK.w.attackSpeedDurationSeconds} s.`,
      `Gegen Vasallen und Monster auf ${FALLBACK.w.monsterCap} Schaden begrenzt.`,
    ],
  },
  {
    slot: 'E',
    ddragonId: SPELL_IDS.E,
    name: 'Übermäßige Gewalt',
    maxRank: 5,
    castable: true,
    modelNotes: [
      'Ersetzt den Schaden des nächsten Basisangriffs — der reguläre AA-Schaden kommt nicht zusätzlich dazu.',
      'Setzt den Angriffstimer zurück und wendet Treffereffekte an.',
      'Skaliert mit Gesamt-AD, weil der Angriffsschaden darin enthalten ist.',
      `${FALLBACK.e.charges} Aufladungen.`,
      'Zählt für Beulenschläge als Basisangriff.',
    ],
  },
  {
    slot: 'R',
    ddragonId: SPELL_IDS.R,
    name: 'Einstellungsverfügung',
    maxRank: 3,
    castable: true,
    modelNotes: [
      'Skaliert mit Bonus-Angriffsschaden, nicht mit Gesamt-AD.',
      'Schleudert das Ziel in die Luft.',
      'Wendet keine Treffereffekte an.',
      'Löst das Explosionsschild aus.',
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
  private eChargesUsed = 0;
  /** Time at which Blast Shield may proc again. */
  private passiveReadyAt = 0;

  constructor(private readonly ctx: ChampionModuleContext) {}

  resetsAutoAttack(slot: AbilitySlot): boolean {
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

  castDuration(slot: AbilitySlot, ctx: SimContext, options: { chargeSeconds: number }): number {
    switch (slot) {
      case 'Q':
        return Math.min(options.chargeSeconds, this.chargeWindow(ctx)) + ctx.timings.dashTravel;
      case 'R':
        return ctx.timings.dashTravel;
      case 'E':
        // Casting E only buffs the next attack; it costs an input frame.
        return ctx.timings.inputDelay;
      default:
        return ctx.timings.inputDelay;
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
        ctx.warn('Beulenschläge ist passiv und kann nicht gewirkt werden — Schritt ignoriert.');
        break;
      case 'P':
        ctx.warn('Explosionsschild ist passiv und kann nicht gewirkt werden — Schritt ignoriert.');
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
      ctx.warn('Tresorknacker ist nicht gelernt — Schritt ignoriert.');
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
      sourceLabel: 'Tresorknacker (Q)',
      sourceKind: 'ability',
      slot: 'Q',
      type: 'physical',
      amount,
      isAbilityDamage: true,
      notes: [
        `Ladung ${(ratio * 100).toFixed(0)} % (${charge.toFixed(2)} s von ${num(window)} s)`,
        `${base.toFixed(0)} Basis + ${pct(adRatio)} Bonus-AD`,
      ],
    });

    this.tryPassive(ctx);
  }

  private castE(ctx: SimContext): void {
    const rank = ctx.rank('E');
    if (rank < 1) {
      ctx.warn('Übermäßige Gewalt ist nicht gelernt — Schritt ignoriert.');
      return;
    }

    const charges = spellTiming(this.ctx, SPELL_IDS.E, 'maxAmmo', rank, FALLBACK.e.charges).value;
    if (this.eChargesUsed >= charges) {
      ctx.warn(
        `Übermäßige Gewalt hat nur ${charges} Aufladungen — weitere Anwendungen in dieser Combo sind nicht verfügbar.`,
      );
      return;
    }

    this.eChargesUsed += 1;
    this.empowered = true;
    ctx.addEvent({
      kind: 'buff',
      label: 'Übermäßige Gewalt bereit',
      detail: `Nächster Basisangriff verstärkt · Aufladung ${this.eChargesUsed}/${charges}`,
    });
  }

  private castR(ctx: SimContext): void {
    const rank = ctx.rank('R');
    if (rank < 1) {
      ctx.warn('Einstellungsverfügung ist nicht gelernt — Schritt ignoriert.');
      return;
    }

    const base = calcBase(this.ctx, SPELL_IDS.R, 'Damage', rank, atRank(FALLBACK.r.base, rank));
    const adRatio = calcRatio(this.ctx, SPELL_IDS.R, 'Damage', rank, 'ad', 'bonus', FALLBACK.r.bonusAdRatio);
    const knockup = gameValue(this.ctx, SPELL_IDS.R, 'RStunDuration', rank, FALLBACK.r.knockupSeconds);

    ctx.dealDamage({
      sourceId: 'R',
      sourceLabel: 'Einstellungsverfügung (R)',
      sourceKind: 'ability',
      slot: 'R',
      type: 'physical',
      amount: base.value + adRatio.value * ctx.stats.bonusAttackDamage,
      isAbilityDamage: true,
      notes: [`${base.value.toFixed(0)} Basis + ${pct(adRatio.value)} Bonus-AD`],
    });

    ctx.addEvent({
      kind: 'info',
      label: 'Luftstoß',
      detail: `Ziel für ${num(knockup.value)} s außer Gefecht`,
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
      label: 'Übermäßige Gewalt (E)',
      slot: 'E' as AbilitySlot,
      notes: [
        `${base.value.toFixed(0)} Basis + ${pct(adRatio.value)} Gesamt-AD` +
          (ctx.stats.abilityPower > 0 ? ` + ${pct(apRatio.value)} AP` : ''),
      ],
    };
  }

  /**
   * Denting Blows counts hits on the same target. The counter is a buff on the
   * target with its own duration, so a combo slow enough to let it lapse starts
   * over — the same way it does in the client.
   */
  onBasicAttackHit(ctx: SimContext): void {
    const rank = ctx.rank('W');
    if (rank < 1) return;

    const markerSeconds = gameValue(this.ctx, SPELL_IDS.W, 'MarkerBuffDuration', rank, FALLBACK.w.markerSeconds).value;
    const stacksBefore = gameValue(this.ctx, SPELL_IDS.W, 'StacksBeforeEffect', rank, FALLBACK.w.hitsToProc - 1).value;
    const hitsToProc = stacksBefore + 1;

    if (ctx.time > this.stacksExpireAt) {
      this.attackCount = 0;
      ctx.addEvent({
        kind: 'info',
        label: 'Beulenschläge',
        detail: `Zähler abgelaufen (${num(markerSeconds)} s ohne Treffer)`,
      });
    }

    this.attackCount += 1;
    this.stacksExpireAt = ctx.time + markerSeconds;

    if (this.attackCount % hitsToProc !== 0) {
      ctx.addEvent({
        kind: 'info',
        label: 'Beulenschläge',
        detail: `${this.attackCount % hitsToProc}/${hitsToProc} Treffer`,
      });
      return;
    }

    const flat = calcBase(this.ctx, SPELL_IDS.W, 'TotalDamageTooltip', rank, atRank(FALLBACK.w.maxHealthPercent, rank));
    const perAd = calcRatio(this.ctx, SPELL_IDS.W, 'TotalDamageTooltip', rank, 'ad', 'bonus', FALLBACK.w.perBonusAd);
    const fromAd = perAd.value * ctx.stats.bonusAttackDamage;
    const percent = flat.value + fromAd;

    let amount = ctx.targetMaxHealth * percent;
    const notes = [
      `${pct(flat.value)} + ${pct(fromAd)} aus ${ctx.stats.bonusAttackDamage.toFixed(0)} Bonus-AD`,
      `= ${pct(percent)} des maximalen Lebens`,
    ];

    const cap = gameValue(this.ctx, SPELL_IDS.W, 'MonsterDamageCap', rank, FALLBACK.w.monsterCap).value;
    if (ctx.target.unitType !== 'champion' && amount > cap) {
      amount = cap;
      notes.push(`auf ${cap} begrenzt (Vasall/Monster)`);
    }

    ctx.dealDamage({
      sourceId: 'W',
      sourceLabel: 'Beulenschläge (W)',
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
      label: 'Beulenschläge',
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
      label: `Beulenschläge · +${num(attackSpeed)} % Angriffstempo`,
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
      label: 'Explosionsschild (P)',
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

    row('Q', 'Basisschaden (ungeladen)', qMin.value.toFixed(0), qMin);
    row('Q', 'Basisschaden (voll geladen)', qMax.value.toFixed(0), qMax);
    row('Q', 'Bonus-AD-Verhältnis', `${pct(qMinRatio.value)} → ${pct(qMaxRatio.value)}`, qMinRatio, qMaxRatio);
    row('Q', 'Ladezeit bis Maximum', `${num(qCharge.value)} s`, qCharge);
    row('Q', 'Abklingzeit', `${num(qCd.value)} s`, qCd);

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

    row('W', 'Max-Leben-Schaden', pct(wFlat.value), wFlat);
    row('W', 'pro 100 Bonus-AD', pct(wPerAd.value * 100), wPerAd);
    row('W', 'Rüstungsreduktion', `${num(wShred.value)} % für ${num(wBuff.value)} s`, wShred, wBuff);
    row('W', 'Angriffstempo', `+${num(wAs.value)} % für ${num(wBuff.value)} s`, wAs, wBuff);
    row('W', 'Treffer bis Auslösung', `${wStacks.value + 1} · Zähler hält ${num(wMarker.value)} s`, wStacks, wMarker);
    row('W', 'Kappe gegen Vasallen/Monster', wCap.value.toFixed(0), wCap);

    /* ------------------------------------------------------------------ E */
    const eRank = Math.max(1, ranks.E);
    const eBase = calcBase(ctx, SPELL_IDS.E, 'TotalDamageTooltip', eRank, atRank(FALLBACK.e.base, eRank));
    const eAd = calcRatio(ctx, SPELL_IDS.E, 'TotalDamageTooltip', eRank, 'ad', 'total', FALLBACK.e.totalAdRatio);
    const eAp = calcRatio(ctx, SPELL_IDS.E, 'TotalDamageTooltip', eRank, 'ap', 'total', FALLBACK.e.apRatio);
    const eCharges = spellTiming(ctx, SPELL_IDS.E, 'maxAmmo', eRank, FALLBACK.e.charges);
    const eRecharge = spellTiming(ctx, SPELL_IDS.E, 'ammoRechargeTime', eRank, atRank(FALLBACK.e.rechargeSeconds, eRank));

    row('E', 'Basisschaden', eBase.value.toFixed(0), eBase);
    row('E', 'Gesamt-AD-Verhältnis', pct(eAd.value), eAd);
    row('E', 'AP-Verhältnis', pct(eAp.value), eAp);
    row('E', 'Aufladungen', eCharges.value.toFixed(0), eCharges);
    row('E', 'Aufladezeit', `${num(eRecharge.value)} s`, eRecharge);

    /* ------------------------------------------------------------------ R */
    const rRank = Math.max(1, ranks.R);
    const rBase = calcBase(ctx, SPELL_IDS.R, 'Damage', rRank, atRank(FALLBACK.r.base, rRank));
    const rAd = calcRatio(ctx, SPELL_IDS.R, 'Damage', rRank, 'ad', 'bonus', FALLBACK.r.bonusAdRatio);
    const rKnockup = gameValue(ctx, SPELL_IDS.R, 'RStunDuration', rRank, FALLBACK.r.knockupSeconds);
    const rCd = cooldownValue(ctx.spellById[SPELL_IDS.R], rRank, [...FALLBACK.r.cooldown]);

    row('R', 'Basisschaden', rBase.value.toFixed(0), rBase);
    row('R', 'Bonus-AD-Verhältnis', pct(rAd.value), rAd);
    row('R', 'Luftstoß', `${num(rKnockup.value)} s`, rKnockup);
    row('R', 'Abklingzeit', `${num(rCd.value)} s`, rCd);

    /* ------------------------------------------------------------------ P */
    const pShield = calcRatio(ctx, SPELL_IDS.P, 'TotalShield', 1, 'maxHealth', 'total', FALLBACK.passive.maxHealthPercent);
    const pDuration = gameValue(ctx, SPELL_IDS.P, 'ShieldDuration', 1, FALLBACK.passive.durationSeconds);
    const pCooldownLow = calcValue(ctx, SPELL_IDS.P, 'ShieldCooldown', 1, { level: 1, value: () => 0 }, passiveCooldownFallback(1));
    const pCooldownHigh = calcValue(ctx, SPELL_IDS.P, 'ShieldCooldown', 1, { level: 18, value: () => 0 }, passiveCooldownFallback(18));

    row('P', 'Schild', `${pct(pShield.value)} max. Leben`, pShield);
    row('P', 'Schilddauer', `${num(pDuration.value)} s`, pDuration);
    row(
      'P',
      'Abklingzeit',
      `${num(pCooldownLow.value)} s (Level 1) → ${num(pCooldownHigh.value)} s (Level 18)`,
      pCooldownLow,
      pCooldownHigh,
    );

    return rows;
  },
};

export { FALLBACK as VI_CONSTANTS };
