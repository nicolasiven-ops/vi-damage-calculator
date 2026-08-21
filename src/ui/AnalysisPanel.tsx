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
import { StatsView } from './StatsView';
import { TargetHealthBar } from './TargetHealthBar';
import type { ChampionStats } from '../model/stats';
import { CombatantBars } from './CombatantBars';
import { DamageChart } from './DamageChart';
import { Panel } from './components/Panel';

interface Props {
  analysis: ComboAnalysis;
  target: TargetConfig;
  /** The attacker, for the bars that face the target. */
  attackerName: string;
  attackerStats: ChampionStats;
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
  linkedStepUid?: string | null;
  /** The step pinned by clicking, which outlives the cursor. */
  pinnedStepUid?: string | null;
  onHoverStep?: (uid: string | null) => void;
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
  attackerStats,
  module,
  moduleCtx,
  abilities,
  ranks,
  combo,
  gameDataStatus,
  linkedStepUid,
  pinnedStepUid,
  onHoverStep,
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

  return (
    <div className="analysis">
      <Panel className="analysis-main" title="Analysis">
        {/*
         * The two combatants, facing each other across the row.
         *
         * The attacker's health does not move — nothing hits back in this
         * simulation — so its bar carries the shield the combo generates, which
         * is the only thing that does change on that side.
         */}
        <div className="combatant-row">
          <CombatantBars
            name={attackerName}
            side="ally"
            health={{ current: attackerStats.maxHealth, max: attackerStats.maxHealth }}
            shield={analysis.shieldGained}
            resource={
              attackerStats.maxMana > 0
                ? {
                    current: attackerStats.maxMana,
                    max: attackerStats.maxMana,
                    label: 'mana',
                  }
                : null
            }
            note={
              analysis.shieldGained > 0
                ? `${Math.round(attackerStats.maxHealth).toLocaleString('en-US')} + ${Math.round(analysis.shieldGained).toLocaleString('en-US')} shield`
                : undefined
            }
          />

          <CombatantBars
            name={target.name}
            side="enemy"
            health={{ current: analysis.targetHpRemaining, max: startingHealth }}
            resource={null}
            healthFill={
              <TargetHealthBar
                analysis={analysis}
                startingHealth={startingHealth}
                linkedStepUid={linkedStepUid}
              />
            }
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
            className={analysis.killTime !== null ? 'verdict-kill' : 'verdict-survive'}
            label={analysis.killTime !== null ? 'Target dies' : 'Target survives'}
            value={
              analysis.killTime !== null
                ? `${analysis.killTime.toFixed(2)} s`
                : `${Math.round(analysis.targetHpRemaining).toLocaleString('en-US')} HP`
            }
            detail={
              analysis.killTime !== null
                ? `${Math.round(analysis.overkill).toLocaleString('en-US')} overkill — room to spare`
                : `${Math.round(analysis.missingDamage).toLocaleString('en-US')} damage short`
            }
          />
          <Tile
            label="Total damage"
            value={Math.round(analysis.totalMitigated).toLocaleString('en-US')}
            detail={`${Math.round(analysis.totalRaw).toLocaleString('en-US')} pre-mitigation`}
            hero
          />
          <Tile
            label="Damage per second"
            value={Math.round(analysis.dps).toLocaleString('en-US')}
            detail={`over ${analysis.duration.toFixed(2)} s · ${analysis.timeToFirstDamage.toFixed(2)} s run-up`}
          />
          <Tile
            label="Post-mitigation"
            value={`${(analysis.throughput * 100).toFixed(0)}%`}
            detail={`${Math.round(analysis.totalMitigated).toLocaleString('en-US')} of ${Math.round(analysis.totalRaw).toLocaleString('en-US')} got through`}
          />
          <Tile
            label="Mitigated"
            value={Math.round(analysis.absorbed).toLocaleString('en-US')}
            detail={`${((1 - analysis.throughput) * 100).toFixed(0)}% stopped by resistances`}
          />
        </div>

        {(analysis.shieldGained > 0 || analysis.healingDone > 0) && (
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
          </div>
        )}

        <DamageChart
          analysis={analysis}
          targetStartingHealth={startingHealth}
          linkedStepUid={linkedStepUid}
          pinnedStepUid={pinnedStepUid}
          onHoverStep={onHoverStep}
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
            onHoverStep={onHoverStep}
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
            <tbody onMouseLeave={() => onHoverStep?.(null)}>
              {timelineRows.map((row) =>
                row.kind === 'event' ? (
                  <tr
                    key={row.event.id}
                    className={`timeline-event-row${row.event.kind === 'wait' ? ' is-wait' : ''}${
                      linkedStepUid && row.event.stepUid === linkedStepUid ? ' is-linked' : ''
                    }${pinnedStepUid && row.event.stepUid === pinnedStepUid ? ' is-pinned' : ''}`}
                    onMouseEnter={() => onHoverStep?.(row.event.stepUid ?? null)}
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
                  onMouseEnter={() => onHoverStep?.(row.instance.stepUid ?? null)}
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
       * The lower window: the state at a moment, or where the damage came from.
       *
       * Stats leads because it is the one that answers a question about *this*
       * run — what the numbers were when that hit landed. The source breakdown is
       * a summary of the whole combo and does not change while you explore it.
       */}
      {/*
       * Two windows rather than two tabs in one.
       *
       * They answer different questions and get read together: the stats say
       * what the numbers were at a moment, the sources say where the damage came
       * from over the whole combo. Making them share a window meant one was
       * always hidden behind the other.
       */}
      <Panel className="analysis-stats" title="Stats">
        <StatsView
          analysis={analysis}
          combo={combo}
          abilities={abilities}
          pinnedStepUid={pinnedStepUid}
        />
      </Panel>

      <Panel className="analysis-sources" title="Damage sources">
        <SourceBars analysis={analysis} />
        <hr className="divider" />
        <TypeSplit analysis={analysis} />
      </Panel>
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
  detail,
  hero,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={`tile${hero ? ' hero' : ''}${className ? ` ${className}` : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value mono">{value}</span>
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
