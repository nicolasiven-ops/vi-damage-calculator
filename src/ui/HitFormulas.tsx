/**
 * The formula at the hit, written out as the arithmetic it is.
 *
 * The ability table answers "what does Q do at rank 5" — a question about the
 * kit. This answers the one you have while reading a combo: <em>why 158?</em>
 *
 * So the card is a derivation, one operation per line, with the running value on
 * the right: the terms that built the raw number, then every factor and
 * subtraction that took it apart, then the number that moved the health bar. Each
 * line carries the arithmetic that produced it — <code>150% × 0 bonus AD</code>
 * rather than the word "bonus AD" with the coefficient hidden in a tooltip, and
 * <code>90 armor − 47 lethality → 43</code> rather than a bare multiplier.
 *
 * Every figure is the one the engine recorded, not a second derivation that could
 * disagree with it: the terms come from the champion at the moment of casting, the
 * chain from the mitigation pipeline itself.
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

/**
 * The resistance a step met, as the arithmetic that produced the multiplier.
 *
 * `step.label` carries the effective resistance ("Against 43.0 armor") and
 * `step.detail` the way it got there ("90 armor −47 lethality"). Printed
 * together they are the derivation; printed apart, as they were, the reader gets
 * a factor and has to trust it.
 */
function resistanceLine(step: ReductionStep): string | null {
  const matched = /Against ([\d.]+) (armor|magic resist)/.exec(step.label);
  if (!matched || !step.detail) return step.detail ?? null;

  /*
   * The arrow only when something moved the resistance. With no shred and no
   * penetration the effective figure is the base figure, and "58 armor → 58
   * effective" is a line that teaches nothing while looking like it does.
   */
  const effective = Number(matched[1]);
  const base = Number(/^([\d.]+)/.exec(step.detail)?.[1] ?? NaN);
  if (Number.isFinite(base) && Math.abs(base - effective) < 0.5) return step.detail;
  return `${step.detail} → ${exact(effective)} effective`;
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

  const terms = hit.build ?? [];
  const steps = hit.reduction ?? [];
  /*
   * Notes that now say what a line above them says. The effective resistance is
   * part of the reduction line, so repeating it underneath is the kind of
   * duplication that makes a reader wonder which one to believe.
   */
  const notes = hit.notes.filter(
    (note) =>
      // The effective resistance is now part of the reduction line.
      !/^effective (armor|magic resist)/i.test(note) &&
      /*
       * And a champion module's own one-line summary of its formula — "300 base
       * + 150% bonus AD" — is the two lines directly above it, in the same
       * words. Two statements of one formula invite the reader to look for a
       * difference between them.
       */
      !/^[\d.,]+ base \+ /.test(note),
  );

  return (
    <article className="hit-card">
      <header className="hit-card-head">
        <b>{hit.sourceLabel}</b>
        <span className="mono hit-time">{hit.time.toFixed(2)} s</span>
        {provenance && (
          <span className={`hit-source src-${provenance}`}>{SOURCE_LABEL[provenance]}</span>
        )}
      </header>

      <div className="hit-calc mono">
        {/* What the raw number is made of, one term per line. */}
        {terms.map((term, index) => (
          <div className="hit-row" key={`${term.label}-${index}`}>
            <span className="hit-op">{index === 0 ? '' : '+'}</span>
            <span className="hit-formula">
              <span className="hit-term-label">{term.label}</span>
              {term.detail && <span className="hit-term-detail">{term.detail}</span>}
            </span>
            <span className="hit-value">{exact(term.amount)}</span>
          </div>
        ))}
        {terms.length === 0 && (
          <div className="hit-row">
            <span className="hit-op" />
            <span className="hit-formula">flat</span>
            <span className="hit-value">{exact(hit.raw)}</span>
          </div>
        )}

        <div className="hit-row is-sum">
          <span className="hit-op">=</span>
          <span className="hit-formula">raw {TYPE_WORD[hit.type]}</span>
          <span className="hit-value">{exact(hit.raw)}</span>
        </div>

        {/* And what took it apart, with the running total after each step. */}
        {steps.map((step, index) => (
          <div className="hit-row" key={`${step.label}-${index}`}>
            <span className="hit-op">
              {step.factor !== undefined
                ? `× ${step.factor.toFixed(3)}`
                : step.subtract !== undefined
                  ? `− ${exact(step.subtract)}`
                  : ''}
            </span>
            <span className="hit-formula">{resistanceLine(step) ?? step.label}</span>
            <span className="hit-value">{exact(step.after)}</span>
          </div>
        ))}
        {steps.length === 0 && (
          <div className="hit-row">
            <span className="hit-op" />
            <span className="hit-formula">nothing reduced it</span>
            <span className="hit-value">{exact(hit.raw)}</span>
          </div>
        )}

        <div className="hit-row is-total">
          <span className="hit-op">=</span>
          <span className="hit-formula">
            effective
            {hit.raw - hit.mitigated > 0.5 && (
              <span className="hit-lost">{num(hit.raw - hit.mitigated)} stopped</span>
            )}
          </span>
          <span className="hit-value">{num(hit.mitigated)}</span>
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="hit-trace">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <footer className="hit-card-foot mono">target at {num(hit.targetHpAfter)} after</footer>
    </article>
  );
}
