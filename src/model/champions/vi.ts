/**
 * Vi — die Sheriffin von Piltover.
 *
 * Base damage numbers and cooldowns are read from Data Dragon whenever the CDN
 * ships usable values; the constants below are the maintained fallback for
 * everything Data Dragon does not expose in machine-readable form (which, for
 * modern kits, means essentially every ratio — Riot moved those into tooltip
 * prose years ago).
 *
 * Every fallback is labelled `registry` in the UI's formula inspector, so it is
 * always visible which numbers came from Riot and which came from this file.
 * When a patch moves a ratio, this is the only file that needs touching.
 *
 * Last reviewed against patch 26.16.
 */

import type { ChampionRuntime, SimContext } from '../../engine/context';
import type { AbilitySlot } from '../../engine/types';
import {
  cooldownValue,
  effectValue,
  type AbilityMeta,
  type ChampionModule,
  type ChampionModuleContext,
} from './types';

const SPELL_IDS = {
  Q: 'ViQ',
  W: 'ViW',
  E: 'ViE',
  R: 'ViR',
} as const;

/** Maintained fallbacks. Only used where Data Dragon has nothing usable. */
const FALLBACK = {
  q: {
    minBase: [40, 60, 80, 100, 120],
    /** Riot stores this as MinDamage × MaxDamageMult (2.5), not as its own row. */
    maxBase: [100, 150, 200, 250, 300],
    /**
     * Bonus AD, not total. Every Vi ratio carries `mStatFormula: 2` in the game
     * data, and that value is demonstrably "bonus": Denting Blows uses it and
     * its own tooltip reads "per 100 bonus AD", and the ultimate's data value is
     * literally named `RBonusADRatio`. Excessive/Relentless Force omits the
     * field entirely — it is an empowered attack and scales off total AD.
     */
    minBonusAdRatio: 0.6,
    maxBonusAdRatio: 1.5,
    maxChargeSeconds: 1.25,
    cooldown: [12, 10.5, 9, 7.5, 6],
  },
  w: {
    /** Fraction of the target's maximum health, per rank. */
    maxHealthPercent: [0.04, 0.05, 0.06, 0.07, 0.08],
    /** Additional max-health percent per 100 bonus AD. */
    perHundredBonusAd: 0.035,
    /** Hard cap against minions and monsters. */
    monsterCap: 300,
    hitsToProc: 3,
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
    // Confirmed against Community Dragon's `ammo.ammoRechargeTime`.
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
     * Riot models this as a level breakpoint curve, not a straight line:
     * 16 s at level 1, −0.5 s per level, and the per-level bonus stops at
     * level 10 — so it sits at 11.5 s from level 10 onward.
     */
    cooldownAtLevel1: 16,
    cooldownPerLevel: -0.5,
    cooldownFloorLevel: 10,
    /** Denting Blows' third hit refunds this much of the shield's cooldown. */
    cooldownRefundOnDentingBlows: 4,
  },
} as const;

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
      `Abklingzeit ${FALLBACK.passive.cooldownAtLevel1} s auf Level 1, ${FALLBACK.passive.cooldownPerLevel} s pro Level, ab Level ${FALLBACK.passive.cooldownFloorLevel} konstant.`,
      `Der 3. Treffer von Beulenschlägen verkürzt die Restabklingzeit um ${FALLBACK.passive.cooldownRefundOnDentingBlows} s.`,
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
      `Schleudert das Ziel ${FALLBACK.r.knockupSeconds} s in die Luft.`,
      'Wendet keine Treffereffekte an.',
      'Löst das Explosionsschild aus.',
    ],
  },
];

