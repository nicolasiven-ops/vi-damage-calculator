/**
 * The target's health bar, one segment per hit.
 *
 * "Target survives with 1,550 HP" is a number; this is a picture. Every segment
 * is one hit, in the order it lands, as wide as its damage — and the hatched
 * remainder is what the combo did not get through.
 *
 * It reacts to the step in focus: the segments of that step are lifted, and
 * everything that lands *after* it is dimmed, so the bar shows how far the combo
 * had got by that moment rather than only where it ended. That makes it the same
 * question the timeline and the stats view answer, asked in the one form that
 * needs no reading at all.
 */

import type { ComboAnalysis } from '../engine/analysis';
import { DAMAGE_TYPE_LABELS, type DamageInstance } from '../engine/types';

interface Props {
  analysis: ComboAnalysis;
  /** Health the target started the combo with. */
  startingHealth: number;
  /** The step in focus, from hover anywhere or from the pinned selection. */
  linkedStepUid?: string | null;
  /**
   * Render only the bar.
   *
   * Inside a combatant rail the surrounding frame already carries the name and
   * the numbers, and repeating them under the rail said everything twice.
   */
  bare?: boolean;
}

const int = (value: number): string => Math.round(value).toLocaleString('en-US');

export function TargetHealthBar({ analysis, startingHealth, linkedStepUid, bare }: Props) {
  const total = Math.max(1, startingHealth);
  const instances = analysis.curve.map((point) => point.instance);

  /*
   * Where the focused step sits in the sequence.
   *
   * Everything after its last hit is drawn dimmed: at that moment it had not
   * happened yet. Without a focus nothing is dimmed and the bar shows the whole
   * combo.
   */
  const lastFocusedIndex = linkedStepUid
    ? instances.reduce(
        (last, instance, index) => (instance.stepUid === linkedStepUid ? index : last),
        -1,
      )
    : -1;

  let consumed = 0;
  const segments = instances.map((instance: DamageInstance, index) => {
    // Health cannot go below zero, so the last segment is only as wide as the
    // health that was actually left for it to take.
    const effective = Math.max(0, Math.min(instance.mitigated, total - consumed));
    consumed += effective;
    return {
      instance,
      index,
      width: (effective / total) * 100,
      focused: !!linkedStepUid && instance.stepUid === linkedStepUid,
      later: lastFocusedIndex >= 0 && index > lastFocusedIndex,
    };
  });

  const healthLeft = Math.max(0, total - consumed);

  /** Health the target still had when the focused step was done. */
  const focusedHealthLeft =
    lastFocusedIndex >= 0
      ? Math.max(0, total - segments.slice(0, lastFocusedIndex + 1).reduce((sum, s) => sum + (s.width / 100) * total, 0))
      : null;

  return (
    <div className={`hpbar-wrap${bare ? ' bare' : ''}`}>
      {!bare && (
        <div className="hpbar-head">
          <span className="hpbar-title">Target health</span>
          <span className="hpbar-value mono">{healthNote(analysis, total, focusedHealthLeft)}</span>
        </div>
      )}

      <div className="hpbar" role="img" aria-label={`Target health: ${int(healthLeft)} of ${int(total)} remaining`}>
        {segments.map((segment) => (
          <div
            key={segment.instance.id}
            className={`hpbar-seg ${segment.instance.type}${segment.focused ? ' is-focused' : ''}${
              segment.later ? ' is-later' : ''
            }`}
            style={{ width: `${segment.width}%` }}
            title={`${segment.instance.sourceLabel} · ${int(segment.instance.mitigated)} ${
              DAMAGE_TYPE_LABELS[segment.instance.type]
            } at ${segment.instance.time.toFixed(2)} s`}
          />
        ))}
        {healthLeft > 0 && <div className="hpbar-rest" style={{ flex: 1 }} />}
      </div>
    </div>
  );
}

/** The bar's status line: at this step, dead with overkill, or what is left. */
function healthNote(
  analysis: ComboAnalysis,
  total: number,
  focusedHealthLeft: number | null,
): string {
  if (focusedHealthLeft !== null) return `${int(focusedHealthLeft)} / ${int(total)} at this step`;
  if (analysis.killTime !== null) return `dead · ${int(analysis.overkill)} overkill`;
  return `${int(Math.max(0, analysis.targetHpRemaining))} / ${int(total)} left`;
}
