/**
 * Ways to ask for a combo instead of typing one.
 *
 * It sits above the target's sidebar, which is where it belongs: every mode here
 * is a question about *that* target — how fast it can be killed, what order does
 * it soonest. The strip in the middle stays what it always was, a plan you can
 * edit; this writes into it and then gets out of the way.
 *
 * The result is shown with its runners-up on purpose. A solver that answers with
 * one line is an oracle, and an oracle cannot be checked: the second-best order
 * and the seconds between them are what make the first one believable.
 */

import { useState } from 'react';
import type { SolverResult } from '../model/comboSolver';

interface Props {
  /** Runs the search and returns what it found. Null while nothing has run. */
  onSolve: () => SolverResult;
  /** Puts a found order into the strip. */
  onApply: (result: SolverResult, index: number) => void;
  /** Disabled while there is nothing to solve against. */
  disabled?: boolean;
}

const seconds = (value: number): string => `${value.toFixed(2)} s`;

export function ComboModes({ onSolve, onApply, disabled }: Props) {
  const [result, setResult] = useState<SolverResult | null>(null);
  const [busy, setBusy] = useState(false);

  function solve(): void {
    if (disabled) return;
    setBusy(true);
    /*
     * A turn of the event loop before the search, so the button can render its
     * own "searching" state first: the search is synchronous and holds the
     * thread for a few thousand simulations.
     *
     * A timeout rather than an animation frame, and that is not a detail — a
     * frame callback never fires in a tab nobody is looking at, so a search
     * started and then backgrounded would hang on "Searching …" forever.
     */
    setTimeout(() => {
      const found = onSolve();
      setResult(found);
      setBusy(false);
      if (found.best) onApply(found, 0);
    }, 0);
  }

  return (
    <div className="combo-modes">
      <button className="btn solve" onClick={solve} disabled={disabled || busy}>
        {busy ? 'Searching …' : 'Fastest kill'}
      </button>

      {result && !busy && (
        <div className="solve-result">
          {result.best ? (
            <>
              <div className="solve-best">
                <span className="mono strong">{seconds(result.best.killTime ?? 0)}</span>
                <span className="solve-order">{result.best.labels.join(' → ')}</span>
              </div>

              {result.runnersUp.length > 0 && (
                <ul className="solve-others">
                  {result.runnersUp.slice(0, 3).map((entry, index) => (
                    <li key={entry.labels.join('>')}>
                      <button className="solve-apply" onClick={() => onApply(result, index + 1)}>
                        <span className="mono">
                          +{((entry.killTime ?? 0) - (result.best!.killTime ?? 0)).toFixed(2)} s
                        </span>
                        <span className="solve-order">{entry.labels.join(' → ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="field-hint">
              Nothing in reach kills this target inside the search window.
            </p>
          )}

          <p className="solve-foot mono">
            {result.simulations.toLocaleString('en-US')} runs
            {result.hitLimit ? ' · stopped at the budget' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
