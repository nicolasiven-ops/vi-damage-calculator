/**
 * Rune registry.
 *
 * Data Dragon's `runesReforged.json` gives ids, names, icons and prose. It does
 * not give a single number in machine-readable form, so every rune that
 * actually affects damage is modelled here by hand.
 *
 * Runes not listed below still appear in the picker (the tree layout comes
 * straight from Data Dragon) but are marked as *not modelled*, and the analysis
 * says so out loud. A rune that silently does nothing would be the worst of
 * both worlds.
 *
 * Last reviewed against patch 26.16.
 */

import type { ChampionStats, StatBlock } from './stats';
import type { DamageType } from '../engine/types';
import type { SimContext } from '../engine/context';

export interface RuneStatContext {
  level: number;
  /** Stats before rune contributions, used for adaptive decisions. */
  baseline: ChampionStats;
}

export interface HitInfo {
  sourceId: string;
  sourceKind: string;
  type: DamageType;
  isAbilityDamage: boolean;
  triggersOnHit: boolean;
  mitigated: number;
  targetHealthPercentAfter: number;
}

export interface RuneRuntime {
  /**
   * Called before a basic attack winds up.
   *
   * This is the only place a rune can put a buff in place in time to affect
   * the attack that triggered it — which is what an attack-speed keystone is
   * for. Reacting to the hit instead would always be one attack late.
   */
  onBeforeAttack?(ctx: SimContext): void;
  /** Called after every damage instance the attacker deals. */
  onHitLanded?(ctx: SimContext, hit: HitInfo): void;
  /**
   * Called when an ability resets the attack timer.
   *
   * Hail of Blades grants an extra attack for each reset, which for Vi means
   * her E genuinely extends the keystone.
   */
  onAttackReset?(ctx: SimContext): void;
}

export interface RuneDefinition {
  id: number;
  /** Short name, used when Data Dragon is unavailable. */
  name: string;
  /** False when the rune has no effect this calculator can represent. */
  modelled: boolean;
  /** Explains what exactly is modelled, or why nothing is. */
  note: string;
  stats?(ctx: RuneStatContext): Partial<StatBlock>;
  /**
   * Damage amplification applied to every hit, as a fraction.
   * Evaluated per hit so it can depend on target health.
   */
  amplify?(ctx: SimContext, hit: Omit<HitInfo, 'mitigated' | 'targetHealthPercentAfter'>): number;
  createRuntime?(): RuneRuntime;
}

/** Linear interpolation between the level-1 and level-18 value. */
function byLevel(atLevel1: number, atLevel18: number, level: number): number {
  const t = (Math.min(18, Math.max(1, level)) - 1) / 17;
  return atLevel1 + (atLevel18 - atLevel1) * t;
}

/**
 * Adaptive damage follows adaptive force: AD unless bonus AP strictly exceeds
 * the AD contribution. For an AD champion like Vi this is always physical.
 */
function adaptiveType(stats: ChampionStats): DamageType {
  return stats.abilityPower > stats.bonusAttackDamage * 2 ? 'magic' : 'physical';
}

function adaptiveAmount(stats: ChampionStats, base: number, adRatio: number, apRatio: number): number {
  return base + adRatio * stats.bonusAttackDamage + apRatio * stats.abilityPower;
}

/* ------------------------------------------------------------------ keystones */

const ELECTROCUTE: RuneDefinition = {
  id: 8112,
  name: 'Strom-Schock',
  modelled: true,
  note: '3 getrennte Angriffe oder Fähigkeiten auf denselben Champion innerhalb von 3 s.',
  createRuntime() {
    let hits = 0;
    let firstHitAt = -Infinity;
    let readyAt = 0;
    let procced = false;
    return {
      onHitLanded(ctx, hit) {
        if (procced || ctx.time < readyAt) return;
        if (hit.mitigated <= 0) return;
        // Damage-over-time and multi-hit instances from the same cast should
        // not each count; only distinct attacks/abilities do.
        if (ctx.time - firstHitAt > 3) {
          hits = 0;
          firstHitAt = ctx.time;
        }
        hits += 1;
        if (hits < 3) return;

        const amount = adaptiveAmount(ctx.stats, byLevel(30, 180, ctx.stats.level), 0.4, 0.25);
        ctx.dealDamage({
          sourceId: 'rune:8112',
          sourceLabel: 'Strom-Schock',
          sourceKind: 'rune',
          type: adaptiveType(ctx.stats),
          amount,
          notes: ['3 Treffer innerhalb von 3 s'],
        });
        procced = true;
        readyAt = ctx.time + byLevel(25, 20, ctx.stats.level);
      },
    };
  },
};

