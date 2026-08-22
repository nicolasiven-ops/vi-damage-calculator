/**
 * Simulation settings.
 *
 * These are the knobs that are genuinely uncertain rather than looked up: cast
 * and wind-up timings are not published by Riot in any machine-readable form,
 * so they live here as editable values instead of hidden magic numbers.
 */

import type { CritMode, TargetConfig, TimingConfig } from '../engine/types';
import { DEFAULT_TIMINGS } from '../engine/types';
import { Panel } from './components/Panel';

interface Props {
  /**
   * Which side this panel belongs to.
   *
   * Both sidebars carry one, and each shows what applies to its own side: the
   * attacker decides how crits are counted and how long its animations take,
   * the target how hurt it already is and what soaks damage on top of
   * resistances.
   */
  side: 'attacker' | 'target';
  critMode: CritMode;
  /** The attacker's own health, as a fraction — the attacker side's own figure. */
  attackerHealthPercent?: number;
  timings: TimingConfig;
  /**
   * The target's situational state, which belongs to the moment rather than to
   * the target: how hurt it already is, and what soaks damage on top of
   * resistances. Who the target *is* lives in its own panel.
   */
  target: TargetConfig;
  onChange: (patch: {
    critMode?: CritMode;
    timings?: TimingConfig;
    target?: TargetConfig;
    attackerHealthPercent?: number;
  }) => void;
}

/*
 * Three short words, so the row is one line — the target's side has "Champ /
 * Minion / Monster" in the same place, and a wrapping control on one side alone
 * makes the two panels different heights.
 */
const CRIT_LABELS: Record<CritMode, string> = {
  expected: 'Expected',
  always: 'Always',
  never: 'Never',
};

export function SettingsPanel({
  side,
  critMode,
  timings,
  target,
  attackerHealthPercent = 1,
  onChange,
}: Props) {
  if (side === 'target') {
    return (
      <Panel title="Simulation" tight>
        <TargetSituation target={target} onChange={onChange} />
      </Panel>
    );
  }

  return (
    <Panel title="Simulation" tight>
      {/*
        * How hurt the attacker already is.
        *
        * The mirror of the target's own field, in the same place on the other
        * side. It changes no damage on its own — nothing here hits back — but a
        * lifeline and a missing-health ramp read it, and it is the question a
        * player actually asks before an all-in.
        */}
      <div className="field-row three">
        <label className="field">
          <span className="field-hint">Own health</span>
          <div className="input-with-suffix">
            <input
              type="number"
              min={1}
              max={100}
              value={Math.round(attackerHealthPercent * 100)}
              onChange={(event) =>
                onChange({
                  attackerHealthPercent: clamp(Number(event.target.value) / 100, 0.01, 1),
                })
              }
            />
            <span className="input-suffix">%</span>
          </div>
        </label>
      </div>

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
      </div>

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Timing constants</span>
      </div>

      <div className="field-row">
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * The target's half of the simulation panel.
 *
 * Built from the same four blocks as the attacker's — a segmented choice, a
 * divider, a labelled explanation, a row of numbers, a reset — because the two
 * sidebars are one mould and a panel that is a different shape on each side
 * pushes everything below it out of step. The blocks carry the target's own
 * questions: what kind of unit it is, how hurt it already is, and what soaks
 * damage on top of its resistances.
 *
 * Unit type used to live in the target panel's custom definition, where a
 * champion-mode target could not reach it at all — and it is a simulation rule
 * (it decides caps such as the 300 damage cap on Denting Blows), not part of who
 * the target is.
 */
function TargetSituation({
  target,
  onChange,
}: {
  target: TargetConfig;
  onChange: Props['onChange'];
}) {
  const patch = (fields: Partial<TargetConfig>): void =>
    onChange({ target: { ...target, ...fields } });

  return (
    <>
      <div className="field">
        <span className="field-label">Unit type</span>
        <div className="segmented">
          {(['champion', 'minion', 'monster'] as const).map((type) => (
            <button
              key={type}
              aria-pressed={target.unitType === type}
              onClick={() => patch({ unitType: type })}
            >
              {type === 'champion' ? 'Champ' : type === 'minion' ? 'Minion' : 'Monster'}
            </button>
          ))}
        </div>
      </div>

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Target situation</span>

      </div>

      <div className="field-row three">
        <label className="field">
          <span className="field-hint">Current health</span>
          <div className="input-with-suffix">
            <input
              type="number"
              min={1}
              max={100}
              value={Math.round(target.currentHealthPercent * 100)}
              onChange={(event) =>
                patch({ currentHealthPercent: clamp(Number(event.target.value) / 100, 0.01, 1) })
              }
            />
            <span className="input-suffix">%</span>
          </div>
        </label>
        <label className="field">
          <span className="field-hint">Reduction</span>
          <div className="input-with-suffix">
            <input
              type="number"
              min={0}
              max={90}
              value={Math.round(target.percentDamageReduction * 100)}
              onChange={(event) =>
                patch({ percentDamageReduction: clamp(Number(event.target.value) / 100, 0, 0.9) })
              }
            />
            <span className="input-suffix">%</span>
          </div>
        </label>
        <label className="field">
          <span className="field-hint">Flat</span>
          <input
            type="number"
            min={0}
            value={Math.round(target.flatDamageReduction * 10) / 10}
            onChange={(event) =>
              patch({ flatDamageReduction: Math.max(0, Number(event.target.value)) })
            }
          />
        </label>
      </div>

      <button
        className="btn subtle"
        onClick={() =>
          patch({ currentHealthPercent: 1, percentDamageReduction: 0, flatDamageReduction: 0 })
        }
      >
        Reset situation
      </button>
    </>
  );
}
