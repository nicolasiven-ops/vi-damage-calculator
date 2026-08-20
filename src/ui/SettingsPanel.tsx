/**
 * Simulation settings.
 *
 * These are the knobs that are genuinely uncertain rather than looked up: cast
 * and windup timings are not published by Riot in any machine-readable form, so
 * they live here as editable values instead of hidden magic numbers.
 */

import type { CritMode, TimingConfig } from '../engine/types';
import { DEFAULT_TIMINGS } from '../engine/types';
import { Panel } from './components/Panel';

interface Props {
  critMode: CritMode;
  timings: TimingConfig;
  onChange: (patch: { critMode?: CritMode; timings?: TimingConfig }) => void;
}

const CRIT_LABELS: Record<CritMode, string> = {
  expected: 'Erwartungswert',
  always: 'Immer krit',
  never: 'Nie krit',
};

export function SettingsPanel({ critMode, timings, onChange }: Props) {
  return (
    <Panel index="10" title="Simulation" tight>
      <div className="field">
        <span className="field-label">Kritische Treffer</span>
        <div className="segmented">
          {(Object.keys(CRIT_LABELS) as CritMode[]).map((mode) => (
            <button
              key={mode}
              aria-pressed={critMode === mode}
              onClick={() => onChange({ critMode: mode })}
            >
              {CRIT_LABELS[mode]}
            </button>
          ))}
        </div>
        <span className="field-hint">
          Der Erwartungswert gewichtet jeden Angriff mit der Krit-Chance — das ist der Wert, mit dem
          man Builds vergleicht. „Immer“ und „nie“ zeigen die Ränder.
        </span>
      </div>

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Timing-Konstanten</span>
        <span className="field-hint">
          Riot veröffentlicht Animationszeiten nicht maschinenlesbar. Diese Werte sind Annahmen und
          verschieben nur die Zeitachse, nicht die Schadenssummen.
        </span>
      </div>

      <div className="field-row three">
        <label className="field">
          <span className="field-hint">Angriffs-Windup</span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={0.6}
            value={timings.attackWindup}
            onChange={(event) =>
              onChange({ timings: { ...timings, attackWindup: Number(event.target.value) } })
            }
          />
        </label>
        <label className="field">
          <span className="field-hint">Sprint-Reisezeit</span>
          <input
            type="number"
            step={0.05}
            min={0}
            max={2}
            value={timings.dashTravel}
            onChange={(event) =>
              onChange({ timings: { ...timings, dashTravel: Number(event.target.value) } })
            }
          />
        </label>
        <label className="field">
          <span className="field-hint">Eingabeverzögerung</span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={0.5}
            value={timings.inputDelay}
            onChange={(event) =>
              onChange({ timings: { ...timings, inputDelay: Number(event.target.value) } })
            }
          />
        </label>
      </div>

      <button
        className="btn subtle"
        onClick={() => onChange({ timings: { ...DEFAULT_TIMINGS } })}
      >
        Timings zurücksetzen
      </button>
    </Panel>
  );
}
