/**
 * Ways to ask for a combo instead of typing one.
 *
 * It sits above the target's sidebar, which is where it belongs: both modes are
 * questions about *that* target. What they produce goes straight into the strip,
 * and what it then does is the middle of the screen's job — so nothing is
 * reported here beyond the fact that a search found nothing, which is the one
 * outcome a silent button would look broken for.
 *
 * Two modes, and the difference is what the search may touch. "Fastest kill"
 * starts from nothing and answers "what should I press". "Complete combo" keeps
 * every press already in the strip and answers the more common question: I have
 * an opener I like, what closes it?
 */

import { useState } from 'react';
import type { SolverResult } from '../model/comboSolver';

interface Props {
  /** Searches from nothing. */
  onSolve: () => SolverResult;
  /** Searches from what is already in the strip. */
  onComplete: () => SolverResult;
  /** Puts the winning order into the strip. */
  onApply: (result: SolverResult) => void;
  /** How many presses are in the strip, to tell "nothing to add" from "nothing happened". */
  typedLength: number;
  disabled?: boolean;
}

export function ComboModes({ onSolve, onComplete, onApply, typedLength, disabled }: Props) {
  const [busy, setBusy] = useState<'solve' | 'complete' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function search(which: 'solve' | 'complete'): void {
    if (disabled || busy) return;
    setBusy(which);
    setNote(null);
    /*
     * A turn of the event loop first, so the button can render its own state: the
     * search is synchronous and holds the thread for a few thousand simulations.
     * A timeout rather than an animation frame — a frame callback never fires in
     * a tab nobody is looking at, and a backgrounded search would hang on
     * "Searching …" forever.
     */
    setTimeout(() => {
      const found = which === 'solve' ? onSolve() : onComplete();
      setBusy(null);
      if (!found.best) {
        setNote('Nothing in reach kills this target.');
        return;
      }
      /*
       * A completion that hands back exactly what was typed means the combo
       * already kills. Nothing changes in the strip, so without a word here the
       * button is indistinguishable from a broken one.
       */
      if (which === 'complete' && found.best.steps.length === typedLength) {
        setNote('Already kills — nothing to add.');
        return;
      }
      onApply(found);
    }, 0);
  }

  return (
    <div className="combo-modes">
      <button className="btn solve" onClick={() => search('solve')} disabled={disabled || !!busy}>
        {busy === 'solve' ? 'Searching …' : 'Fastest kill'}
      </button>

      <button
        className="btn solve"
        onClick={() => search('complete')}
        disabled={disabled || !!busy}
        title="Keep what is in the strip and add the fastest ending to it"
      >
        {busy === 'complete' ? 'Searching …' : 'Complete combo for fastest kill'}
      </button>

      {note && !busy && <p className="solve-none">{note}</p>}
    </div>
  );
}
