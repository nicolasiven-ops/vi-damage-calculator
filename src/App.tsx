import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE } from './data/ddragon';
import { analyse } from './engine/analysis';
import { simulate } from './engine/simulate';
import type { AbilitySlot, ComboStep } from './engine/types';
import { VI_MODULE } from './model/champions/vi';
import { resolveAbilityNames, type ChampionModuleContext } from './model/champions/types';
import { resolvePurchasableItems } from './model/items';
import { runeStats } from './model/runes';
import { emptyStats, resolveChampionStats, sumStats } from './model/stats';
import {
  activeItemIds,
  activeRuneIds,
  activeShardIds,
  defaultBuild,
  loadBuild,
  saveBuild,
  type BuildState,
} from './state/build';
import { useChampionDetail, usePatchData } from './hooks/usePatchData';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { AppHeader } from './ui/AppHeader';
import { ChampionPanel } from './ui/ChampionPanel';
import { ComboBuilder } from './ui/ComboBuilder';
import { ItemPanel } from './ui/ItemPanel';
import { RunePanel } from './ui/RunePanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { TargetPanel } from './ui/TargetPanel';
import { imageUrls } from './data/ddragon';

export default function App() {
  const [build, setBuild] = useState<BuildState>(() => loadBuild());
  const patch = usePatchData(DEFAULT_LOCALE);
  const bundle = patch.bundle;

  const champion = useChampionDetail(
    bundle?.version ?? null,
    bundle?.locale ?? DEFAULT_LOCALE,
    build.championId,
    bundle?.offline ?? true,
  );

  useEffect(() => {
    saveBuild(build);
  }, [build]);

  function patchBuild(next: Partial<BuildState>): void {
    setBuild((current) => ({ ...current, ...next }));
  }

  /**
   * Combo edits go through an updater rather than a finished list, so two
   * quick clicks cannot both build their new combo from the same stale render.
   */
  const updateCombo = useCallback((update: (current: ComboStep[]) => ComboStep[]) => {
    setBuild((current) => ({ ...current, combo: update(current.combo) }));
  }, []);

  /* ------------------------------------------------------------ derived data */

  const items = useMemo(
    () => (bundle ? resolvePurchasableItems(bundle.items) : []),
    [bundle],
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const baseStats =
    champion.detail?.stats ?? bundle?.champions[build.championId]?.stats ?? null;

  const moduleCtx: ChampionModuleContext = useMemo(
    () => ({
      detail: champion.detail,
      spellById: champion.spellById,
      gameData: champion.gameData,
    }),
    [champion.detail, champion.spellById, champion.gameData],
  );

  const bonusStats = useMemo(() => {
    if (!baseStats) return emptyStats();
    const fromItems = activeItemIds(build)
      .map((id) => itemById.get(id)?.stats)
      .filter(Boolean) as ReturnType<typeof emptyStats>[];

    // Runes that scale with the champion need a baseline to look at, so items
    // are resolved first and runes layered on top.
    const baseline = resolveChampionStats(baseStats, build.level, sumStats(fromItems));
    const fromRunes = runeStats([...activeRuneIds(build), ...activeShardIds(build)], {
      level: build.level,
      baseline,
    });

    return sumStats([...fromItems, ...fromRunes, build.manualStats]);
  }, [baseStats, build, itemById]);

  const stats = useMemo(
    () => (baseStats ? resolveChampionStats(baseStats, build.level, bonusStats) : null),
    [baseStats, build.level, bonusStats],
  );

  const analysis = useMemo(() => {
    if (!baseStats || !stats) return null;
    const result = simulate(
      {
        attacker: {
          championId: build.championId,
          level: build.level,
          ranks: build.ranks,
          itemIds: activeItemIds(build),
          runeIds: activeRuneIds(build),
          shardIds: activeShardIds(build),
          manualStats: build.manualStats,
        },
        championBaseStats: baseStats,
        attackerStats: stats,
        bonusStats,
        target: build.target,
        combo: build.combo,
        timings: build.timings,
        critMode: build.critMode,
      },
      VI_MODULE,
      moduleCtx,
    );
    return analyse(result, build.target, stats);
  }, [baseStats, stats, bonusStats, build, moduleCtx]);

  const abilities = useMemo(
    () => resolveAbilityNames(VI_MODULE.abilities, moduleCtx),
    [moduleCtx],
  );

  const spellIcons = useMemo(() => {
    const icons: Partial<Record<AbilitySlot, string>> = {};
    if (!champion.detail || !bundle) return icons;
    for (const ability of VI_MODULE.abilities) {
      if (!ability.ddragonId) continue;
      const spell = champion.detail.spells?.find((entry) => entry.id === ability.ddragonId);
      if (spell) icons[ability.slot] = imageUrls.spell(bundle.version, spell.image.full);
    }
    return icons;
  }, [champion.detail, bundle]);

  /* ----------------------------------------------------------------- render */

  return (
    <div className="app">
      <AppHeader
        version={bundle?.version ?? '—'}
        versions={patch.versions}
        offline={bundle?.offline ?? false}
        loading={patch.loading}
        error={patch.error}
        onVersionChange={patch.setVersion}
        onReload={patch.reload}
        onReset={() => setBuild(defaultBuild())}
      />

      <main className="app-main">
        <div className="column">
          {stats && (
            <ChampionPanel
              detail={champion.detail}
              version={bundle?.version ?? ''}
              championName={VI_MODULE.displayName}
              level={build.level}
              ranks={build.ranks}
              abilities={abilities}
              stats={stats}
              onLevelChange={(level) => patchBuild({ level })}
              onRankChange={(slot, rank) =>
                patchBuild({ ranks: { ...build.ranks, [slot]: Math.max(0, rank) } })
              }
            />
          )}

          <ItemPanel
            items={items}
            itemIds={build.itemIds}
            version={bundle?.version ?? ''}
            offline={bundle?.offline ?? true}
            onChange={(itemIds) => patchBuild({ itemIds })}
          />

          <RunePanel
            trees={bundle?.runeTrees ?? []}
            build={build}
            offline={bundle?.offline ?? true}
            onChange={patchBuild}
          />
        </div>

        <div className="column">
          <ComboBuilder
            combo={build.combo}
            abilities={abilities}
            spellIcons={spellIcons}
            learnedRanks={build.ranks}
            onChange={updateCombo}
          />

          <TargetPanel
            target={build.target}
            champions={bundle?.champions ?? {}}
            onChange={(target) => patchBuild({ target })}
          />

          {analysis && stats ? (
            <AnalysisPanel
              analysis={analysis}
              target={build.target}
              module={VI_MODULE}
              moduleCtx={moduleCtx}
              abilities={abilities}
              ranks={build.ranks}
              gameDataStatus={champion.gameDataStatus}
            />
          ) : (
            <section className="panel">
              <div className="panel-body">
                <p className="empty-note">
                  {patch.loading
                    ? 'Championdaten werden geladen …'
                    : 'Ohne Championdaten kann nicht gerechnet werden.'}
                </p>
              </div>
            </section>
          )}

          <SettingsPanel
            critMode={build.critMode}
            timings={build.timings}
            onChange={patchBuild}
          />
        </div>
      </main>

      <footer className="app-footer">
        <span>
          Championdaten, Items und Runenbäume von{' '}
          <a href="https://developer.riotgames.com/docs/lol#data-dragon" rel="noreferrer noopener">
            Riot Data Dragon
          </a>
          {bundle && !bundle.offline ? ` · Patch ${bundle.version}` : ''}
        </span>
        <span className="app-footer-note">
          Kein offizielles Riot-Games-Produkt. Fähigkeits-Ratios und Runenformeln sind gepflegte
          Konstanten — siehe Formel-Inspektor.
        </span>
      </footer>
    </div>
  );
}
