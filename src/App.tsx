import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  activeSummonerIds,
  defaultBuild,
  loadBuild,
  saveBuild,
  type BuildState,
  type LoadoutState,
} from './state/build';
import { useChampionDetail, useChampionProfile, usePatchData } from './hooks/usePatchData';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { AppHeader } from './ui/AppHeader';
import { ChampionPanel } from './ui/ChampionPanel';
import { ComboBuilder } from './ui/ComboBuilder';
import { ItemPanel } from './ui/ItemPanel';
import { RunePanel } from './ui/RunePanel';
import { SummonerPanel, type SummonerOption } from './ui/SummonerPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { LoadoutNotes } from './ui/LoadoutNotes';
import { fightMoment } from './ui/moment';
import { unknownStats } from './ui/StatSheet';
import { PRIMAL_SMITES } from './model/summoners';
import { TargetPanel } from './ui/TargetPanel';
import { imageUrls } from './data/ddragon';

/**
 * The panels that configure the build, shown one at a time.
 *
 * They used to sit stacked in a permanent left column, which put five things
 * you adjust occasionally in front of the one thing you read constantly. Here
 * they are a row of tabs that opens the one you asked for and closes it again.
 */
type ConfigTab = 'champion' | 'items' | 'runes' | 'target' | 'sim';

const CRIT_LABELS: Record<BuildState['critMode'], string> = {
  expected: 'Crit avg',
  always: 'Crit always',
  never: 'Crit never',
};

/**
 * A config tab that also reports its own state.
 *
 * The label alone would hide what it is hiding — "Items" says nothing about
 * whether six are equipped. Carrying the value means closing the drawer costs
 * no information.
 */
function ConfigTabButton({
  id,
  label,
  value,
  active,
  onToggle,
}: {
  id: ConfigTab;
  label: string;
  value: string;
  active: ConfigTab | null;
  onToggle: (tab: ConfigTab | null) => void;
}) {
  const isOpen = active === id;
  return (
    <button
      className={`config-tab${isOpen ? ' is-open' : ''}`}
      aria-expanded={isOpen}
      onClick={() => onToggle(isOpen ? null : id)}
    >
      <span className="config-tab-label">{label}</span>
      <span className="config-tab-value mono">{value}</span>
      <span className="config-tab-caret" aria-hidden="true">
        {isOpen ? '▾' : '▸'}
      </span>
    </button>
  );
}

