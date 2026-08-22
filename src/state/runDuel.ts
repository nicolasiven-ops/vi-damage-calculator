/**
 * Both sides of a duel, assembled from the one build on screen.
 *
 * The app already knows everything a duel needs and has never put it together:
 * Vi's build, the target's champion, level, items and runes, and — since the
 * engine learned about incoming damage — a way for either of them to be hit.
 * This is the assembly, and it deliberately reuses the same pipeline as the
 * one-sided run, so a duel cannot disagree with the analysis beside it.
 *
 * Two honest limits, both worth stating where the code is rather than only in the
 * interface:
 *
 *  - **Nobody moves.** There is no distance, so no kiting, no walking out of
 *    range, no dash spent on escaping. Both sides stand in each other's face for
 *    the whole fight. That favours whoever is meant to be in your face.
 *  - **The enemy's abilities are only modelled if their champion is.** Today that
 *    means Vi. Anyone else fights with basic attacks, their items and their runes,
 *    which is real damage from real numbers but not their whole kit — and the
 *    display says which case it is rather than letting a quiet win look earned.
 */

import { duel, type DuelOutcome, type DuelSide } from '../engine/duel';
import { simulate } from '../engine/simulate';
import type {
  ComboStep,
  CritMode,
  IncomingHit,
  TargetConfig,
  TimingConfig,
} from '../engine/types';
import type { AbilitySlot } from '../engine/types';
import type { ChampionModule, ChampionModuleContext } from '../model/champions/types';
import type { ChampionStats, StatBlock } from '../model/stats';
import type { DDragonChampionStats } from '../data/types';

/** What one champion brings to the fight. */
export interface DuelCombatant {
  championId: string;
  name: string;
  level: number;
  baseStats: DDragonChampionStats;
  /** Already resolved by the app, so both sides read the same numbers as the panels. */
  stats: ChampionStats;
  bonusStats: StatBlock;
  ranks: Record<AbilitySlot, number>;
  itemIds: string[];
  runeIds: number[];
  shardIds: number[];
  summonerIds: string[];
  manualStats: Partial<StatBlock>;
  /** Health going in, as a fraction of maximum. */
  healthPercent: number;
  /** What this side presses. */
  combo: ComboStep[];
  /** The champion's own kit, or a stub when nobody has modelled it. */
  module: ChampionModule;
  moduleCtx: ChampionModuleContext;
}

export interface DuelInputs {
  vi: DuelCombatant;
  enemy: DuelCombatant;
  timings: TimingConfig;
  critMode: CritMode;
  /**
   * The target's own damage reduction, from the simulation panel.
   *
   * The enemy's, and only the enemy's. It was applied to both sides first, which
   * is a category error with a very visible symptom: fifty flat reduction on a
   * champion whose attacks land for thirty means the enemy deals literally nothing
   * and the duel reports a walkover. The field lives in the target panel because it
   * describes the target.
   */
  situation: Pick<TargetConfig, 'flatDamageReduction' | 'percentDamageReduction'>;
}

/**
 * One combatant as a target: what the other side is shooting at.
 *
 * `situation` is passed only for the side it was entered for — see `DuelInputs`.
 */
function asTarget(
  who: DuelCombatant,
  situation: DuelInputs['situation'] | null,
): TargetConfig {
  return {
    name: who.name,
    level: who.level,
    maxHealth: who.stats.maxHealth,
    currentHealthPercent: who.healthPercent,
    armor: who.stats.armor,
    magicResist: who.stats.magicResist,
    bonusHealth: who.stats.bonusHealth,
    unitType: 'champion',
    flatDamageReduction: situation?.flatDamageReduction ?? 0,
    percentDamageReduction: situation?.percentDamageReduction ?? 0,
  };
}

/** A side of the duel, ready to be run with whatever is arriving. */
function sideFor(
  who: DuelCombatant,
  against: DuelCombatant,
  inputs: DuelInputs,
  /** Whether the champion being shot at is the one the panel describes. */
  againstIsTarget: boolean,
): DuelSide {
  return {
    name: who.name,
    combo: who.combo,
    startingHealth: who.stats.maxHealth * who.healthPercent,
    run: (incoming: IncomingHit[]) =>
      simulate(
        {
          attacker: {
            championId: who.championId,
            level: who.level,
            ranks: who.ranks,
            itemIds: who.itemIds,
            runeIds: who.runeIds,
            shardIds: who.shardIds,
            summonerIds: who.summonerIds,
            manualStats: who.manualStats,
            currentHealthPercent: who.healthPercent,
          },
          championBaseStats: who.baseStats,
          attackerStats: who.stats,
          bonusStats: who.bonusStats,
          target: asTarget(against, againstIsTarget ? inputs.situation : null),
          combo: who.combo,
          timings: inputs.timings,
          critMode: inputs.critMode,
          incoming,
        },
        who.module,
        who.moduleCtx,
      ),
  };
}

export function runDuel(inputs: DuelInputs): DuelOutcome | null {
  return duel(
    sideFor(inputs.vi, inputs.enemy, inputs, true),
    sideFor(inputs.enemy, inputs.vi, inputs, false),
  );
}

/**
 * What an unmodelled champion does: attack, as fast as it can, for as long as the
 * fight can last.
 *
 * Not a policy so much as the absence of one — and it is the honest floor rather
 * than a guess, because basic attacks are the part of any champion this app can
 * compute exactly: their attack damage, their attack speed, their items' on-hit
 * effects, their runes. Everything above that floor is missing, and the display
 * says so.
 *
 * The count covers the horizon at the slowest plausible attack speed; the driver
 * throws away whatever the fight did not last long enough to reach.
 */
export function attackPlan(seconds: number, uid: (index: number) => string): ComboStep[] {
  const most = Math.ceil(seconds / 0.6);
  return Array.from({ length: most }, (_, index) => ({
    uid: uid(index),
    action: { kind: 'attack' as const },
  }));
}
