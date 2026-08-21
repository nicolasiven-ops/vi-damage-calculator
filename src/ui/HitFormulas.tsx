/**
 * The formula at the hit.
 *
 * The ability table answers "what does Q do at rank 5" — a question about the
 * kit. This answers the one you actually have while reading a combo: <em>why
 * 158?</em> Two lines per hit, in the order the engine worked:
 *
 *   1. what built the raw number — base, ratios, the stat each ratio read
 *   2. what took it apart — amplification, the resistance it met and how that
 *      resistance got there, percent and flat reductions
 *
 * and the effective number at the bottom, which is the one that moved the health
 * bar. Every figure is the figure the engine recorded rather than a second
 * derivation that could disagree with it: the terms come from the champion at
 * the moment of casting, the chain from the mitigation pipeline itself.
 */

import type { ComboAnalysis } from '../engine/analysis';
import type { DamageInstance, DamageTerm } from '../engine/types';
import type { ReductionStep } from '../engine/damage';

interface Props {
  analysis: ComboAnalysis;
  /** The step held by a click, if any: then only its hits are shown. */
  pinnedStepUid?: string | null;
}

const TYPE_WORD: Record<DamageInstance['type'], string> = {
  physical: 'physical',
  magic: 'magic',
  true: 'true',
};

const SOURCE_LABEL: Record<NonNullable<DamageTerm['source']>, string> = {
  gamedata: 'game data',
  ddragon: 'Data Dragon',
  registry: 'maintained',
};

const num = (value: number): string => Math.round(value).toLocaleString('en-US');
const exact = (value: number): string =>
  Math.abs(value - Math.round(value)) < 0.05 ? num(value) : value.toFixed(1);

export function HitFormulas({ analysis, pinnedStepUid }: Props) {
  const hits = analysis.curve
    .map((point) => point.instance)
    .filter((instance) => !pinnedStepUid || instance.stepUid === pinnedStepUid);

  if (hits.length === 0) {
    return (
      <p className="empty-note">
        Nothing to take apart yet. Every hit in a combo gets its derivation here —
        click a step to narrow this to that step alone.
      </p>
    );
  }

  return (
    <div className="hit-formulas">
      {hits.map((hit) => (
        <HitCard key={hit.id} hit={hit} />
      ))}
    </div>
  );
}

function HitCard({ hit }: { hit: DamageInstance }) {
  /*
   * The strongest provenance the terms carry, for the badge in the header.
   *
   * A hit built from Riot's own formulas and one built from maintained constants
   * are different claims, and the difference belongs where the eye lands first.
   */
  const sources = new Set((hit.build ?? []).map((term) => term.source).filter(Boolean));
  const provenance = sources.has('gamedata')
    ? 'gamedata'
    : sources.has('ddragon')
      ? 'ddragon'
      : sources.has('registry')
        ? 'registry'
        : null;

  return (
    <article className="hit-card">
      <header className="hit-card-head">
        <b>{hit.sourceLabel}</b>
        <span className="mono hit-time">{hit.time.toFixed(2)} s</span>
        {provenance && (
          <span className={`hit-source src-${provenance}`}>{SOURCE_LABEL[provenance]}</span>
        )}
      </header>

      {/* Line one: what the number is made of. */}
      <div className="hit-line hit-build mono">
        {(hit.build ?? []).map((term, index) => (
          <span className="hit-term" key={`${term.label}-${index}`}>
            {index > 0 && <span className="hit-op">+</span>}
            <em title={term.detail}>{exact(term.amount)}</em>
            <span className="hit-op">{term.label}</span>
          </span>
        ))}
        {(hit.build ?? []).length === 0 && (
          <span className="hit-term">
            <em>{exact(hit.raw)}</em>
            <span className="hit-op">flat</span>
          </span>
        )}
        <span className="hit-eq">= {exact(hit.raw)}</span>
        <span className="hit-op">raw {TYPE_WORD[hit.type]}</span>
      </div>

      {/* Line two: what happened to it on the way in. */}
      <div className="hit-line hit-reduce mono">
        {(hit.reduction ?? []).map((step, index) => (
          <ReductionPart key={`${step.label}-${index}`} step={step} />
        ))}
        {(hit.reduction ?? []).length === 0 && (
          <span className="hit-term">
            <span className="hit-op">nothing reduced it</span>
          </span>
        )}
      </div>

      <div className="hit-result">
        <span className="hit-eq-final">=</span>
        <span className="mono">{num(hit.mitigated)}</span>
        <span className="hit-op">effective</span>
        {hit.raw - hit.mitigated > 0.5 && (
          <span className="hit-lost">{num(hit.raw - hit.mitigated)} stopped</span>
        )}
      </div>

      {hit.notes.length > 0 && (
        <ul className="hit-trace">
          {hit.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <footer className="hit-card-foot mono">target at {num(hit.targetHpAfter)} after</footer>
    </article>
  );
}

function ReductionPart({ step }: { step: ReductionStep }) {
  const operator =
    step.factor !== undefined
      ? `× ${step.factor.toFixed(3)}`
      : step.subtract !== undefined
        ? `− ${exact(step.subtract)}`
        : null;
  return (
    <span className="hit-term" title={step.detail}>
      {operator ? <em>{operator}</em> : null}
      <span className="hit-op">{step.detail ?? step.label}</span>
    </span>
  );
}