/**
 * Sturm der Klingen.
 *
 * Numbers from Data Dragon's own rune text for the patch: 90 % attack speed for
 * melee champions (60 % ranged), up to three attacks, no more than 3 s between
 * them, 10 s cooldown, and 2–20 (+12 % bonus AD, +10 % AP) true damage on each
 * of those attacks.
 *
 * Two rules from the same text carry real weight for Vi and are modelled:
 *
 *  - "Attack resets increase the attack limit by 1." Her E is an attack reset,
 *    so an E inside the window buys a fourth empowered attack.
 *  - "Allows you to temporarily exceed the Attack Speed limit." The bonus is
 *    therefore booked over the 2.5 cap rather than into it.
 *
 * The buff ends on the third attack, not on a timer, so it is applied with the
 * 3 s window as its duration and cleared explicitly once the attacks are spent.
 */
const HAIL_OF_BLADES: RuneDefinition = {
  id: 9923,
  name: 'Sturm der Klingen',
  modelled: true,
  note:
    '90 % Angriffstempo (Nahkampf) für 3 Angriffe gegen Champions, ' +
    'plus 1 Angriff je Angriffstimer-Reset — Vis E zählt dazu. ' +
    'Wahrer Zusatzschaden auf jeden dieser Angriffe. Das Angriffstempo darf die Kappe von 2,5 überschreiten. ' +
    'Die Abklingzeit von 10 s wird ab der Aktivierung gerechnet.',
  createRuntime() {
    const LABEL = 'Sturm der Klingen';
    /** Melee value; the rune grants 60 % to ranged champions. */
    const ATTACK_SPEED = 0.9;
    const ATTACKS = 3;
    const WINDOW_SECONDS = 3;
    const COOLDOWN_SECONDS = 10;

    let attacksLeft = 0;
    let spent = 0;
    let active = false;
    let readyAt = 0;
    let lastAttackAt = -Infinity;
    /** Set between an attack starting and its own damage landing. */
    let pendingHit = false;

    return {
      onBeforeAttack(ctx) {
        // The keystone only triggers on champions.
        if (ctx.target.unitType !== 'champion') return;

        // The window is a property of the effect, not just of the stat buff:
        // once it lapses the remaining attacks are gone, and the keystone has
        // to come off cooldown before it empowers anything again.
        if (active && ctx.time - lastAttackAt > WINDOW_SECONDS) {
          active = false;
          ctx.clearTemporaryStats(LABEL);
        }

        if (!active) {
          if (ctx.time < readyAt) return;
          active = true;
          attacksLeft = ATTACKS;
          spent = 0;
          readyAt = ctx.time + COOLDOWN_SECONDS;
        }

        pendingHit = true;
        lastAttackAt = ctx.time;
        // Re-applying refreshes the window, which is what ends the effect when
        // attacks are spaced too far apart.
        ctx.applyTemporaryStats({
          stats: { attackSpeedOverCap: ATTACK_SPEED },
          durationSeconds: WINDOW_SECONDS,
          label: LABEL,
        });
      },

      onHitLanded(ctx, hit) {
        // Only the attack's own instance counts — not the on-hit riders that
        // follow it, and not the champion's own procs.
        if (!active || !pendingHit) return;
        if (!hit.triggersOnHit) return;
        pendingHit = false;
        spent += 1;

        ctx.dealDamage({
          sourceId: 'rune:9923',
          sourceLabel: LABEL,
          sourceKind: 'rune',
          type: 'true',
          amount: byLevel(2, 20, ctx.stats.level) + 0.12 * ctx.stats.bonusAttackDamage + 0.1 * ctx.stats.abilityPower,
          // Counted against the limit as it stands: attack resets raise it, so
          // "3 von 4" is a legitimate reading of an extended window.
          notes: [`Angriff ${spent} von ${spent + attacksLeft - 1}`],
        });

        attacksLeft -= 1;
        if (attacksLeft > 0) return;
        active = false;
        ctx.clearTemporaryStats(LABEL);
      },

      onAttackReset(ctx) {
        if (!active) return;
        attacksLeft += 1;
        ctx.addEvent({
          kind: 'buff',
          label: LABEL,
          detail: `Angriffstimer zurückgesetzt · ${attacksLeft} Angriffe übrig`,
        });
      },
    };
  },
};

