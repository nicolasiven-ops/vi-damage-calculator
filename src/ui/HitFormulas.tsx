/**
 * The formula at the hit.
 *
 * The formula inspector answers "what does Q do at rank 5" — a question about
 * the ability. This answers the question you actually have while reading a
 * combo: <em>why 158?</em> One card per hit, built from what the engine already
 * recorded about that hit, so every number on the card is the number that was
 * used and not a re-derivation that might disagree.
 *
 * With a step in focus it shows that step's hits alone; otherwise all of them,
 * in the order they landed.
 */

import type { ComboAnalysis } from '../engine/analysis';
import type { DamageInstance } from '../engine/types';

interface Props {
  analysis: ComboAnalysis;
  /** The step held by a click, if any. */
  pinnedStepUid?: string | null;
}

const TYPE_LABELS: Record<DamageInstance['type'], string> = {
  physical: 'physical',
  magic: 'magic',
  true: 'true',
};

const int = (value: number): string => Math.round(value).toLocaleString('en-US');

export function HitFormulas({ analysis, pinnedStepUid }: Props) {
  const hits = analysis.curve
    .map((point) => point.instance)
    .filter((instance) => !pinnedStepUid || instance.stepUid === pinnedStepUid);

  if (hits.length === 0) {
    return (
      <p className="empty-note">
        No hits to take apart yet — build a combo, and every hit in it gets its
        derivation here.
      </p>
    );
  }

  return (
    <div className="hit-formulas">
      {hits.map((hit) => {
        /*
         * The mitigation factor is measured, not recomputed.
         *
         * Dividing what landed by what was rolled gives exactly the multiplier
         * the engine applied, including reductions this card knows nothing
         * about — which is the point: the card cannot drift from the number.
         */
        const factor = hit.raw > 0 ? hit.mitigated / hit.raw : 1;
        const lost = hit.raw - hit.mitigated;
        return (
          <article className="hit-card" key={hit.id}>
            <header className="hit-card-head">
              <b>{hit.sourceLabel}</b>
              <span className="mono">{hit.time.toFixed(2)} s</span>
            </header>

            <div className="hit-expr mono">
              <span className="hit-raw">{int(hit.raw)}</span>
              <span className="hit-op">raw {TYPE_LABELS[hit.type]}</span>
              <span className="hit-op">×</span>
              <span className="hit-factor">{factor.toFixed(3)}</span>
              <span className="hit-op">
                {hit.type === 'true' ? 'nothing reduces true damage' : 'after resistances'}
              </span>
            </div>

            <div className="hit-result">
              <span className="mono">{int(hit.mitigated)}</span> landed
              {lost > 0.5 && (
                <span className="hit-lost"> · {int(lost)} stopped</span>
              )}
            </div>

            {hit.notes.length > 0 && (
              <ul className="hit-trace">
                {hit.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            <footer className="hit-card-foot mono">
              target at {int(hit.targetHpAfter)} after
            </footer>
          </article>
        );
      })}
    </div>
  );
}
