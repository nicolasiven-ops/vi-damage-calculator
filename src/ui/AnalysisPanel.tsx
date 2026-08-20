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

import { useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import { DAMAGE_TYPE_LABELS, type DamageType, type TargetConfig } from '../engine/types';
import type { AbilitySlot } from '../engine/types';
import type {
  AbilityMeta,
  ChampionModule,
  ChampionModuleContext,
  ValueSource,
} from '../model/champions/types';
import type { GameDataStatus } from '../hooks/usePatchData';
import { DamageChart } from './DamageChart';
import { Panel } from './components/Panel';

interface Props {
  analysis: ComboAnalysis;
  target: TargetConfig;
  module: ChampionModule;
  moduleCtx: ChampionModuleContext;
  /** Abilities with names resolved from Data Dragon. */
  abilities: AbilityMeta[];
  ranks: Record<AbilitySlot, number>;
  /** Whether Riot's own ability formulas are in use, and why not if they are not. */
  gameDataStatus: GameDataStatus;
}

const TYPE_COLOR: Record<DamageType, string> = {
  physical: 'var(--series-physical)',
  magic: 'var(--series-magic)',
  true: 'var(--series-true)',
};

/** Three sources, three badges — the inspector's whole point is telling them apart. */
const SOURCE_TAGS: Record<ValueSource, { label: string; tone: string }> = {
  gamedata: { label: 'Spieldaten', tone: 'good' },
  ddragon: { label: 'Data Dragon', tone: 'riot' },
  registry: { label: 'Registry', tone: 'gold' },
};

const STATUS_TAGS: Record<GameDataStatus['state'], { label: string; tone: string }> = {
  idle: { label: 'Spieldaten aus', tone: 'gold' },
  loading: { label: 'Spieldaten …', tone: '' },
  ready: { label: 'Spieldaten geprüft', tone: 'good' },
  rejected: { label: 'Spieldaten verworfen', tone: 'danger' },
  failed: { label: 'Spieldaten fehlen', tone: 'warn' },
};

export function AnalysisPanel({
  analysis,
  target,
  module,
  moduleCtx,
  abilities,
  ranks,
  gameDataStatus,
}: Props) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const formulaRows = showFormulas ? module.describeValues(moduleCtx, ranks) : [];

  const startingHealth = target.maxHealth * target.currentHealthPercent;
  const kills = analysis.killTime !== null;

  return (
    <div className="analysis">
      <Panel
        index="06"
        title="Analyse"
        actions={
          <div className="analysis-header-actions">
            <button className="btn subtle" onClick={() => setShowFormulas((value) => !value)}>
              Formeln
            </button>
            <button className="btn subtle" onClick={() => setShowTimeline((value) => !value)}>
              {showTimeline ? 'Zeitachse ausblenden' : 'Zeitachse'}
            </button>
          </div>
        }
      >
        <div className={`verdict ${kills ? 'kill' : 'survive'}`}>
          <span className="verdict-icon">{kills ? '✦' : '◇'}</span>
          <div className="verdict-body">
            <strong>
              {kills
                ? `Ziel stirbt nach ${analysis.killTime!.toFixed(2)} s`
                : `Ziel überlebt mit ${Math.round(analysis.targetHpRemaining).toLocaleString('de-DE')} LP`}
            </strong>
            <span>
              {kills
                ? `${Math.round(analysis.overkill).toLocaleString('de-DE')} Schaden Überschuss — die Combo hat Reserve.`
                : `Es fehlen ${Math.round(analysis.missingDamage).toLocaleString('de-DE')} Schaden.`}
            </span>
          </div>
        </div>

        <div className="tile-grid">
          <Tile
            label="Gesamtschaden"
            value={Math.round(analysis.totalMitigated).toLocaleString('de-DE')}
            detail={`${Math.round(analysis.totalRaw).toLocaleString('de-DE')} vor Widerständen`}
            hero
          />
          <Tile
            label="Burst (1 s)"
            value={Math.round(analysis.burst1s).toLocaleString('de-DE')}
            detail={`${Math.round(analysis.burst3s).toLocaleString('de-DE')} in 3 s · ab 1. Treffer`}
          />
          <Tile
            label="Schaden pro Sekunde"
            value={Math.round(analysis.dps).toLocaleString('de-DE')}
            detail={`über ${analysis.duration.toFixed(2)} s · ${analysis.timeToFirstDamage.toFixed(2)} s Anlauf`}
          />
          <Tile
            label="Durchsatz"
            value={`${(analysis.throughput * 100).toFixed(0)} %`}
            detail={`${Math.round(analysis.absorbed).toLocaleString('de-DE')} absorbiert`}
          />
          <Tile
            label="Treffer"
            value={String(analysis.hitCount)}
            detail={
              analysis.largestHit
                ? `größter: ${Math.round(analysis.largestHit.mitigated).toLocaleString('de-DE')} (${analysis.largestHit.sourceLabel})`
                : undefined
            }
          />
          <Tile
            label="Effektives Leben"
            value={Math.round(analysis.effectiveHealth.vsThisCombo).toLocaleString('de-DE')}
            detail={`gegen diese Schadensmischung`}
          />
        </div>

        {(analysis.shieldGained > 0 || analysis.healingDone > 0) && (
          <div className="sustain-row">
            {analysis.shieldGained > 0 && (
              <span className="sustain-chip">
                <span className="tag good">Schild</span>
                <span className="mono">
                  {Math.round(analysis.shieldGained).toLocaleString('de-DE')}
                </span>
              </span>
            )}
            {analysis.healingDone > 0 && (
              <span className="sustain-chip">
                <span className="tag good">Heilung</span>
                <span className="mono">
                  {Math.round(analysis.healingDone).toLocaleString('de-DE')}
                </span>
              </span>
            )}
          </div>
        )}

        <DamageChart analysis={analysis} targetStartingHealth={startingHealth} />

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

      <Panel index="07" title="Schadensquellen">
        <SourceBars analysis={analysis} />
        <hr className="divider" />
        <TypeSplit analysis={analysis} />
      </Panel>

      {showTimeline && (
        <Panel index="08" title="Zeitachse">
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
                {analysis.curve.map((point) => (
                  <tr key={point.instance.id}>
                    <td className="mono">{point.instance.time.toFixed(2)} s</td>
                    <td>
                      <span
                        className="type-dot"
                        style={{ background: TYPE_COLOR[point.instance.type] }}
                        aria-hidden="true"
                      />
                      {point.instance.sourceLabel}
                    </td>
                    <td>{DAMAGE_TYPE_LABELS[point.instance.type]}</td>
                    <td className="mono numeric">{Math.round(point.instance.raw).toLocaleString('de-DE')}</td>
                    <td className="mono numeric strong">
                      {Math.round(point.instance.mitigated).toLocaleString('de-DE')}
                    </td>
                    <td className="mono numeric">
                      {Math.round(point.instance.targetHpAfter).toLocaleString('de-DE')}
                    </td>
                    <td className="timeline-notes">{point.instance.notes.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {showFormulas && (
        <Panel index="09" title="Formel-Inspektor">
          <p className="field-hint">
            Jeder Wert, mit dem die Simulation rechnet, und woher er stammt.{' '}
            <strong>Spieldaten</strong> heißt: Riots eigene Fähigkeitsformel für den gewählten
            Patch, gelesen aus der <code>bin</code>-Datei des Spiels über CommunityDragon.{' '}
            <strong>Data Dragon</strong> heißt: direkt von Riots CDN — dort stehen Basiswerte,
            Item-Werte, Abklingzeiten und Kosten, aber seit Jahren kein Fähigkeitsschaden mehr.{' '}
            <strong>Registry</strong> heißt: gepflegte Konstante in{' '}
            <code>src/model/champions/vi.ts</code>, verwendet nur dort, wo die beiden anderen
            nichts liefern.
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
              Die als <strong>Registry</strong> markierten Werte sind gegen Patch{' '}
              <span className="mono">{module.constantsReviewedPatch}</span> geprüft. Für einen
              anderen Patch können sie abweichen — dort gilt, was in den Spieldaten steht.
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
        </Panel>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
  hero,
}: {
  label: string;
  value: string;
  detail?: string;
  hero?: boolean;
}) {
  return (
    <div className={`tile${hero ? ' hero' : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value mono">{value}</span>
      {detail && <span className="tile-detail">{detail}</span>}
    </div>
  );
}

function SourceBars({ analysis }: { analysis: ComboAnalysis }) {
  const max = analysis.bySource[0]?.mitigated ?? 1;
  if (analysis.bySource.length === 0) {
    return <p className="empty-note">Keine Schadensquellen.</p>;
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
            {Math.round(source.mitigated).toLocaleString('de-DE')}
          </span>
          <span className="source-share mono">{(source.share * 100).toFixed(1)} %</span>
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
            <span className="mono">{Math.round(entry.mitigated).toLocaleString('de-DE')}</span>
            <span className="mono muted">{(entry.share * 100).toFixed(0)} %</span>
          </span>
        ))}
      </div>
    </div>
  );
}