const DARK_HARVEST: RuneDefinition = {
  id: 8128,
  name: 'Dunkle Ernte',
  modelled: true,
  note: 'Löst aus, sobald das Ziel unter 50 % Leben fällt. Seelen werden über der Combo nicht gesammelt — Startwert konfigurierbar über die Seelenanzahl.',
  createRuntime() {
    let readyAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (ctx.time < readyAt) return;
        if (hit.targetHealthPercentAfter > 0.5 || hit.targetHealthPercentAfter <= 0) return;
        const amount = adaptiveAmount(ctx.stats, 20, 0.25, 0.15);
        ctx.dealDamage({
          sourceId: 'rune:8128',
          sourceLabel: 'Dunkle Ernte',
          sourceKind: 'rune',
          type: adaptiveType(ctx.stats),
          amount,
          notes: ['Ziel unter 50 % Leben', 'ohne gesammelte Seelen gerechnet'],
        });
        readyAt = ctx.time + 40;
      },
    };
  },
};

const PRESS_THE_ATTACK: RuneDefinition = {
  id: 8005,
  name: 'Zum Angriff',
  modelled: true,
  note: '3 aufeinanderfolgende Basisangriffe auf denselben Champion; danach 8 % erhöhter Schaden aus allen Quellen für 6 s.',
  createRuntime() {
    let attacks = 0;
    let procced = false;
    let ampUntil = 0;
    return {
      onHitLanded(ctx, hit) {
        if (ctx.time < ampUntil) return;
        if (!hit.triggersOnHit) return;
        if (procced) return;
        attacks += 1;
        if (attacks < 3) return;
        ctx.dealDamage({
          sourceId: 'rune:8005',
          sourceLabel: 'Zum Angriff',
          sourceKind: 'rune',
          type: adaptiveType(ctx.stats),
          amount: byLevel(40, 180, ctx.stats.level),
          notes: ['3. aufeinanderfolgender Basisangriff'],
        });
        procced = true;
        ampUntil = ctx.time + 6;
        ctx.applyTargetAmplification({
          percent: 0.08,
          durationSeconds: 6,
          label: 'Zum Angriff · Ziel erleidet +8 % Schaden',
        });
      },
    };
  },
};

const CONQUEROR: RuneDefinition = {
  id: 8010,
  name: 'Eroberer',
  modelled: true,
  note: 'Nahkämpfer erhalten 2 Stapel pro Treffer, bis zu 12. Stapel werden über die Combo aufgebaut.',
  createRuntime() {
    let stacks = 0;
    return {
      onHitLanded(ctx, hit) {
        if (hit.mitigated <= 0) return;
        const before = stacks;
        stacks = Math.min(12, stacks + 2);
        if (stacks === before) return;
        const perStack = byLevel(1.8, 4.2, ctx.stats.level);
        ctx.applyTemporaryStats({
          stats: { attackDamage: perStack * 2 },
          durationSeconds: 6,
          label: `Eroberer · ${stacks}/12 Stapel (+${(perStack * stacks).toFixed(0)} AD)`,
        });
      },
    };
  },
};

