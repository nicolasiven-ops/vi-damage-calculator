/**
 * Simulation settings.
 *
 * These are the knobs that are genuinely uncertain rather than looked up: cast
 * and wind-up timings are not published by Riot in any machine-readable form,
 * so they live here as editable values instead of hidden magic numbers.
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
  expected: 'Expected value',
  always: 'Always crit',
  never: 'Never crit',
};

export function SettingsPanel({ critMode, timings, onChange }: Props) {
  return (
    <Panel title="Simulation" tight>
      <div className="field">
        <span className="field-label">Critical strikes</span>
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
          The expected value weights every attack by critical strike chance — that is the number you
          compare builds with. “Always” and “never” show the two extremes.
        </span>
      </div>

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Timing constants</span>
        <span className="field-hint">
          Riot does not publish animation timings in machine-readable form. These values are
          assumptions and only shift the timeline, not the damage totals.
        </span>
      </div>

      <div className="field-row three">
        <label className="field">
          <span className="field-hint">Attack wind-up</span>
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
          <span className="field-hint">Dash travel time</span>
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
          <span className="field-hint">Input delay</span>
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
        Reset timings
      </button>
    </Panel>
  );
}
