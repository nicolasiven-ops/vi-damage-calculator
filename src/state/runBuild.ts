/**
 * One build, one run — the pipeline every question about a build goes through.
 *
 * Until now this lived inline in the app: resolve the items' stats, layer the
 * runes on top of the resulting baseline, resolve the champion's stats at its
 * level, simulate, analyse. That was fine while there was exactly one build to
 * ask about. It stops being fine the moment anything asks a *counterfactual* —
 * what would this combo do without Black Cleaver, with 500 more gold, in the
 * other order — because a second copy of the pipeline is a second set of rules,
 * and the difference between two runs is only meaningful if the two runs were
 * computed the same way.
 *
 * So: one function, called once for the build on screen and once per question
 * asked about it. The comparisons downstream are then differences, not opinions.
 */

import { analyse, type ComboAnalysis } from '../engine/analysis';
import { simulate } from '../engine/simulate';
import type { AbilitySlot, ComboStep, CritMode, TargetConfig, TimingConfig } from '../engine/types';
import type { ChampionModule, ChampionModuleContext } from '../model/champions/types';
import type { ResolvedItem } from '../model/items';
import { itemDerivedStats } from '../model/itemEffects';
import { runeStats } from '../model/runes';
import {
  resolveChampionStats,
  sumStats,
  type ChampionStats,
  type StatBlock,
} from '../model/stats';
import type { DDragonChampionStats } from '../data/types';

export interface BuildInputs {
  baseStats: DDragonChampionStats;
  level: number;
  ranks: Record<AbilitySlot, number>;
  itemIds: string[];
  runeIds: number[];
  shardIds: number[];
  summonerIds: string[];
  manualStats: Partial<StatBlock>;
  /** The attacker's own health going in, as a fraction of maximum. */
  attackerHealthPercent?: number;
  championId: string;
  combo: ComboStep[];
  timings: TimingConfig;
  critMode: CritMode;
  target: TargetConfig;
}

export interface RunOutcome {
  analysis: ComboAnalysis;
  stats: ChampionStats;
  bonusStats: StatBlock;
}

/**
 * Everything a build's items and runes add, before the champion's own numbers.
 *
 * The order matters and is the reason this is not a sum: runes that scale with
 * what you already have (Legend stacks, adaptive shards) need a baseline to look
 * at, so the items are resolved into stats first and the runes are handed the
 * champion as it stands *with* them.
 */
export function resolveBonusStats(
  inputs: Pick<BuildInputs, 'baseStats' | 'level' | 'itemIds' | 'runeIds' | 'shardIds' | 'manualStats'>,
  itemById: Map<string, ResolvedItem>,
): StatBlock {
  const fromItems = inputs.itemIds
    .map((id) => itemById.get(id)?.stats)
    .filter((entry): entry is StatBlock => Boolean(entry));

  const baseline = resolveChampionStats(inputs.baseStats, inputs.level, sumStats(fromItems));
  const fromRunes = runeStats([...inputs.runeIds, ...inputs.shardIds], {
    level: inputs.level,
    baseline,
  });

  /*
   * Items whose stat line is a function of the build — Sterak's half of base
   * attack damage, Manamune's per-mana attack damage, Rabadon's multiplier on
   * ability power. They read the same baseline the runes do, for the same
   * reason: they cannot be resolved until the rest of the build is.
   */
  const withRunes = resolveChampionStats(
    inputs.baseStats,
    inputs.level,
    sumStats([...fromItems, ...fromRunes, inputs.manualStats]),
  );
  const derived = itemDerivedStats(inputs.itemIds, {
    level: inputs.level,
    baseline: withRunes,
  });

  return sumStats([...fromItems, ...fromRunes, ...derived, inputs.manualStats]);
}

/** The build, simulated and analysed. */
export function runBuild(
  inputs: BuildInputs,
  itemById: Map<string, ResolvedItem>,
  module: ChampionModule,
  moduleCtx: ChampionModuleContext,
): RunOutcome {
  const bonusStats = resolveBonusStats(inputs, itemById);
  const stats = resolveChampionStats(inputs.baseStats, inputs.level, bonusStats);

  const result = simulate(
    {
      attacker: {
        championId: inputs.championId,
        level: inputs.level,
        ranks: inputs.ranks,
        itemIds: inputs.itemIds,
        runeIds: inputs.runeIds,
        shardIds: inputs.shardIds,
        summonerIds: inputs.summonerIds,
        manualStats: inputs.manualStats,
        ...(inputs.attackerHealthPercent !== undefined
          ? { currentHealthPercent: inputs.attackerHealthPercent }
          : {}),
      },
      championBaseStats: inputs.baseStats,
      attackerStats: stats,
      bonusStats,
      target: inputs.target,
      combo: inputs.combo,
      timings: inputs.timings,
      critMode: inputs.critMode,
    },
    module,
    moduleCtx,
  );

  return { analysis: analyse(result, inputs.target, stats), stats, bonusStats };
}