/* ------------------------------------------------------------- minor runes */

const CHEAP_SHOT: RuneDefinition = {
  id: 8126,
  name: 'Fieser Trick',
  modelled: true,
  note: 'Setzt voraus, dass das Ziel beeinträchtigt ist — hier an Vis R-Luftstoß gekoppelt.',
  createRuntime() {
    let readyAt = 0;
    let ultCastAt = -Infinity;
    return {
      onHitLanded(ctx, hit) {
        if (hit.sourceId === 'R') ultCastAt = ctx.time;
        if (ctx.time < readyAt) return;
        // Knock-up window from Cease and Desist.
        if (ctx.time - ultCastAt > 1.25) return;
        ctx.dealDamage({
          sourceId: 'rune:8126',
          sourceLabel: 'Fieser Trick',
          sourceKind: 'rune',
          type: 'true',
          amount: byLevel(10, 45, ctx.stats.level),
          notes: ['Ziel durch R beeinträchtigt'],
        });
        readyAt = ctx.time + 4;
      },
    };
  },
};

const SUDDEN_IMPACT: RuneDefinition = {
  id: 8143,
  name: 'Plötzlicher Einschlag',
  modelled: true,
  note: 'Vis Q und R sind Sprints, lösen also dauerhaft aus. Als konstante Letalität und Magiedurchdringung gerechnet.',
  stats: () => ({ lethality: 7, magicPenFlat: 6 }),
};

const EYEBALL_COLLECTION: RuneDefinition = {
  id: 8138,
  name: 'Augapfelsammlung',
  modelled: true,
  note: 'Voll gestapelt gerechnet (+6 adaptive Kraft).',
  stats: () => ({ attackDamage: 6 }),
};

const COUP_DE_GRACE: RuneDefinition = {
  id: 8014,
  name: 'Gnadenstoß',
  modelled: true,
  note: '+8 % Schaden gegen Champions unter 40 % Leben.',
  amplify: (ctx) => (ctx.targetCurrentHealth / ctx.targetMaxHealth <= 0.4 ? 0.08 : 0),
};

const CUT_DOWN: RuneDefinition = {
  id: 8017,
  name: 'Niederstrecken',
  modelled: true,
  note: 'Bis zu +8 %, abhängig davon, wie viel mehr maximales Leben das Ziel hat.',
  amplify: (ctx) => {
    const ratio = ctx.targetMaxHealth / Math.max(1, ctx.stats.maxHealth);
    if (ratio <= 1.0) return 0;
    // Scales linearly from 0 % at equal health to 8 % at +100 % health.
    return Math.min(0.08, ((ratio - 1) / 1.0) * 0.08);
  },
};

const LAST_STAND: RuneDefinition = {
  id: 8299,
  name: 'Letztes Gefecht',
  modelled: true,
  note: 'Hängt von Vis eigenem Leben ab — hier mit vollem Leben gerechnet, wirkt daher nicht.',
  amplify: () => 0,
};

const LEGEND_ALACRITY: RuneDefinition = {
  id: 9104,
  name: 'Legende: Hast',
  modelled: true,
  note: 'Voll gestapelt gerechnet (+15 % Angriffstempo).',
  stats: () => ({ attackSpeed: 0.15 }),
};

const TRANSCENDENCE: RuneDefinition = {
  id: 8210,
  name: 'Transzendenz',
  modelled: true,
  note: '+10 Fähigkeitstempo ab Level 10 (ab Level 5: +5).',
  stats: ({ level }) => ({ abilityHaste: level >= 10 ? 10 : level >= 5 ? 5 : 0 }),
};

const GATHERING_STORM: RuneDefinition = {
  id: 8236,
  name: 'Aufziehender Sturm',
  modelled: true,
  note: 'Wächst alle 10 Minuten. Hier über die Spielzeit-Annahme in den Einstellungen gerechnet.',
  stats: ({ level }) => {
    // Approximate game time from level: roughly 2 minutes per level.
    const tenMinuteBlocks = Math.floor((level * 2) / 10);
    const adaptive = [0, 8, 24, 48, 80, 120][Math.min(5, tenMinuteBlocks)] ?? 0;
    return { attackDamage: adaptive * 0.6 };
  },
};

