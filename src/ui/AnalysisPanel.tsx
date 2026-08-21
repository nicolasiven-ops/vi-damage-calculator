/**
 * The analysis.
 *
 * Reads top-down the way you actually want to know things: does the target die,
 * how much and how fast, where the damage came from, then hit-by-hit detail for
 * anyone who wants to audit it.
 *
 * The source breakdown is deliberately single-hue rather than categorical: it
 * compares magnitudes of named things, and identity is already carried by the
 * row labels. Colour there would encode nothing.
 */

import { useMemo, useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import {
  DAMAGE_TYPE_LABELS,
  type DamageInstance,
  type DamageType,
  type TargetConfig,
  type ComboStep,
  type TimelineEvent,
} from '../engine/types';
import type { AbilitySlot } from '../engine/types';
import type {
  AbilityMeta,
  ChampionModule,
  ChampionModuleContext,
  ValueSource,
} from '../model/champions/types';
import type { GameDataStatus } from '../hooks/usePatchData';
import { ComboTimeline } from './ComboTimeline';
import { CombatantBars } from './CombatantBars';
import type { FightMoment } from './moment';
import { DamageChart } from './DamageChart';
import { Panel } from './components/Panel';

interface Props {
  analysis: ComboAnalysis;
  target: TargetConfig;
  /** The attacker, for the bars that face the target. */
  attackerName: string;
  module: ChampionModule;
  moduleCtx: ChampionModuleContext;
  /** Abilities with names resolved from Data Dragon. */
  abilities: AbilityMeta[];
  ranks: Record<AbilitySlot, number>;
  /** The combo itself, for the timeline's rows. */
  combo: ComboStep[];
  /** Whether Riot's own ability formulas are in use, and why not if they are not. */
  gameDataStatus: GameDataStatus;
  /**
   * The combo step currently under the cursor anywhere in the app.
   *
   * The link runs both ways: hovering a timeline row lights the combo card that
   * caused it, and hovering a card lights every row it produced. A timeline is
   * only readable if you can see which press each line belongs to.
   */
  /**
   * The focused moment, derived once in the app.
   *
   * The two sidebars show the same moment in their stat sheets, so it cannot be
   * a private detail of this panel — three derivations of one thing is three
   * chances to disagree about which step is in focus.
   */
  moment: FightMoment;
  /**
   * The target's resource pool, when it has one.
   *
   * Nothing spends it — the target never acts — but leaving the rail empty said
   * "no resource" about a champion who has one, and the two sides of the row are
   * supposed to be the same frame.
   */
  targetResource?: { current: number; max: number; label: string } | null;
  linkedStepUid?: string | null;
  /** The step pinned by clicking, which outlives the cursor. */
  pinnedStepUid?: string | null;
  /** Toggle the pin on a step — same step again clears it. */
  onPinStep?: (uid: string | null) => void;
}

const TYPE_COLOR: Record<DamageType, string> = {
  physical: 'var(--series-physical)',
  magic: 'var(--series-magic)',
  true: 'var(--series-true)',
};

/** Three sources, three badges — the inspector's whole point is telling them apart. */
const SOURCE_TAGS: Record<ValueSource, { label: string; tone: string }> = {
  gamedata: { label: 'Game data', tone: 'good' },
  ddragon: { label: 'Data Dragon', tone: 'riot' },
  registry: { label: 'Registry', tone: 'gold' },
};

/** Short tags for what kind of thing an event was. */
const EVENT_LABELS: Record<TimelineEvent['kind'], string> = {
  cast: 'Cast',
  shield: 'Shield',
  shred: 'Armor',
  buff: 'Buff',
  info: 'Info',
  warning: 'Note',
  wait: 'Idle',
};

type TimelineRow =
  | { kind: 'damage'; seq: number; instance: DamageInstance }
  | { kind: 'event'; seq: number; event: TimelineEvent };

/**
 * Three views of the same result.
 *
 * Timeline, table and formula inspector describe the same run at different
 * resolutions. Stacked, they would fill the screen without telling anyone
 * more. One window, three tabs.
 */
type ResultView = 'timeline' | 'details' | 'formulas';

const VIEW_TITLES: Record<ResultView, string> = {
  timeline: 'Timeline',
  details: 'Detail view',
  formulas: 'Formula inspector',
};

const STATUS_TAGS: Record<GameDataStatus['state'], { label: string; tone: string }> = {
  idle: { label: 'Game data off', tone: 'gold' },
  loading: { label: 'Game data …', tone: '' },
  ready: { label: 'Game data verified', tone: 'good' },
  rejected: { label: 'Game data rejected', tone: 'danger' },
  failed: { label: 'Game data missing', tone: 'warn' },
};

export function AnalysisPanel({
  analysis,
  target,
  attackerName,
  module,
  moduleCtx,
  abilities,
  ranks,
  combo,
  gameDataStatus,
  moment,
  targetResource,
  linkedStepUid,
  pinnedStepUid,
  onPinStep,
}: Props) {
  const [view, setView] = useState<ResultView>('timeline');

  /**
   * Damage and non-damage events in one chronological list.
   *
   * Both carry a shared sequence number, so a proc that lands at the same
   * instant as the attack that triggered it stays in the order it resolved —
   * which is the only way to read off that the armor shred came last.
   */
  const timelineRows = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [
      ...analysis.curve.map((point) => ({
        kind: 'damage' as const,
        seq: point.instance.seq,
        instance: point.instance,
      })),
      ...analysis.events.map((event) => ({ kind: 'event' as const, seq: event.seq, event })),
    ];
    return rows.sort((a, b) => a.seq - b.seq);
  }, [analysis.curve, analysis.events]);

  const startingHealth = target.maxHealth * target.currentHealthPercent;

  /**
   * The tiles at the moment in focus, not at the end.
   *
   * With a step focused, "total damage" means the damage up to that step and
   * "target dies" means dead by then — otherwise the bars above the tiles would
   * be showing one moment while the numbers under them showed another. Nothing
   * is focused most of the time, and then these are the combo's own figures.
   *
   * Both totals are re-summed from the instances rather than one coming from the
   * snapshot and the other from here, so the percentage below them is a ratio of
   * two numbers measured the same way.
   */
  /**
   * The crowd control worth showing next to the bars.
   *
   * A snapshot is a point in time, and Vi's knock-up ends at exactly the moment
   * her own lock does — so at the instant the focused step is measured, the
   * airborne window has just closed and a point-in-time reading shows nothing.
   * What a reader wants is the window the step opened, so with a step in focus
   * this reports what that step applied and for how long; otherwise it reports
   * whatever is still running at the end.
   */
  const crowdControl = useMemo(() => {
    if (moment.stepUid) {
      return analysis.spans
        .filter((span) => span.lane === 'cc' && span.stepUid === moment.stepUid)
        .map((span) => ({ label: span.label, seconds: span.fullSeconds }));
    }
    return moment.target.crowdControl.map((entry) => ({
      label: entry.label,
      seconds: entry.secondsLeft,
    }));
  }, [analysis, moment]);

  const figures = useMemo(() => {
    const whole = {
      raw: analysis.totalRaw,
      mitigated: analysis.totalMitigated,
      absorbed: analysis.absorbed,
      throughput: analysis.throughput,
      dps: analysis.dps as number | null,
      window: analysis.duration,
      remaining: analysis.targetHpRemaining,
      killed: analysis.killTime !== null,
      killTime: analysis.killTime,
      overkill: analysis.overkill,
      missing: analysis.missingDamage,
      partial: false,
    };
    if (!moment.stepUid) return whole;

    let raw = 0;
    let mitigated = 0;
    for (const point of analysis.curve) {
      // The step's own hits land at its timestamp, so the window includes it.
      if (point.instance.time <= moment.time + 0.0005) {
        raw += point.instance.raw;
        mitigated += point.instance.mitigated;
      }
    }
    const remaining = moment.target.currentHealth;
    const killed = remaining <= 0;
    const window = Math.max(0, moment.time - analysis.timeToFirstDamage);
    return {
      raw,
      mitigated,
      absorbed: raw - mitigated,
      throughput: raw > 0 ? mitigated / raw : 0,
      // At the first hit the window is zero seconds long, and a rate over no
      // time is not a number — better a dash than a confident 0.
      dps: window > 0.01 ? mitigated / window : null,
      window: moment.time,
      remaining: Math.max(0, remaining),
      killed,
      killTime: killed ? analysis.killTime : null,
      overkill: Math.max(0, -remaining),
      missing: Math.max(0, remaining),
      partial: true,
    };
  }, [analysis, moment]);

  return (
    <div className="analysis">
      <Panel className="analysis-main" title="Analysis">
        {/*
         * The two combatants, facing each other across the row, as they stood
         * at the moment in focus.
         */}
        <div className="combatant-row">
          <CombatantBars
            name={attackerName}
            side="ally"
            health={{ current: moment.attacker.maxHealth, max: moment.attacker.maxHealth }}
            shield={moment.shieldGained}
            resource={
              moment.attacker.maxMana > 0
                ? { current: moment.attacker.maxMana, max: moment.attacker.maxMana, label: 'mana' }
                : null
            }
          />

          <CombatantBars
            name={target.name}
            side="enemy"
            health={{ current: moment.target.currentHealth, max: moment.target.maxHealth }}
            lost={moment.targetLostNow}
            resource={targetResource ?? null}
            crowdControl={crowdControl}
          />
        </div>

        {/*
         * The tiles, in the order the questions get asked.
         *
         * "Burst (1 s)" is gone: it answered a question about a window nobody
         * chose, and the timeline now shows *when* damage lands far better than a
         * one-second total ever did. "Throughput" is gone too — it was an invented
         * word for a real thing that League already names: damage is
         * post-mitigation or it is mitigated, and both are worth their own tile.
         */}
        <div className="tile-grid">
          {/*
           * The verdict leads, because it is the answer to the question the
           * page exists for. The bars above show the same thing as a picture;
           * this is it as a sentence you can read in one glance.
           */}
          <Tile
            className={figures.killed ? 'verdict-kill' : 'verdict-survive'}
            label={figures.killed ? 'Target dies' : 'Target survives'}
            /*
             * Measured from the first hit, not from the first press.
             *
             * The run-up — a held Q, a dash, an input delay — is time nobody is
             * taking damage in, and counting it made a fast combo look slow. The
             * suffix says which clock this is, because the two differ by seconds.
             */
            value={
              figures.killed && figures.killTime !== null
                ? `${Math.max(0, figures.killTime - analysis.timeToFirstDamage).toFixed(2)} s`
                : `${Math.round(figures.remaining).toLocaleString('en-US')} HP`
            }
            suffix={figures.killed && figures.killTime !== null ? 'after first impact' : undefined}
            detail={
              figures.killed
                ? `${Math.round(figures.overkill).toLocaleString('en-US')} overkill — room to spare`
                : `${Math.round(figures.missing).toLocaleString('en-US')} damage short${
                    figures.partial ? ' at this point' : ''
                  }`
            }
          />
          <Tile
            label={figures.partial ? 'Damage so far' : 'Total damage'}
            value={Math.round(figures.mitigated).toLocaleString('en-US')}
            detail={`${Math.round(figures.raw).toLocaleString('en-US')} pre-mitigation`}
            hero
          />
          <Tile
            label="Damage per second"
            value={figures.dps === null ? '—' : Math.round(figures.dps).toLocaleString('en-US')}
            detail={`over ${figures.window.toFixed(2)} s · ${analysis.timeToFirstDamage.toFixed(2)} s run-up`}
          />
          <Tile
            label="Post-mitigation"
            value={`${(figures.throughput * 100).toFixed(0)}%`}
            detail={`${Math.round(figures.mitigated).toLocaleString('en-US')} of ${Math.round(figures.raw).toLocaleString('en-US')} got through`}
          />
          <Tile
            label="Mitigated"
            value={Math.round(figures.absorbed).toLocaleString('en-US')}
            detail={`${((1 - figures.throughput) * 100).toFixed(0)}% stopped by resistances`}
          />
        </div>

        {(analysis.shieldGained > 0 ||
          analysis.healingDone > 0 ||
          analysis.targetRegenerated > 0.5) && (
          <div className="sustain-row">
            {analysis.shieldGained > 0 && (
              <span className="sustain-chip">
                <span className="tag good">Shield</span>
                <span className="mono">
                  {Math.round(analysis.shieldGained).toLocaleString('en-US')}
                </span>
              </span>
            )}
            {analysis.healingDone > 0 && (
              <span className="sustain-chip">
                <span className="tag good">Healing</span>
                <span className="mono">
                  {Math.round(analysis.healingDone).toLocaleString('en-US')}
                </span>
              </span>
            )}
            {/* The target's own regeneration, which works against every number
                to its left. */}
            {analysis.targetRegenerated > 0.5 && (
              <span className="sustain-chip">
                <span className="tag warn">Target regenerated</span>
                <span className="mono">
                  {Math.round(analysis.targetRegenerated).toLocaleString('en-US')}
                </span>
              </span>
            )}
          </div>
        )}

        <DamageChart
          analysis={analysis}
          targetStartingHealth={startingHealth}
          linkedStepUid={linkedStepUid}
          pinnedStepUid={pinnedStepUid}
          onPinStep={onPinStep}
        />

        {analysis.warnings.length > 0 && (
          <ul className="warning-list">
            {analysis.warnings.map((warning) => (
              <li key={warning}>
                <span className="tag warn">Hinweis</span> {warning}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Everything under the verdict, as one block: the three columns share
          a grid row for their first panel and a second row for the rest. */}
      <div className="analysis-rest">
      <Panel
        className="analysis-view"
        title={VIEW_TITLES[view]}
        actions={
          <div className="view-tabs">
            {(['timeline', 'details', 'formulas'] as ResultView[]).map((entry) => (
              <button
                key={entry}
                className={`view-tab${view === entry ? ' is-active' : ''}`}
                aria-pressed={view === entry}
                onClick={() => setView(entry)}
              >
                {VIEW_TITLES[entry]}
              </button>
            ))}
          </div>
        }
        center={
          pinnedStepUid ? (
            <button className="btn subtle" onClick={() => onPinStep?.(null)}>
              Clear selection
            </button>
          ) : null
        }
      >
        {view === 'timeline' && (
          <ComboTimeline
            analysis={analysis}
            combo={combo}
            abilities={abilities}
            linkedStepUid={linkedStepUid}
            pinnedStepUid={pinnedStepUid}
            onPinStep={onPinStep}
          />
        )}


        {view === 'formulas' && (
          <FormulaInspector
            module={module}
            moduleCtx={moduleCtx}
            ranks={ranks}
            abilities={abilities}
            gameDataStatus={gameDataStatus}
          />
        )}

        {view === 'details' && (
        <div className="table-scroll">
          <table className="timeline-table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Quelle</th>
                <th>Art</th>
                <th className="numeric">Roh</th>
                <th className="numeric">Effektiv</th>
                <th className="numeric">Ziel-LP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {timelineRows.map((row) =>
                row.kind === 'event' ? (
                  <tr
                    key={row.event.id}
                    className={`timeline-event-row${row.event.kind === 'wait' ? ' is-wait' : ''}${
                      linkedStepUid && row.event.stepUid === linkedStepUid ? ' is-linked' : ''
                    }${pinnedStepUid && row.event.stepUid === pinnedStepUid ? ' is-pinned' : ''}`}
                    onClick={() => onPinStep?.(row.event.stepUid ?? null)}
                  >
                    <td className="mono">{row.event.time.toFixed(2)} s</td>
                    <td>
                      <span className={`timeline-event-kind kind-${row.event.kind}`}>
                        {EVENT_LABELS[row.event.kind]}
                      </span>
                      {row.event.label}
                    </td>
                    <td colSpan={4} className="timeline-event-detail">
                      {row.event.detail}
                    </td>
                  </tr>
                ) : (
                <tr
                  key={row.instance.id}
                  className={
                    `${linkedStepUid && row.instance.stepUid === linkedStepUid ? 'is-linked' : ''}${
                      pinnedStepUid && row.instance.stepUid === pinnedStepUid ? ' is-pinned' : ''
                    }`.trim() || undefined
                  }
                  onClick={() => onPinStep?.(row.instance.stepUid ?? null)}
                >
                  <td className="mono">{row.instance.time.toFixed(2)} s</td>
                  <td>
                    <span
                      className="type-dot"
                      style={{ background: TYPE_COLOR[row.instance.type] }}
                      aria-hidden="true"
                    />
                    {row.instance.sourceLabel}
                  </td>
                  <td>{DAMAGE_TYPE_LABELS[row.instance.type]}</td>
                  <td className="mono numeric">{Math.round(row.instance.raw).toLocaleString('en-US')}</td>
                  <td className="mono numeric strong">
                    {Math.round(row.instance.mitigated).toLocaleString('en-US')}
                  </td>
                  <td className="mono numeric">
                    {Math.round(row.instance.targetHpAfter).toLocaleString('en-US')}
                  </td>
                  <td className="timeline-notes">{row.instance.notes.join(' · ')}</td>
                </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        )}
      </Panel>

      {/*
       * No stats window here any more.
       *
       * It showed the focused moment's numbers in the middle column while the
       * two stat sheets in the sidebars showed the build — so the same question
       * had two answers on one screen, and the fuller one was the one in the
       * corner. The sheets now read the focused moment themselves, with the
       * change from the step before on every row, which is what this window was
       * for. What is left in the middle is what only the middle can hold: where
       * the damage came from, over the whole combo.
       */}
      <Panel className="analysis-sources" title="Damage sources">
        <SourceBars analysis={analysis} />
        <hr className="divider" />
        <TypeSplit analysis={analysis} />
      </Panel>
      </div>
    </div>
  );
}

/**
 * Woher jede Zahl kommt.
 *
 * Eigene Komponente, weil sie ihre eigene Datenquelle hat: nicht das Ergebnis
 * des Durchlaufs, sondern die Werte, mit denen er gerechnet wurde. Sie werden
 * erst berechnet, wenn der Reiter offen ist.
 */
function FormulaInspector({
  module,
  moduleCtx,
  ranks,
  abilities,
  gameDataStatus,
}: {
  module: ChampionModule;
  moduleCtx: ChampionModuleContext;
  ranks: Record<AbilitySlot, number>;
  abilities: AbilityMeta[];
  gameDataStatus: GameDataStatus;
}) {
  const formulaRows = useMemo(
    () => module.describeValues(moduleCtx, ranks),
    [module, moduleCtx, ranks],
  );

  return (
    <>
      <p className="field-hint">
        Every value the simulation computes with, and where it came from.{' '}
        <strong>Game data</strong> means Riot's own spell formula for the selected patch, read
        from the game's <code>bin</code> file via CommunityDragon.{' '}
        <strong>Data Dragon</strong> means straight from Riot's CDN — base stats, item stats,
        cooldowns and costs live there, but ability damage has not for years.{' '}
        <strong>Registry</strong> means a maintained constant in{' '}
        <code>src/model/champions/vi.ts</code>, used only where neither of the other two can
        answer.
      </p>

          <p className="source-status">
            <span className={`tag ${STATUS_TAGS[gameDataStatus.state].tone}`}>
              {STATUS_TAGS[gameDataStatus.state].label}
            </span>{' '}
            {gameDataStatus.patch && (
              <>
                <span className="mono">{gameDataStatus.patch}</span> ·{' '}
              </>
            )}
            {gameDataStatus.message}
          </p>

          <div className="table-scroll">
            <table className="formula-table">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Wert</th>
                  <th>Betrag</th>
                  <th>Formel</th>
                  <th>Quelle</th>
                </tr>
              </thead>
              <tbody>
                {formulaRows.map((row, index) => (
                  <tr key={`${row.slot}-${row.label}-${index}`}>
                    <td>
                      <span className={`slot-chip slot-${row.slot.toLowerCase()}`}>{row.slot}</span>
                    </td>
                    <td>
                      {row.label}
                      {row.note && <span className="formula-note">{row.note}</span>}
                    </td>
                    <td className="mono">{row.value}</td>
                    <td className="mono formula-cell">{row.formula ?? '—'}</td>
                    <td>
                      <span className={`tag ${SOURCE_TAGS[row.source].tone}`}>
                        {SOURCE_TAGS[row.source].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {formulaRows.some((row) => row.source === 'registry') && (
            <p className="field-hint">
              The values marked <strong>Registry</strong> were checked against patch{' '}
              <span className="mono">{module.constantsReviewedPatch}</span>. On another patch they
              may differ — there, what the game data says is what counts.
            </p>
          )}

      <hr className="divider" />
      <div className="ability-notes">
        {abilities.map((ability) => (
          <div className="ability-note" key={ability.slot}>
            <span className={`slot-chip slot-${ability.slot.toLowerCase()}`}>{ability.slot}</span>
            <div>
              <strong>{ability.name}</strong>
              <ul>
                {ability.modelNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  suffix,
  detail,
  hero,
  className,
}: {
  label: string;
  value: string;
  /** Reads with the number rather than under it: "2.77 s after first impact". */
  suffix?: string;
  detail?: string;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={`tile${hero ? ' hero' : ''}${className ? ` ${className}` : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value mono">
        {value}
        {suffix && <span className="tile-suffix">{suffix}</span>}
      </span>
      {detail && <span className="tile-detail">{detail}</span>}
    </div>
  );
}

function SourceBars({ analysis }: { analysis: ComboAnalysis }) {
  const max = analysis.bySource[0]?.mitigated ?? 1;
  if (analysis.bySource.length === 0) {
    return <p className="empty-note">No damage sources.</p>;
  }
  return (
    <div className="source-bars">
      {analysis.bySource.map((source) => (
        <div className="source-bar" key={source.key}>
          <span className="source-name">
            {source.label}
            {source.hits > 1 && <span className="source-hits mono">×{source.hits}</span>}
          </span>
          <div className="source-track">
            <div
              className="source-fill"
              style={{ width: `${Math.max(1.5, (source.mitigated / max) * 100)}%` }}
            />
          </div>
          <span className="source-value mono">
            {Math.round(source.mitigated).toLocaleString('en-US')}
          </span>
          <span className="source-share mono">{(source.share * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function TypeSplit({ analysis }: { analysis: ComboAnalysis }) {
  if (analysis.byType.length === 0) return null;
  return (
    <div className="type-split">
      <div className="type-bar">
        {analysis.byType.map((entry) => (
          <div
            key={entry.type}
            className="type-segment"
            style={{
              width: `${entry.share * 100}%`,
              background: TYPE_COLOR[entry.type],
            }}
            title={`${DAMAGE_TYPE_LABELS[entry.type]}: ${Math.round(entry.mitigated)}`}
          />
        ))}
      </div>
      <div className="type-legend">
        {analysis.byType.map((entry) => (
          <span className="type-legend-item" key={entry.type}>
            <span className="chart-swatch" style={{ background: TYPE_COLOR[entry.type] }} />
            {DAMAGE_TYPE_LABELS[entry.type]}
            <span className="mono">{Math.round(entry.mitigated).toLocaleString('en-US')}</span>
            <span className="mono muted">{(entry.share * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
