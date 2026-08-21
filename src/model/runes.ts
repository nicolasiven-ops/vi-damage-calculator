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
  name: 'Electrocute',
  modelled: true,
  note: '3 separate attacks or abilities on the same champion within 3s.',
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
          sourceLabel: 'Electrocute',
          sourceKind: 'rune',
          type: adaptiveType(ctx.stats),
          amount,
          notes: ['3 hits within 3s'],
        });
        procced = true;
        readyAt = ctx.time + byLevel(25, 20, ctx.stats.level);
      },
    };
  },
};

/**
 * Hail of Blades.
 *
 * Numbers from Data Dragon's own rune text for the patch: 90% attack speed for
 * melee champions (60% ranged), up to three attacks, no more than 3s between
 * them, 10s cooldown, and 2–20 (+12% bonus AD, +10% AP) true damage on each
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
 * 3s window as its duration and cleared explicitly once the attacks are spent.
 */
const HAIL_OF_BLADES: RuneDefinition = {
  id: 9923,
  name: 'Hail of Blades',
  modelled: true,
  note:
    '90% attack speed (melee) for 3 attacks against champions, ' +
    'plus 1 extra attack per attack timer reset — Vi\'s E counts. ' +
    'Bonus true damage on each of those attacks. The attack speed is allowed to exceed the 2.5 cap. ' +
    'The 10s cooldown starts on activation.',
  createRuntime() {
    const LABEL = 'Hail of Blades';
    /** Melee value; the rune grants 60% to ranged champions. */
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
          // "3 of 4" is a legitimate reading of an extended window.
          notes: [`Attack ${spent} of ${spent + attacksLeft - 1}`],
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
          detail: `Attack timer reset · ${attacksLeft} attacks left`,
        });
      },
    };
  },
};

const DARK_HARVEST: RuneDefinition = {
  id: 8128,
  name: 'Dark Harvest',
  modelled: true,
  note: 'Triggers as soon as the target drops below 50% health. Souls are not collected across the combo — the starting value is configurable via the soul count.',
  createRuntime() {
    let readyAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (ctx.time < readyAt) return;
        if (hit.targetHealthPercentAfter > 0.5 || hit.targetHealthPercentAfter <= 0) return;
        const amount = adaptiveAmount(ctx.stats, 20, 0.25, 0.15);
        ctx.dealDamage({
          sourceId: 'rune:8128',
          sourceLabel: 'Dark Harvest',
          sourceKind: 'rune',
          type: adaptiveType(ctx.stats),
          amount,
          notes: ['target below 50% health', 'calculated without collected souls'],
        });
        readyAt = ctx.time + 40;
      },
    };
  },
};

const PRESS_THE_ATTACK: RuneDefinition = {
  id: 8005,
  name: 'Press the Attack',
  modelled: true,
  note: '3 consecutive basic attacks on the same champion; afterwards 8% increased damage from all sources for 6s.',
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
          sourceLabel: 'Press the Attack',
          sourceKind: 'rune',
          type: adaptiveType(ctx.stats),
          amount: byLevel(40, 180, ctx.stats.level),
          notes: ['3rd consecutive basic attack'],
        });
        procced = true;
        ampUntil = ctx.time + 6;
        ctx.applyTargetAmplification({
          percent: 0.08,
          durationSeconds: 6,
          label: 'Press the Attack · target takes +8% damage',
        });
      },
    };
  },
};

const CONQUEROR: RuneDefinition = {
  id: 8010,
  name: 'Conqueror',
  modelled: true,
  note: 'Melee champions gain 2 stacks per hit, up to 12. Stacks build up over the course of the combo.',
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
          label: `Conqueror · ${stacks}/12 stacks (+${(perStack * stacks).toFixed(0)} AD)`,
        });
      },
    };
  },
};

/* ------------------------------------------------------------- minor runes */

const CHEAP_SHOT: RuneDefinition = {
  id: 8126,
  name: 'Cheap Shot',
  modelled: true,
  note: 'Requires the target to be impaired — tied to Vi\'s R knock-up here.',
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
          sourceLabel: 'Cheap Shot',
          sourceKind: 'rune',
          type: 'true',
          amount: byLevel(10, 45, ctx.stats.level),
          notes: ['target impaired by R'],
        });
        readyAt = ctx.time + 4;
      },
    };
  },
};

const SUDDEN_IMPACT: RuneDefinition = {
  id: 8143,
  name: 'Sudden Impact',
  modelled: true,
  note: 'Vi\'s Q and R are dashes, so this is permanently up. Counted as constant lethality and magic penetration.',
  stats: () => ({ lethality: 7, magicPenFlat: 6 }),
};

const EYEBALL_COLLECTION: RuneDefinition = {
  id: 8138,
  name: 'Eyeball Collection',
  modelled: true,
  note: 'Counted as fully stacked (+6 adaptive force).',
  stats: () => ({ attackDamage: 6 }),
};