const ABSOLUTE_FOCUS: RuneDefinition = {
  id: 8233,
  name: 'Absoluter Fokus',
  modelled: true,
  note: 'Setzt voraus, dass Vi über 70 % Leben hat — hier immer aktiv.',
  stats: ({ level }) => ({ attackDamage: byLevel(1.8, 18, level) * 0.6 }),
};

/* ---------------------------------------------------------------- stat shards */

export const SHARD_DEFINITIONS: RuneDefinition[] = [
  {
    id: 5008,
    name: 'Adaptive Kraft',
    modelled: true,
    note: '+9 adaptive Kraft → +5,4 Angriffsschaden für AD-Champions.',
    stats: () => ({ attackDamage: 5.4 }),
  },
  {
    id: 5005,
    name: 'Angriffstempo',
    modelled: true,
    note: '+10 % Angriffstempo.',
    stats: () => ({ attackSpeed: 0.1 }),
  },
  {
    id: 5007,
    name: 'Fähigkeitstempo',
    modelled: true,
    note: '+8 Fähigkeitstempo.',
    stats: () => ({ abilityHaste: 8 }),
  },
  {
    id: 5010,
    name: 'Lauftempo',
    modelled: true,
    note: '+2 % Lauftempo — ohne Schadenswirkung.',
    stats: () => ({ moveSpeedPercent: 0.02 }),
  },
  {
    id: 5011,
    name: 'Leben',
    modelled: true,
    note: '+65 Leben.',
    stats: () => ({ hp: 65 }),
  },
  {
    id: 5001,
    name: 'Leben (skalierend)',
    modelled: true,
    note: 'Skaliert mit dem Level.',
    stats: ({ level }) => ({ hp: byLevel(10, 180, level) }),
  },
  {
    id: 5013,
    name: 'Zähigkeit & Verlangsamungsresistenz',
    modelled: true,
    note: '+10 % Zähigkeit — ohne Schadenswirkung.',
    stats: () => ({ tenacity: 0.1 }),
  },
];

/* -------------------------------------------------------------------- registry */

const ALL: RuneDefinition[] = [
  ELECTROCUTE,
  HAIL_OF_BLADES,
  DARK_HARVEST,
  PRESS_THE_ATTACK,
  CONQUEROR,
  CHEAP_SHOT,
  SUDDEN_IMPACT,
  EYEBALL_COLLECTION,
  COUP_DE_GRACE,
  CUT_DOWN,
  LAST_STAND,
  LEGEND_ALACRITY,
  TRANSCENDENCE,
  GATHERING_STORM,
  ABSOLUTE_FOCUS,
  ...SHARD_DEFINITIONS,
];

const BY_ID = new Map<number, RuneDefinition>(ALL.map((rune) => [rune.id, rune]));

export function getRuneDefinition(id: number): RuneDefinition | undefined {
  return BY_ID.get(id);
}

export function isRuneModelled(id: number): boolean {
  return BY_ID.get(id)?.modelled ?? false;
}

/** Stat contributions from every selected rune and shard. */
export function runeStats(ids: number[], ctx: RuneStatContext): Partial<StatBlock>[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((rune): rune is RuneDefinition => Boolean(rune?.stats))
    .map((rune) => rune.stats!(ctx));
}

export function runeRuntimes(ids: number[]): { id: number; runtime: RuneRuntime }[] {
  return ids
    .map((id) => ({ id, def: BY_ID.get(id) }))
    .filter((entry): entry is { id: number; def: RuneDefinition } =>
      Boolean(entry.def?.createRuntime),
    )
    .map((entry) => ({ id: entry.id, runtime: entry.def.createRuntime!() }));
}

export function runeAmplifiers(ids: number[]): RuneDefinition[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((rune): rune is RuneDefinition => Boolean(rune?.amplify));
}