export default function App() {
  const [build, setBuild] = useState<BuildState>(() => loadBuild());
  const [configTab, setConfigTab] = useState<ConfigTab | null>(null);
  /**
   * The combo step under the cursor, wherever the cursor is.
   *
   * Lives here because both the pinned combo strip and the analysis below it
   * need to agree on it — hovering a timeline row lights the card that caused
   * it, and hovering a card lights its rows.
   */
  /**
   * A step pinned by clicking, which survives the cursor leaving.
   *
   * Hovering is for scanning; pinning is for working on one moment — comparing
   * it against the combo, changing an item, and seeing what happened to exactly
   * that hit. Hover wins while it lasts, then the pin takes over again.
   */
  const [rawPinnedStepUid, setPinnedStepUid] = useState<string | null>(null);
  /*
   * A pin on a step that has since been deleted points at nothing, and would
   * leave a "Clear selection" button for a selection nobody can see. Derived
   * rather than cleaned up in an effect, so it can never be briefly wrong.
   */
  const pinnedStepUid = build.combo.some((entry) => entry.uid === rawPinnedStepUid)
    ? rawPinnedStepUid
    : null;
  /*
   * The focused moment is the one you clicked. Nothing else moves it.
   *
   * Hover used to pick it, which meant every trip of the mouse across the strip
   * or the timeline rewrote the stat sheets and the bars on the way past. A
   * number that changes because the cursor went somewhere is a number you cannot
   * read.
   */
  const linkedStepUid = pinnedStepUid;
  const patch = usePatchData(DEFAULT_LOCALE);
  const bundle = patch.bundle;

  const champion = useChampionDetail(
    bundle?.version ?? null,
    bundle?.locale ?? DEFAULT_LOCALE,
    build.championId,
    bundle?.offline ?? true,
  );

  /* Portrait and ability names for the target, when it follows a champion. */
  const targetProfile = useChampionProfile(
    bundle?.version ?? null,
    bundle?.locale ?? DEFAULT_LOCALE,
    build.targetMode === 'champion' ? build.targetChampionId : '',
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

  /* ---------------------------------------------------------------- the target */

  /**
   * The target's gear, as stats only.
   *
   * Items and runes on a target contribute what they *are* — armour, health,
   * resistances — and nothing they *do*: no procs, no on-hit riders, no
   * keystones. The target is hit in this simulation; it never acts. Running the
   * same `runeStats` and item pipeline as the attacker keeps the two sides from
   * drifting apart.
   */
  const targetBonusStats = useMemo(() => {
    const champion = bundle?.champions[build.targetChampionId];
    if (!champion) return emptyStats();
    const fromItems = activeItemIds(build.targetLoadout)
      .map((id) => itemById.get(id)?.stats)
      .filter(Boolean) as ReturnType<typeof emptyStats>[];
    const baseline = resolveChampionStats(champion.stats, build.target.level, sumStats(fromItems));
    const fromRunes = runeStats(
      [...activeRuneIds(build.targetLoadout), ...activeShardIds(build.targetLoadout)],
      { level: build.target.level, baseline },
    );
    return sumStats([...fromItems, ...fromRunes]);
  }, [bundle, build.targetChampionId, build.targetLoadout, build.target.level, itemById]);

  const targetStats = useMemo(() => {
    const champion = bundle?.champions[build.targetChampionId];
    if (!champion) return null;
    return resolveChampionStats(champion.stats, build.target.level, targetBonusStats);
  }, [bundle, build.targetChampionId, build.target.level, targetBonusStats]);

  /**
   * What the engine actually shoots at.
   *
   * In champion mode the defensive numbers are derived every render from the
   * champion, its level and its gear, so nothing stored can contradict the name
   * in the heading. Custom mode passes its typed values through untouched. Both
   * keep the situational fields from the Simulation panel.
   */
  const effectiveTarget = useMemo(() => {
    if (build.targetMode !== 'champion' || !targetStats) return build.target;
    return {
      ...build.target,
      maxHealth: Math.round(targetStats.maxHealth),
      bonusHealth: Math.round(targetStats.bonusHealth),
      armor: Math.round(targetStats.armor * 10) / 10,
      magicResist: Math.round(targetStats.magicResist * 10) / 10,
      // The champion's own regeneration, which the simulation now ticks.
      healthRegenPerFive: Math.round(targetStats.healthRegen * 10) / 10,
    };
  }, [build.target, build.targetMode, targetStats]);

  /** Patch the target's gear without disturbing the rest of the build. */
  const patchTargetLoadout = useCallback((patch: Partial<LoadoutState>) => {
    setBuild((current) => ({
      ...current,
      targetLoadout: { ...current.targetLoadout, ...patch },
    }));
  }, []);

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
          summonerIds: activeSummonerIds(build),
          manualStats: build.manualStats,
        },
        championBaseStats: baseStats,
        attackerStats: stats,
        bonusStats,
        target: effectiveTarget,
        combo: build.combo,
        timings: build.timings,
        critMode: build.critMode,
      },
      VI_MODULE,
      moduleCtx,
    );
    return analyse(result, effectiveTarget, stats);
  }, [baseStats, stats, bonusStats, build, moduleCtx, effectiveTarget]);

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

  /**
   * The state of the fight at the focused step, derived once for everyone.
   *
   * The bars in the middle and the two stat sheets in the sidebars are three
   * views of the same moment; deriving it three times is how they end up
   * disagreeing about which moment that is.
   */
  const moment = useMemo(
    () =>
      fightMoment(analysis, linkedStepUid, {
        // No champion resolved yet: unknown, not zero.
        attacker: stats ?? unknownStats({}),
        target: {
          currentHealth: effectiveTarget.maxHealth * effectiveTarget.currentHealthPercent,
          maxHealth: effectiveTarget.maxHealth,
          baseArmor: effectiveTarget.armor,
          currentArmor: effectiveTarget.armor,
          effectiveArmor: effectiveTarget.armor,
          baseMagicResist: effectiveTarget.magicResist,
          effectiveMagicResist: effectiveTarget.magicResist,
          crowdControl: [],
        },
      }),
    [analysis, linkedStepUid, stats, effectiveTarget],
  );

  /**
   * Every summoner spell the pickers may offer.
   *
   * Data Dragon's own list, plus the upgraded Smites it does not ship: Primal
   * Smite exists only as the form a grown jungle pet grants, so its three
   * colours come from the app's own table and carry CommunityDragon icons.
   */
  const summonerOptions = useMemo<SummonerOption[]>(() => {
    const version = bundle?.version ?? '';
    const fromPatch = Object.values(bundle?.summoners ?? {}).map((spell) => ({
      id: spell.id,
      name: spell.name,
      iconUrl: imageUrls.summoner(version, spell.image.full),
      cooldownBurn: spell.cooldownBurn,
    }));
    const primal = PRIMAL_SMITES.map((variant) => ({
      id: variant.id,
      name: `Primal Smite · ${variant.pet}`,
      // The strip has room for a word, and the pet is the word people use.
      shortName: variant.pet,
      iconUrl: imageUrls.gameDataSpell(variant.iconFile),
      cooldownBurn: '15',
    }));
    return [...fromPatch, ...primal].sort((a, b) => a.name.localeCompare(b.name));
  }, [bundle]);

  /**
   * The height of the analysis panel, published as a custom property.
   *
   * The two panels that name the sides are held to it, so the three tops and the
   * three bottoms line up whatever the build does. Measured rather than
   * declared: the analysis panel's height depends on the target's health bars,
   * the tile row and the chart, none of which is a constant.
   */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    /*
     * The panel is looked up on every measurement, not captured once.
     *
     * React replaces the analysis panel whenever the combo becomes empty and
     * back again; an observer holding the old node measures a detached element,
     * which reports zero — and a zero here collapses the panel it is applied to.
     * A zero is never a real answer, so it is ignored rather than published.
     */
    const measure = (): void => {
      const head = body.querySelector('.analysis-main');
      if (!(head instanceof HTMLElement)) return;
      const height = Math.round(head.getBoundingClientRect().height);
      if (height > 0) body.style.setProperty('--analysis-head', `${height}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, []);

  /** Spell names by id, for the notes panels. */
  const summonerNames = useMemo(
    () => Object.fromEntries(summonerOptions.map((option) => [option.id, option.name])),
    [summonerOptions],
  );

  /**
   * The attacker's summoner spells, in slot order, for the combo strip.
   *
   * Names and icons come from Data Dragon rather than being hardcoded, so a
   * spell the app has never heard of still shows up correctly the moment Riot
   * ships it.
   */
  const summonerChips = useMemo(
    () =>
      activeSummonerIds(build)
        .map((id) => summonerOptions.find((option) => option.id === id))
        .filter((option): option is SummonerOption => option !== undefined)
        .map((option) => ({
          id: option.id,
          name: option.shortName ?? option.name,
          iconUrl: option.iconUrl,
        })),
    [build, summonerOptions],
  );

  /* ----------------------------------------------------------------- render */

  return (
    <div
      className="app"
      /*
       * Clicking anywhere neutral clears the pinned step.
       *
       * Only genuinely empty space counts: controls keep the selection, and so
       * does anything that can set it — otherwise this handler would fire right
       * after a click that just pinned something and undo it. Config panels are
       * deliberately included, because changing an item while holding a moment is
       * exactly what the pin is for.
       */
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (
          !target.closest(
            'button, input, select, textarea, label, a, .gantt-svg, .chart-svg, .timeline-table, .combo-card, .config-drawer, [data-keep-selection]',
          )
        ) {
          setPinnedStepUid(null);
        }
      }}
    >
      {/*
       * Everything pinned to the top: the header the app is identified by, the
       * config tabs, and the combo the numbers below depend on.
       */}
      <div className="workbench-top">
        <AppHeader
          version={bundle?.version ?? '—'}
          versions={patch.versions}
          offline={bundle?.offline ?? false}
          loading={patch.loading}
          error={patch.error}
          onVersionChange={patch.setVersion}
          onReload={patch.reload}
          onReset={() => setBuild(defaultBuild())}
          tabs={
            <nav className="config-tabs" aria-label="Configure build">
              <ConfigTabButton
                id="champion"
                label="Champion"
                value={`${VI_MODULE.displayName} · ${build.level}`}
                active={configTab}
                onToggle={setConfigTab}
              />
              <ConfigTabButton
                id="items"
                label="Items"
                value={`${activeItemIds(build).length}/6`}
                active={configTab}
                onToggle={setConfigTab}
              />
              <ConfigTabButton
                id="runes"
                label="Runes"
                value={`${activeRuneIds(build).length + activeShardIds(build).length}`}
                active={configTab}
                onToggle={setConfigTab}
              />
              <ConfigTabButton
                id="target"
                label="Target"
                value={`${build.target.maxHealth.toLocaleString('en-US')} HP · ${build.target.armor} armor`}
                active={configTab}
                onToggle={setConfigTab}
              />
              <ConfigTabButton
                id="sim"
                label="Simulation"
                value={CRIT_LABELS[build.critMode]}
                active={configTab}
                onToggle={setConfigTab}
              />
            </nav>
          }
        />

        <ComboBuilder
          combo={build.combo}
          abilities={abilities}
          spellIcons={spellIcons}
          summoners={summonerChips}
          learnedRanks={build.ranks}
          onChange={updateCombo}
          durationSeconds={analysis?.duration}
          linkedStepUid={linkedStepUid}
          pinnedStepUid={pinnedStepUid}
          unusedStepUids={analysis?.unusedSteps}
          onPinStep={(uid) => setPinnedStepUid((current) => (current === uid ? null : uid))}
        />
      </div>

      {/*
       * Simulation settings have no side. They are neither the attacker nor the
       * target, and a fourth panel in one column is exactly what made the two
       * columns stop matching — so this one opens from its tab instead of
       * living in a sidebar.
       */}

      {/*
       * Below the pinned top: configuration on the left, the numbers on the
       * right. On a wide screen every panel is visible at once, which is the
       * point of a workbench — the build and its consequences in one view. The
       * tabs stay useful there as a summary of each panel and as a way to
       * highlight one; below 1280px they go back to switching, because a
       * 380px column plus a readable analysis does not fit.
       */}
      <div className="app-body" ref={bodyRef}>
        <aside className="app-config" data-active={configTab ?? ''} aria-label="Build">
          <div className="config-slot" data-tab="champion" id="config-champion">
            {stats && (
            <ChampionPanel
              detail={champion.detail}
              version={bundle?.version ?? ''}
              championName={VI_MODULE.displayName}
              level={build.level}
              ranks={build.ranks}
              abilities={abilities}
              stats={moment.attacker}
              live={{ shield: moment.shieldGained }}
              previous={moment.previous ? { stats: moment.previous.attacker } : null}
              onLevelChange={(level) => patchBuild({ level })}
              onRankChange={(slot, rank) =>
                patchBuild({ ranks: { ...build.ranks, [slot]: Math.max(0, rank) } })
              }
            />
            )}
          </div>

          {/* Everything below the champion panel, as one block: the three
              columns share a grid row for their first panel and a second row
              for the rest, which is what keeps the two sides level. */}
          <div className="config-rest">
          <div className="config-slot" data-tab="items" id="config-items">
            <ItemPanel
              items={items}
              itemIds={build.itemIds}
              version={bundle?.version ?? ''}
              offline={bundle?.offline ?? true}
              onChange={(itemIds) => patchBuild({ itemIds })}
            />
          </div>

          <div className="config-slot" data-tab="runes" id="config-runes">
            <RunePanel
              trees={bundle?.runeTrees ?? []}
              loadout={build}
              offline={bundle?.offline ?? true}
              onChange={patchBuild}
            />
          </div>

          <div className="config-slot" data-tab="runes" id="config-summoners">
            <SummonerPanel
              summoners={summonerOptions}
              offline={bundle?.offline ?? true}
              loadout={build}
              onChange={patchBuild}
            />
          </div>

          <div className="config-slot" data-tab="sim" id="config-sim">
            <SettingsPanel
              side="attacker"
              critMode={build.critMode}
              timings={build.timings}
              target={build.target}
              onChange={patchBuild}
            />
          </div>

          <div className="config-slot" data-tab="champion">
            <LoadoutNotes
              loadout={build}
              items={items}
              summoners={summonerNames}
              runeTrees={bundle?.runeTrees ?? []}
              title="Vi notes"
            />
          </div>

          </div>
        </aside>

        <main className="app-main">
        {analysis && stats ? (
          <AnalysisPanel
            analysis={analysis}
            target={effectiveTarget}
            moment={moment}
            targetResource={
              build.targetMode === 'champion' && targetStats && targetStats.maxMana > 0
                ? {
                    current: targetStats.maxMana,
                    max: targetStats.maxMana,
                    label: targetProfile.profile?.partype?.toLowerCase() ?? 'mana',
                  }
                : null
            }
            attackerName={VI_MODULE.displayName}
            module={VI_MODULE}
            moduleCtx={moduleCtx}
            abilities={abilities}
            ranks={build.ranks}
            combo={build.combo}
            gameDataStatus={champion.gameDataStatus}
            linkedStepUid={linkedStepUid}
            pinnedStepUid={pinnedStepUid}
            onPinStep={(uid) => setPinnedStepUid((current) => (current === uid ? null : uid))}
          />
        ) : (
          <section className="panel">
            <div className="panel-body">
              <p className="empty-note">
                {patch.loading
                  ? 'Loading champion data …'
                  : 'Nothing can be computed without champion data.'}
              </p>
            </div>
          </section>
        )}
        </main>

        {/*
         * The other side of the fight. Same column treatment as the build, on
         * the far side of the numbers: what you are shooting at, and under which
         * assumptions the shot is simulated.
         */}
        <aside
          className="app-config app-config-target"
          data-active={configTab ?? ''}
          aria-label="Target"
        >
          <div className="config-slot" data-tab="target" id="config-target">
            <TargetPanel
              state={build}
              stats={targetStats}
              live={{
                currentHealth: moment.target.currentHealth,
                armor: moment.target.currentArmor,
                magicResist: moment.target.baseMagicResist,
              }}
              previous={
                moment.previous
                  ? {
                      // A typed target has no champion behind it, so the
                      // comparison carries the same unknowns the sheet does.
                      stats: targetStats ?? unknownStats({}),
                      live: {
                        currentHealth: moment.previous.target.currentHealth,
                        armor: moment.previous.target.currentArmor,
                        magicResist: moment.previous.target.baseMagicResist,
                      },
                    }
                  : null
              }
              champions={bundle?.champions ?? {}}
              profile={targetProfile.profile}
              version={bundle?.version ?? ''}
              onChange={patchBuild}
            />
          </div>

          {/*
           * The target's own gear, in the same panels the attacker uses. Only
           * the stats count for a target, which the note says out loud — a
           * Randuin's on the target soaks nothing here, its 65 armour does.
           */}
          {/* The same grouping as the other side, so both columns have one
              first panel and one block below it. */}
          <div className="config-rest">
          <div className="config-slot" data-tab="target">
            <ItemPanel
              items={items}
              itemIds={build.targetLoadout.itemIds}
              version={bundle?.version ?? ''}
              offline={bundle?.offline ?? true}
              onChange={(itemIds) => patchTargetLoadout({ itemIds })}
            />
          </div>

          <div className="config-slot" data-tab="target">
            <RunePanel
              trees={bundle?.runeTrees ?? []}
              loadout={build.targetLoadout}
              offline={bundle?.offline ?? true}
              onChange={patchTargetLoadout}
            />
          </div>

          <div className="config-slot" data-tab="target">
            <SummonerPanel
              summoners={summonerOptions}
              offline={bundle?.offline ?? true}
              loadout={build.targetLoadout}
              onChange={patchTargetLoadout}
            />
          </div>

          <div className="config-slot" data-tab="sim">
            <SettingsPanel
              side="target"
              critMode={build.critMode}
              timings={build.timings}
              target={build.target}
              onChange={patchBuild}
            />
          </div>

          <div className="config-slot" data-tab="target">
            <LoadoutNotes
              loadout={build.targetLoadout}
              items={items}
              summoners={summonerNames}
              runeTrees={bundle?.runeTrees ?? []}
              title="Target notes"
            />
          </div>

          </div>
        </aside>
      </div>

      <footer className="app-footer">
        <span>
          Champion data, items and rune trees from{' '}
          <a href="https://developer.riotgames.com/docs/lol#data-dragon" rel="noreferrer noopener">
            Riot Data Dragon
          </a>
          {bundle && !bundle.offline ? ` · Patch ${bundle.version}` : ''}
        </span>
        <span className="app-footer-note">
          Not an official Riot Games product. Rune formulas and some ability values are
          maintained constants — see the formula inspector.
        </span>
      </footer>
    </div>
  );
}
