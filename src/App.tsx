import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LOCALE } from './data/ddragon';
import { analyse } from './engine/analysis';
import { simulate } from './engine/simulate';
import type { AbilitySlot, ComboStep } from './engine/types';
import { VI_MODULE } from './model/champions/vi';
import { resolveAbilityNames, type ChampionModuleContext } from './model/champions/types';
import { resolveAllItems, resolvePurchasableItems } from './model/items';
import { runeStats } from './model/runes';
import {
  emptyStats,
  resolveChampionStats,
  sumStats,
  withPublishedGrowth,
} from './model/stats';
import { prepareRun, resolveBonusStats, runBuild } from './state/runBuild';
import { clearSkill, resolveSkills, skillDown, skillUp } from './model/skills';
import { itemValues, type ItemValueRow } from './model/itemValue';
import { EMPTY_CHANGE_LOG, buildOf, recordChange } from './state/changeLog';
import { solveFastestKill, type SolverAction, type SolverResult } from './model/comboSolver';
import { isSummonerSimulated } from './model/summoners';
import { ComboModes } from './ui/ComboModes';
import {
  statGoldRates,
  statPriceTable,
  statValues,
  type StatValueRow,
} from './model/statValue';
import { itemVerdict } from './model/itemDecisions';
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
import { fightMoment, fightMomentAt } from './ui/moment';
import { timeWindowOf } from './ui/timeAxis';
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
  /**
   * The playback clock, in seconds since the combo started.
   *
   * Null when nothing is running. While it runs it replaces the click as the
   * thing that picks the moment, so every panel reads the same instant and the
   * whole page moves — the combo is played rather than inspected.
   */
  /**
   * Playback: where the clock stands, and whether it is moving.
   *
   * Two pieces of state rather than one, so pausing can hold the moment. A
   * single nullable position had to throw the moment away to stop.
   */
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const patch = usePatchData(DEFAULT_LOCALE);
  const bundle = patch.bundle;

  const champion = useChampionDetail(
    bundle?.version ?? null,
    bundle?.locale ?? DEFAULT_LOCALE,
    build.championId,
    bundle?.offline ?? true,
  );

  /**
   * The patch to compare against, once someone asks for one.
   *
   * Null until then: a comparison costs a second champion file and a second bin
   * file, and nobody should pay for that on every load. The hook takes null and
   * fetches nothing, which is what makes "lazy" a two-line feature here.
   */
  const [comparePatch, setComparePatch] = useState<string | null>(null);
  /**
   * The patches worth comparing against: everything older than the current one.
   *
   * Capped at a couple of seasons' worth — the list is hundreds long, and a
   * comparison against a patch from three years ago is a different question than
   * this control is for.
   */
  const comparableVersions = useMemo(() => {
    const index = patch.versions.indexOf(bundle?.version ?? '');
    if (index < 0) return [];
    return patch.versions.slice(index + 1, index + 41);
  }, [patch.versions, bundle?.version]);

  const before = useChampionDetail(
    comparePatch,
    bundle?.locale ?? DEFAULT_LOCALE,
    build.championId,
    false,
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
  /**
   * The lookup every stat calculation uses — built from *all* items, not just
   * the ones the shop offers.
   *
   * The picker above is filtered; this is not, and the difference is deliberate:
   * item passives are keyed off a build's ids and fire for any id, so resolving
   * stats only for purchasable items handed those ids their passive without
   * their stat line. See `resolveAllItems`.
   */
  const itemById = useMemo(
    () =>
      new Map(
        (bundle ? resolveAllItems(bundle.items) : items).map((item) => [item.id, item]),
      ),
    [bundle, items],
  );

  /**
   * What the skill order comes to at this level.
   *
   * Ranks are read here and nowhere else, so there is one answer to "what rank is
   * W" and it is always one the level can pay for. The maximums come from the
   * champion's own metadata rather than a constant, because a champion is allowed
   * to disagree — Udyr has six ranks, Jayce one.
   */
  const maxRanks = useMemo(() => {
    const caps: Partial<Record<AbilitySlot, number>> = {};
    for (const ability of VI_MODULE.abilities) caps[ability.slot] = ability.maxRank;
    return caps;
  }, []);

  const skills = useMemo(
    () => resolveSkills(build.skillOrder, build.level, maxRanks),
    [build.skillOrder, build.level, maxRanks],
  );
  const ranks = skills.ranks;

  /*
   * Data Dragon's numbers, with the attack-damage growth it no longer ships put
   * back from Riot's own character record — see `withPublishedGrowth`.
   */
  const publishedStats =
    champion.detail?.stats ?? bundle?.champions[build.championId]?.stats ?? null;
  const baseStats = useMemo(
    () =>
      publishedStats
        ? withPublishedGrowth(publishedStats, champion.gameData?.attackDamagePerLevel ?? null)
        : null,
    [publishedStats, champion.gameData],
  );

  const moduleCtx: ChampionModuleContext = useMemo(
    () => ({
      detail: champion.detail,
      spellById: champion.spellById,
      gameData: champion.gameData,
    }),
    [champion.detail, champion.spellById, champion.gameData],
  );

  /**
   * The build's bonus stats, through the shared pipeline.
   *
   * Shared with every counterfactual run (see `runBuild.ts`), so "the same combo
   * without this item" really is the same rules with one item missing.
   */
  const bonusStats = useMemo(() => {
    if (!baseStats) return emptyStats();
    return resolveBonusStats(
      {
        baseStats,
        level: build.level,
        itemIds: activeItemIds(build),
        runeIds: activeRuneIds(build),
        shardIds: activeShardIds(build),
        manualStats: build.manualStats,
      },
      itemById,
    );
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
          ranks,
          itemIds: activeItemIds(build),
          runeIds: activeRuneIds(build),
          shardIds: activeShardIds(build),
          summonerIds: activeSummonerIds(build),
          manualStats: build.manualStats,
          // How hurt Vi already is: an input, read by a lifeline and a
          // missing-health ramp.
          currentHealthPercent: build.attackerHealthPercent,
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

  /**
   * What every item in the build contributes, by taking it out and re-running.
   *
   * Six extra simulations per change, which is a fraction of a millisecond each
   * — the measurement is cheap; it is the *comparability* that had to be built,
   * and that is `runBuild`. Empty until there is a build to weigh.
   */
  const itemValueRows = useMemo<ItemValueRow[]>(() => {
    if (!baseStats || !analysis) return [];
    const ids = activeItemIds(build);
    if (ids.length === 0) return [];

    const inputs = {
      baseStats,
      level: build.level,
      ranks,
      itemIds: ids,
      runeIds: activeRuneIds(build),
      shardIds: activeShardIds(build),
      summonerIds: activeSummonerIds(build),
      manualStats: build.manualStats,
      attackerHealthPercent: build.attackerHealthPercent,
      championId: build.championId,
      combo: build.combo,
      timings: build.timings,
      critMode: build.critMode,
      target: effectiveTarget,
    };

    return itemValues({
      items: ids.map((id) => {
        const item = itemById.get(id);
        return {
          id,
          name: item?.name ?? id,
          imageFile: item?.imageFile ?? '',
          gold: item?.gold ?? 0,
        };
      }),
      base: analysis,
      runWithout: (itemId) =>
        runBuild(
          { ...inputs, itemIds: ids.filter((entry) => entry !== itemId) },
          itemById,
          VI_MODULE,
          moduleCtx,
        ).analysis,
      isModelled: (itemId) => itemVerdict(itemId).kind === 'modelled',
    });
  }, [analysis, baseStats, build, effectiveTarget, itemById, moduleCtx]);

  /** The shop's own price per point of each stat, for the value column. */
  const goldRates = useMemo(() => statGoldRates(items), [items]);
  /** The same prices as a table, for the reference window. */
  const statPriceRows = useMemo(() => statPriceTable(goldRates), [goldRates]);

  /**
   * What each stat is worth to this combo — one run per stat, twice.
   *
   * Once for a small step (the per-point reading) and once for a thousand gold's
   * worth (the reading that decides a purchase). About twenty extra simulations
   * per change, which is still under a millisecond each, and all of them go
   * through the same `runBuild` as the build on screen so the differences are
   * differences.
   */
  const statValueRows = useMemo<StatValueRow[]>(() => {
    if (!baseStats || !analysis) return [];

    const inputs = {
      baseStats,
      level: build.level,
      ranks,
      itemIds: activeItemIds(build),
      runeIds: activeRuneIds(build),
      shardIds: activeShardIds(build),
      summonerIds: activeSummonerIds(build),
      manualStats: build.manualStats,
      attackerHealthPercent: build.attackerHealthPercent,
      championId: build.championId,
      combo: build.combo,
      timings: build.timings,
      critMode: build.critMode,
      target: effectiveTarget,
    };

    return statValues({
      base: analysis,
      rates: goldRates,
      run: (bonus) =>
        runBuild(
          {
            ...inputs,
            // Probed on top of whatever was typed by hand, because "one more
            // point" means one more than the build actually has.
            manualStats: sumStats([build.manualStats, bonus]),
          },
          itemById,
          VI_MODULE,
          moduleCtx,
        ).analysis,
    });
  }, [analysis, baseStats, build, effectiveTarget, goldRates, itemById, moduleCtx]);

  /**
   * The presses the engine declined, by step, with its own sentence.
   *
   * Derived rather than passed around: the strip needs a lookup and the engine
   * reports a list, and the conversion belongs where the two meet.
   */
  const refusedSteps = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const fate of analysis?.stepFates ?? []) {
      if (fate.fate === 'refused' && fate.why) out[fate.uid] = fate.why;
    }
    return out;
  }, [analysis]);

  /**
   * The log of what changed and what it did.
   *
   * Filled from an effect rather than from the controls: every edit in this app
   * goes through `patchBuild`, but the *result* of an edit is only known after the
   * simulation has run, so the entry is written when the pair (build, damage)
   * moves. `recordChange` returns the same object when nothing moved, which is
   * what keeps this from looping.
   */
  const [changeLog, setChangeLog] = useState(EMPTY_CHANGE_LOG);
  const lastRun = useRef<{ build: BuildState; damage: number; killed: boolean } | null>(null);

  useEffect(() => {
    if (!analysis) return;
    const current = {
      build,
      damage: analysis.totalMitigated,
      killed: analysis.killTime !== null,
    };
    const previous = lastRun.current;
    lastRun.current = current;
    if (!previous) return;

    setChangeLog((log) =>
      recordChange({
        log,
        previous,
        current,
        nameOf: (itemId) => itemById.get(itemId)?.name ?? itemId,
      }),
    );
  }, [analysis, build, itemById]);

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
  const moment = useMemo(() => {
    const fallback = {
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
    };
    return playhead !== null
      ? fightMomentAt(analysis, playhead, fallback)
      : fightMoment(analysis, pinnedStepUid, fallback);
  }, [analysis, playhead, pinnedStepUid, stats, effectiveTarget]);

  /*
   * What is highlighted: the step the clock is in, or the one you clicked.
   *
   * Derived after the moment rather than before it, because during playback the
   * moment is what decides the step and not the other way round.
   */
  const linkedStepUid = playhead !== null ? moment.stepUid : pinnedStepUid;

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

  /**
   * Playback, on the real clock.
   *
   * One frame at a time from the browser's own animation loop, so a two-second
   * combo takes two seconds. It stops itself at the end — a run that has to be
   * stopped by hand is a run you have to watch instead of read.
   */
  useEffect(() => {
    if (!playing || playhead === null || !analysis) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const delta = (now - last) / 1000;
      last = now;
      setPlayhead((current) => {
        if (current === null) return null;
        const next = current + delta;
        // At the end the run lets go of the moment entirely, so the panel goes
        // back to reading the whole combo rather than freezing on its last step.
        if (next >= analysis.duration) {
          setPlaying(false);
          return null;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Restarting on every playhead change would reset the frame clock, so this
    // depends on whether playback is running rather than on where it has got to.
  }, [playing, playhead !== null, analysis]);

  /**
   * The same combo, on the other patch's numbers.
   *
   * Nothing about the build changes: same items, same runes, same ranks, same
   * steps. Only the champion's own values come from the older files — base
   * stats, ability formulas, cooldowns — which is exactly the question "what did
   * the patch do to *my* build" asks.
   */
  const patchComparison = useMemo(() => {
    if (!comparePatch || !before.detail || !analysis || !baseStats) return null;
    const beforeStats = resolveChampionStats(before.detail.stats, build.level, bonusStats);
    const beforeCtx: ChampionModuleContext = {
      detail: before.detail,
      spellById: before.spellById,
      gameData: before.gameData,
    };
    const result = simulate(
      {
        attacker: {
          championId: build.championId,
          level: build.level,
          ranks,
          itemIds: activeItemIds(build),
          runeIds: activeRuneIds(build),
          shardIds: activeShardIds(build),
          summonerIds: activeSummonerIds(build),
          manualStats: build.manualStats,
        },
        championBaseStats: before.detail.stats,
        attackerStats: beforeStats,
        bonusStats,
        target: effectiveTarget,
        combo: build.combo,
        timings: build.timings,
        critMode: build.critMode,
      },
      VI_MODULE,
      beforeCtx,
    );
    const then = analyse(result, effectiveTarget, beforeStats);
    /*
     * Which of the champion's own values moved. The module can describe its
     * numbers per patch, so the diff is a comparison of two descriptions rather
     * than a guess about what Riot touched.
     */
    const nowValues = VI_MODULE.describeValues?.(moduleCtx, ranks) ?? [];
    const thenValues = VI_MODULE.describeValues?.(beforeCtx, ranks) ?? [];
    const changes = nowValues
      .map((entry) => {
        const older = thenValues.find(
          (candidate) => candidate.slot === entry.slot && candidate.label === entry.label,
        );
        // The module formats its own values, so the comparison is of what it
        // would have printed then against what it prints now.
        if (!older || older.value === entry.value) return null;
        return { slot: entry.slot, label: entry.label, from: older.value, to: entry.value };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      patch: comparePatch,
      damageThen: then.totalMitigated,
      damageNow: analysis.totalMitigated,
      killedThen: then.killTime !== null,
      killedNow: analysis.killTime !== null,
      changes,
      loading: before.loading,
    };
  }, [
    comparePatch,
    before.detail,
    before.spellById,
    before.gameData,
    before.loading,
    analysis,
    baseStats,
    bonusStats,
    build,
    effectiveTarget,
    moduleCtx,
  ]);

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
  /**
   * What the solver is allowed to press.
   *
   * Built from the build rather than hardcoded: an ability nobody has put a point
   * in is not an option, a summoner nobody took is not an option, and a
   * chargeable ability is three options rather than one — held for nothing, held
   * halfway, held to the end. Those three are the interesting part: the order
   * matters far less than whether Vault Breaker was worth the second and a half.
   */
  const solverActions = useMemo<SolverAction[]>(() => {
    const actions: SolverAction[] = [
      { id: 'aa', label: 'AA', make: (uid) => ({ uid, action: { kind: 'attack' } }) },
    ];

    for (const ability of abilities) {
      if (!ability.castable) continue;
      if ((ranks[ability.slot] ?? 0) < 1) continue;

      const charge = ability.chargeable?.maxSeconds;
      if (charge === undefined) {
        actions.push({
          id: ability.slot,
          label: ability.slot,
          make: (uid) => ({ uid, action: { kind: 'ability', slot: ability.slot } }),
        });
        continue;
      }

      const holds: [string, number][] = [
        [`${ability.slot} tap`, 0],
        [`${ability.slot} half`, Math.round(charge * 50) / 100],
        [`${ability.slot} full`, charge],
      ];
      for (const [label, seconds] of holds) {
        actions.push({
          id: label,
          label,
          make: (uid) => ({
            uid,
            action: { kind: 'ability', slot: ability.slot },
            chargeSeconds: seconds,
          }),
        });
      }
    }

    for (const summonerId of activeSummonerIds(build)) {
      const name = summonerNames[summonerId];
      if (!name) continue;
      /*
       * Only the ones the engine can actually resolve. Flash is a summoner and a
       * press, and it deals nothing — offering it to the search means every answer
       * comes back padded with Flashes that change no number and no time.
       */
      if (!isSummonerSimulated(summonerId)) continue;
      actions.push({
        id: summonerId,
        label: name,
        make: (uid) => ({ uid, action: { kind: 'summoner', summonerId } }),
      });
    }

    return actions;
  }, [abilities, build, summonerNames]);

  /**
   * The search, run against the same pipeline as everything else.
   *
   * `runBuild` is what the item and stat ledgers use, so a combo the solver calls
   * fastest is fastest by the app's own arithmetic — there is no second model to
   * disagree with.
   */
  const solveCombo = useCallback((keepTyped: boolean): SolverResult => {
    if (!baseStats) {
      return { best: null, runnersUp: [], simulations: 0, hitLimit: false };
    }

    const inputs = {
      baseStats,
      level: build.level,
      ranks,
      itemIds: activeItemIds(build),
      runeIds: activeRuneIds(build),
      shardIds: activeShardIds(build),
      summonerIds: activeSummonerIds(build),
      manualStats: build.manualStats,
      attackerHealthPercent: build.attackerHealthPercent,
      championId: build.championId,
      timings: build.timings,
      critMode: build.critMode,
      target: effectiveTarget,
    };

    // Resolved once, then one simulation per candidate: see `prepareRun`.
    const run = prepareRun(
      { ...inputs, combo: [] },
      itemById,
      VI_MODULE,
      moduleCtx,
    );

    return solveFastestKill({
      actions: solverActions,
      startingHealth: effectiveTarget.maxHealth * effectiveTarget.currentHealthPercent,
      run,
      ...(keepTyped ? { prefix: build.combo } : {}),
    });
  }, [baseStats, build, effectiveTarget, itemById, moduleCtx, solverActions]);

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
          comparableVersions={comparableVersions}
          comparison={patchComparison}
          onCompare={setComparePatch}
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
          learnedRanks={ranks}
          onChange={updateCombo}
          durationSeconds={analysis?.duration}
          linkedStepUid={linkedStepUid}
          pinnedStepUid={pinnedStepUid}
          unusedStepUids={analysis?.unusedSteps}
          refusedSteps={refusedSteps}
          modes={
            <ComboModes
              disabled={!baseStats}
              onSolve={() => solveCombo(false)}
              onComplete={() => solveCombo(true)}
              typedLength={build.combo.length}
              onApply={(result) => {
                if (result.best) patchBuild({ combo: result.best.steps });
              }}
            />
          }
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
              ranks={ranks}
              abilities={abilities}
              stats={moment.attacker}
              readiness={Object.fromEntries(
                moment.abilities.map((entry) => [
                  entry.slot,
                  { readyIn: entry.readyIn, cooldown: entry.cooldown, charges: entry.charges },
                ]),
              )}
              live={{ shield: moment.shieldGained }}
              previous={moment.previous ? { stats: moment.previous.attacker } : null}
              onLevelChange={(level) => patchBuild({ level })}
              /*
               * One point per click, and past the last rank it clears the ability
               * — the same gesture as before, now spending from a budget. The
               * strip refuses what cannot be paid for and says why, rather than
               * silently doing nothing.
               */
              points={{ spent: skills.spent, available: skills.available, held: skills.held }}
              onSkillUp={(slot) =>
                patchBuild({ skillOrder: skillUp(build.skillOrder, build.level, slot, maxRanks) })
              }
              onSkillDown={(slot) =>
                patchBuild({ skillOrder: skillDown(build.skillOrder, slot) })
              }
              onSkillClear={(slot) =>
                patchBuild({ skillOrder: clearSkill(build.skillOrder, slot) })
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
              attackerHealthPercent={build.attackerHealthPercent}
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
            playState={playing ? 'running' : playhead !== null ? 'paused' : 'idle'}
            playhead={playhead}
            onTogglePlay={() => {
              if (playing) {
                // Pause: the clock stops, the moment stays where it was.
                setPlaying(false);
                return;
              }
              setPlaying(true);
              if (playhead !== null) return; // continue from where it was held
              // Starting playback lets go of the pin: two things claiming the
              // moment at once is the one state that reads as a bug.
              setPinnedStepUid(null);
              /*
               * Start where the views start, not at zero. A fully charged Q
               * spends a second and a half before anything lands, and the plots
               * cut that run-up off — so beginning at zero meant watching an
               * empty graph while the clock ran somewhere off-screen.
               */
              setPlayhead(timeWindowOf(analysis.timeToFirstDamage, analysis.duration).start);
            }}
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
            ranks={ranks}
            combo={build.combo}
            gameDataStatus={champion.gameDataStatus}
            itemValueRows={itemValueRows}
            statValueRows={statValueRows}
            statPriceRows={statPriceRows}
            changeLog={changeLog.entries}
            onRestoreBuild={(id) => {
              const restored = buildOf(changeLog, id);
              if (restored) setBuild(restored);
            }}
            patchVersion={bundle?.version ?? ""}
            linkedStepUid={linkedStepUid}
            pinnedStepUid={pinnedStepUid}
            onPinStep={(uid) => {
              /*
               * Clicking a step is the way out of a held run: the pin and the
               * playhead both claim the focused moment, so taking the pin means
               * letting the clock go.
               */
              if (!playing && playhead !== null) setPlayhead(null);
              setPinnedStepUid((current) => (current === uid ? null : uid));
            }}
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