function pct(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10} %`;
}

/** Blast Shield's cooldown: −0.5 s per level, stopping at the floor level. */
function passiveCooldown(level: number): number {
  const { cooldownAtLevel1, cooldownPerLevel, cooldownFloorLevel } = FALLBACK.passive;
  const effective = Math.min(cooldownFloorLevel, Math.max(1, level));
  return cooldownAtLevel1 + cooldownPerLevel * (effective - 1);
}

class ViRuntime implements ChampionRuntime {
  /** Consecutive basic attacks landed on the current target. */
  private attackCount = 0;
  /** Whether the next basic attack is empowered by E. */
  private empowered = false;
  private eChargesUsed = 0;
  /** Time at which Blast Shield may proc again. */
  private passiveReadyAt = 0;

  constructor(private readonly ctx: ChampionModuleContext) {}

  private spell(slot: 'Q' | 'W' | 'E' | 'R') {
    return this.ctx.spellById[SPELL_IDS[slot]];
  }

  resetsAutoAttack(slot: AbilitySlot): boolean {
    return slot === 'E';
  }

  castDuration(slot: AbilitySlot, ctx: SimContext, options: { chargeSeconds: number }): number {
    switch (slot) {
      case 'Q':
        return (
          Math.min(options.chargeSeconds, FALLBACK.q.maxChargeSeconds) + ctx.timings.dashTravel
        );
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

  private castQ(ctx: SimContext, chargeSeconds: number): void {
    const rank = ctx.rank('Q');
    if (rank < 1) {
      ctx.warn('Tresorknacker ist nicht gelernt — Schritt ignoriert.');
      return;
    }

    const charge = Math.min(Math.max(0, chargeSeconds), FALLBACK.q.maxChargeSeconds);
    const ratio = charge / FALLBACK.q.maxChargeSeconds;

    const minBase = effectValue(this.spell('Q'), 1, rank, [...FALLBACK.q.minBase]);
    const maxBase = effectValue(this.spell('Q'), 2, rank, [...FALLBACK.q.maxBase]);

    const base = minBase.value + (maxBase.value - minBase.value) * ratio;
    const adRatio =
      FALLBACK.q.minBonusAdRatio +
      (FALLBACK.q.maxBonusAdRatio - FALLBACK.q.minBonusAdRatio) * ratio;

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
        `Ladung ${(ratio * 100).toFixed(0)} % (${charge.toFixed(2)} s)`,
        `${base.toFixed(0)} Basis + ${(adRatio * 100).toFixed(0)} % Bonus-AD`,
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
    if (this.eChargesUsed >= FALLBACK.e.charges) {
      ctx.warn(
        `Übermäßige Gewalt hat nur ${FALLBACK.e.charges} Aufladungen — weitere Anwendungen in dieser Combo sind nicht verfügbar.`,
      );
      return;
    }
    this.eChargesUsed += 1;
    this.empowered = true;
    ctx.addEvent({
      kind: 'buff',
      label: 'Übermäßige Gewalt bereit',
      detail: `Nächster Basisangriff verstärkt · Aufladung ${this.eChargesUsed}/${FALLBACK.e.charges}`,
    });
  }

  private castR(ctx: SimContext): void {
    const rank = ctx.rank('R');
    if (rank < 1) {
      ctx.warn('Einstellungsverfügung ist nicht gelernt — Schritt ignoriert.');
      return;
    }

    const base = effectValue(this.spell('R'), 1, rank, [...FALLBACK.r.base]);
    const amount = base.value + FALLBACK.r.bonusAdRatio * ctx.stats.bonusAttackDamage;

    ctx.dealDamage({
      sourceId: 'R',
      sourceLabel: 'Einstellungsverfügung (R)',
      sourceKind: 'ability',
      slot: 'R',
      type: 'physical',
      amount,
      isAbilityDamage: true,
      notes: [`${base.value.toFixed(0)} Basis + ${pct(FALLBACK.r.bonusAdRatio)} Bonus-AD`],
    });

    ctx.addEvent({
      kind: 'info',
      label: 'Luftstoß',
      detail: `Ziel für ${FALLBACK.r.knockupSeconds} s außer Gefecht`,
    });

    this.tryPassive(ctx);
  }

  modifyBasicAttack(ctx: SimContext) {
    if (!this.empowered) return null;
    const rank = ctx.rank('E');
    if (rank < 1) return null;

    const base = effectValue(this.spell('E'), 1, rank, [...FALLBACK.e.base]);
    const total =
      base.value +
      FALLBACK.e.totalAdRatio * ctx.stats.totalAttackDamage +
      FALLBACK.e.apRatio * ctx.stats.abilityPower;

    // Single-use empowerment: consumed by the attack it modifies.
    this.empowered = false;

    // E replaces the attack's damage rather than adding to it.
    return {
      replacementDamage: total,
      label: 'Übermäßige Gewalt (E)',
      slot: 'E' as AbilitySlot,
      notes: [
        `${base.value.toFixed(0)} Basis + ${pct(FALLBACK.e.totalAdRatio)} Gesamt-AD` +
          (ctx.stats.abilityPower > 0 ? ` + ${pct(FALLBACK.e.apRatio)} AP` : ''),
      ],
    };
  }

  onBasicAttackHit(ctx: SimContext): void {
    this.attackCount += 1;
    const rank = ctx.rank('W');
    if (rank < 1) return;

    if (this.attackCount % FALLBACK.w.hitsToProc !== 0) {
      ctx.addEvent({
        kind: 'info',
        label: 'Beulenschläge',
        detail: `${this.attackCount % FALLBACK.w.hitsToProc}/${FALLBACK.w.hitsToProc} Treffer`,
      });
      return;
    }

    const percentPerRank =
      FALLBACK.w.maxHealthPercent[Math.min(rank, FALLBACK.w.maxHealthPercent.length) - 1] ?? 0;
    const fromAd = (FALLBACK.w.perHundredBonusAd * ctx.stats.bonusAttackDamage) / 100;
    const percent = percentPerRank + fromAd;

    let amount = ctx.targetMaxHealth * percent;
    const notes = [
      `${pct(percentPerRank)} + ${pct(fromAd)} aus ${ctx.stats.bonusAttackDamage.toFixed(0)} Bonus-AD`,
      `= ${pct(percent)} des maximalen Lebens`,
    ];

    if (ctx.target.unitType !== 'champion' && amount > FALLBACK.w.monsterCap) {
      amount = FALLBACK.w.monsterCap;
      notes.push(`auf ${FALLBACK.w.monsterCap} begrenzt (Vasall/Monster)`);
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

    ctx.applyArmorShred({
      percent: FALLBACK.w.armorShredPercent,
      durationSeconds: FALLBACK.w.shredDurationSeconds,
      label: 'Beulenschläge',
    });

    const asBonus = FALLBACK.w.attackSpeedBonus[Math.min(rank, 5) - 1] ?? 0;
    ctx.applyTemporaryStats({
      stats: { attackSpeed: asBonus },
      durationSeconds: FALLBACK.w.attackSpeedDurationSeconds,
      label: `Beulenschläge · +${pct(asBonus)} Angriffstempo`,
    });

    // The third hit also refunds part of Blast Shield's remaining cooldown,
    // which is what lets Vi re-shield inside a single extended fight.
    const refund = FALLBACK.passive.cooldownRefundOnDentingBlows;
    if (this.passiveReadyAt > ctx.time) {
      this.passiveReadyAt = Math.max(ctx.time, this.passiveReadyAt - refund);
      ctx.addEvent({
        kind: 'buff',
        label: 'Explosionsschild',
        detail: `Abklingzeit um ${refund} s verkürzt`,
      });
    }
  }

  /** Blast Shield: any ability damage, on its own cooldown. */
  private tryPassive(ctx: SimContext): void {
    if (ctx.time < this.passiveReadyAt) return;
    const amount = ctx.stats.maxHealth * FALLBACK.passive.maxHealthPercent;
    ctx.grantShield({
      amount,
      durationSeconds: FALLBACK.passive.durationSeconds,
      label: 'Explosionsschild (P)',
    });
    this.passiveReadyAt = ctx.time + passiveCooldown(ctx.stats.level);
  }
}

export const VI_MODULE: ChampionModule = {
  championId: 'Vi',
  displayName: 'Vi',
  abilities: ABILITIES,
  createRuntime: (ctx) => new ViRuntime(ctx),
  describeValues(ctx, ranks) {
    const rows: ReturnType<ChampionModule['describeValues']> = [];
    const spell = (slot: 'Q' | 'W' | 'E' | 'R') => ctx.spellById[SPELL_IDS[slot]];

    const qRank = Math.max(1, ranks.Q);
    const qMin = effectValue(spell('Q'), 1, qRank, [...FALLBACK.q.minBase]);
    const qMax = effectValue(spell('Q'), 2, qRank, [...FALLBACK.q.maxBase]);
    const qCd = cooldownValue(spell('Q'), qRank, [...FALLBACK.q.cooldown]);
    rows.push(
      {
        slot: 'Q',
        label: 'Basisschaden (ungeladen)',
        value: qMin.value.toFixed(0),
        source: qMin.source,
        note: qMin.note,
      },
      {
        slot: 'Q',
        label: 'Basisschaden (voll geladen)',
        value: qMax.value.toFixed(0),
        source: qMax.source,
        note: qMax.note,
      },
      {
        slot: 'Q',
        label: 'Bonus-AD-Verhältnis',
        value: `${pct(FALLBACK.q.minBonusAdRatio)} → ${pct(FALLBACK.q.maxBonusAdRatio)}`,
        source: 'registry',
      },
      { slot: 'Q', label: 'Abklingzeit', value: `${qCd.value} s`, source: qCd.source, note: qCd.note },
    );

    const wRank = Math.max(1, ranks.W);
    rows.push(
      {
        slot: 'W',
        label: 'Max-Leben-Schaden',
        value: pct(FALLBACK.w.maxHealthPercent[Math.min(wRank, 5) - 1] ?? 0),
        source: 'registry',
      },
      {
        slot: 'W',
        label: 'pro 100 Bonus-AD',
        value: pct(FALLBACK.w.perHundredBonusAd),
        source: 'registry',
      },
      {
        slot: 'W',
        label: 'Rüstungsreduktion',
        value: `${pct(FALLBACK.w.armorShredPercent)} für ${FALLBACK.w.shredDurationSeconds} s`,
        source: 'registry',
      },
      {
        slot: 'W',
        label: 'Angriffstempo',
        value: `+${pct(FALLBACK.w.attackSpeedBonus[Math.min(wRank, 5) - 1] ?? 0)}`,
        source: 'registry',
      },
    );

    const eRank = Math.max(1, ranks.E);
    const eBase = effectValue(spell('E'), 1, eRank, [...FALLBACK.e.base]);
    rows.push(
      {
        slot: 'E',
        label: 'Basisschaden',
        value: eBase.value.toFixed(0),
        source: eBase.source,
        note: eBase.note,
      },
      {
        slot: 'E',
        label: 'Gesamt-AD-Verhältnis',
        value: pct(FALLBACK.e.totalAdRatio),
        source: 'registry',
      },
      { slot: 'E', label: 'AP-Verhältnis', value: pct(FALLBACK.e.apRatio), source: 'registry' },
    );

    const rRank = Math.max(1, ranks.R);
    const rBase = effectValue(spell('R'), 1, rRank, [...FALLBACK.r.base]);
    const rCd = cooldownValue(spell('R'), rRank, [...FALLBACK.r.cooldown]);
    rows.push(
      {
        slot: 'R',
        label: 'Basisschaden',
        value: rBase.value.toFixed(0),
        source: rBase.source,
        note: rBase.note,
      },
      {
        slot: 'R',
        label: 'Bonus-AD-Verhältnis',
        value: pct(FALLBACK.r.bonusAdRatio),
        source: 'registry',
      },
      { slot: 'R', label: 'Abklingzeit', value: `${rCd.value} s`, source: rCd.source, note: rCd.note },
    );

    rows.push({
      slot: 'P',
      label: 'Schild',
      value: `${pct(FALLBACK.passive.maxHealthPercent)} max. Leben, ${FALLBACK.passive.durationSeconds} s`,
      source: 'registry',
    });

    return rows;
  },
};

export { FALLBACK as VI_CONSTANTS };
