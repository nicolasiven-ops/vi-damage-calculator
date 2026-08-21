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
}

const int = (value: number): string => Math.round(value).toLocaleString('en-US');

export function TargetHealthBar({ analysis, startingHealth, linkedStepUid }: Props) {
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

  /*
   * No caption of its own any more.
   *
   * The bar sits inside a combatant rail, and that rail already prints the
   * health at the focused step across the middle of it. Saying it twice, once
   * with the step's number and once with the final one, was the reason the two
   * disagreed.
   */
  return (
    <div className="hpbar-wrap bare">
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