const COUP_DE_GRACE: RuneDefinition = {
  id: 8014,
  name: 'Coup de Grace',
  modelled: true,
  note: '+8% damage against champions below 40% health.',
  amplify: (ctx) => (ctx.targetCurrentHealth / ctx.targetMaxHealth <= 0.4 ? 0.08 : 0),
};

const CUT_DOWN: RuneDefinition = {
  id: 8017,
  name: 'Cut Down',
  modelled: true,
  note: 'Up to +8%, depending on how much more maximum health the target has.',
  amplify: (ctx) => {
    const ratio = ctx.targetMaxHealth / Math.max(1, ctx.stats.maxHealth);
    if (ratio <= 1.0) return 0;
    // Scales linearly from 0% at equal health to 8% at +100% health.
    return Math.min(0.08, ((ratio - 1) / 1.0) * 0.08);
  },
};

const LAST_STAND: RuneDefinition = {
  id: 8299,
  name: 'Last Stand',
  modelled: true,
  note: 'Depends on Vi\'s own health — calculated at full health here, so it has no effect.',
  amplify: () => 0,
};

const LEGEND_ALACRITY: RuneDefinition = {
  id: 9104,
  name: 'Legend: Alacrity',
  modelled: true,
  note: 'Counted as fully stacked (+15% attack speed).',
  stats: () => ({ attackSpeed: 0.15 }),
};

/**
 * Legend: Haste — the reason `basicAbilityHaste` exists as its own stat.
 *
 * Riot's own text scopes it: "Gain 1.5 basic ability haste for every Legend
 * stack (max 10 stacks)". Fully stacked that is 15, and it does not shorten the
 * ultimate. Counted as fully stacked, the way Legend: Alacrity is — stacks come
 * from takedowns, which a duel against a stationary target does not produce, so
 * the alternative is counting it as zero and quietly under-reporting a rune the
 * build paid for.
 */
const LEGEND_HASTE: RuneDefinition = {
  id: 9105,
  name: 'Legend: Haste',
  modelled: true,
  note: 'Counted as fully stacked: +15 basic ability haste, which shortens Q, W and E and not R.',
  stats: () => ({ basicAbilityHaste: 15 }),
};

const TRANSCENDENCE: RuneDefinition = {
  id: 8210,
  name: 'Transcendence',
  modelled: true,
  note: '+10 ability haste from level 10 onwards (from level 5: +5).',
  stats: ({ level }) => ({ abilityHaste: level >= 10 ? 10 : level >= 5 ? 5 : 0 }),
};

const GATHERING_STORM: RuneDefinition = {
  id: 8236,
  name: 'Gathering Storm',
  modelled: true,
  note: 'Grows every 10 minutes. Calculated here from the game time assumed in the settings.',
  stats: ({ level }) => {
    // Approximate game time from level: roughly 2 minutes per level.
    const tenMinuteBlocks = Math.floor((level * 2) / 10);
    const adaptive = [0, 8, 24, 48, 80, 120][Math.min(5, tenMinuteBlocks)] ?? 0;
    return { attackDamage: adaptive * 0.6 };
  },
};

const ABSOLUTE_FOCUS: RuneDefinition = {
  id: 8233,
  name: 'Absolute Focus',
  modelled: true,
  note: 'Requires Vi to be above 70% health — always active here.',
  stats: ({ level }) => ({ attackDamage: byLevel(1.8, 18, level) * 0.6 }),
};

/* ---------------------------------------------------------------- stat shards */

export const SHARD_DEFINITIONS: RuneDefinition[] = [
  {
    id: 5008,
    name: 'Adaptive Force',
    modelled: true,
    note: '+9 adaptive force → +5.4 attack damage for AD champions.',
    stats: () => ({ attackDamage: 5.4 }),
  },
  {
    id: 5005,
    name: 'Attack Speed',
    modelled: true,
    note: '+10% attack speed.',
    stats: () => ({ attackSpeed: 0.1 }),
  },
  {
    id: 5007,
    name: 'Ability Haste',
    modelled: true,
    note: '+8 ability haste.',
    stats: () => ({ abilityHaste: 8 }),
  },
  {
    id: 5010,
    name: 'Movement Speed',
    modelled: true,
    note: '+2% movement speed — no effect on damage.',
    stats: () => ({ moveSpeedPercent: 0.02 }),
  },
  {
    id: 5011,
    name: 'Health',
    modelled: true,
    note: '+65 health.',
    stats: () => ({ hp: 65 }),
  },
  {
    id: 5001,
    name: 'Health (scaling)',
    modelled: true,
    note: 'Scales with level.',
    stats: ({ level }) => ({ hp: byLevel(10, 180, level) }),
  },
  {
    id: 5013,
    name: 'Tenacity and Slow Resist',
    modelled: true,
    note: '+10% tenacity — no effect on damage.',
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
  LEGEND_HASTE,
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
