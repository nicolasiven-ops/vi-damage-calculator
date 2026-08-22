/**
 * The duel, as two health lines and one sentence.
 *
 * The question a duel answers is not "how much damage" — the rest of this app
 * answers that better — it is "who is standing at the end, and how close was it".
 * So: two curves falling from full to whatever is left, the moment one of them
 * reaches the floor, and a verdict that names the margin rather than only the
 * winner. A fight won with sixty health left and one won with six hundred are
 * different fights.
 *
 * The limits are printed under it, not tucked into a tooltip. Nobody moves in this
 * model, and against an unmodelled champion only their attacks are real — both of
 * those change what the answer means, and a reader who does not know them is being
 * misled by a number that is otherwise correct.
 */

import { useState } from 'react';
import type { DuelOutcome } from '../engine/duel';
import { DuelLanes } from './DuelLanes';

interface Props {
  outcome: DuelOutcome | null;
  viName: string;
  enemyName: string;
  /** Empty when the enemy's abilities are modelled — that is, when they are Vi. */
  enemyGap: string | null;
  /** Who is fighting, in the numbers each side brings. */
  sides?: {
    vi: { level: number; health: number; items: number; presses: number };
    enemy: { level: number; health: number; items: number; presses: number; kit: string };
  };
  /** Why there is no fight, when there is none. */
  blocked?: string | null;
  /** True when the plan on the chart was searched for rather than repeated. */
  planned?: boolean;
  /** Ask for a continuation, searched against this fight. */
  onSolve?: () => { killTime: number | null; presses: number };
  /** Back to repeating the typed combo. */
  onReset?: () => void;
  /** Ability icons for the lanes. */
  icons?: { vi: Partial<Record<string, string>>; enemy: Partial<Record<string, string>> };
  /** Where the fight is right now, from the app's own playback clock. */
  playhead?: number | null;
}

function formatSeconds(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

export function DuelPanel({
  outcome,
  viName,
  enemyName,
  enemyGap,
  sides,
  blocked,
  planned,
  onSolve,
  onReset,
  icons,
  playhead,
}: Props) {
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<string | null>(null);

  /**
   * Ask for a plan, on the next turn of the event loop.
   *
   * The search is a few thousand simulations and holds the thread while it runs, so
   * the button has to render its own state first. A timeout rather than an
   * animation frame: a frame callback never fires in a tab nobody is looking at.
   */
  function search(): void {
    if (!onSolve || searching) return;
    setSearching(true);
    setFound(null);
    setTimeout(() => {
      const result = onSolve();
      setSearching(false);
      setFound(
        result.killTime === null
          ? 'No kill found inside the fight — the repeat stays.'
          : `${result.presses} presses, kill at ${formatSeconds(result.killTime)} s.`,
      );
    }, 0);
  }

  if (!outcome) {
    /*
     * Name the switch. "Nothing to fight with yet" was true and useless: the
     * opponent in a duel is the target in the right sidebar, and if that target is
     * a set of typed numbers then there is nobody home — which is a thing to say
     * plainly rather than leave the reader looking for a start button.
     */
    return (
      <div className="duel">
        <p className="duel-empty">
          {blocked ??
            'No fight yet. The opponent in a duel is the target in the right sidebar — pick a champion there and it fights back.'}
        </p>
      </div>
    );
  }

  const winnerName =
    outcome.winner === 'a' ? viName : outcome.winner === 'b' ? enemyName : null;
  const survivor = outcome.winner === 'a' ? outcome.healthA : outcome.healthB;

  return (
    <div className="duel">
      {/*
        * Who is fighting, before what happened.
        *
        * The opponent is not a setting hidden in this panel — it is the target
        * sidebar, at its level, with its items and its ranks. Saying so here is
        * what turns two coloured lines into a fight between two champions.
        */}
      {sides && (
        <div className="duel-sides">
          <span className="duel-side vi">
            <strong>{viName}</strong>
            <span className="mono">
              level {sides.vi.level} · {Math.round(sides.vi.health).toLocaleString('en-US')} HP ·{' '}
              {sides.vi.items} items · {sides.vi.presses} presses
            </span>
          </span>
          <span className="duel-versus">vs</span>
          <span className="duel-side enemy">
            <strong>{enemyName}</strong>
            <span className="mono">
              level {sides.enemy.level} ·{' '}
              {Math.round(sides.enemy.health).toLocaleString('en-US')} HP ·{' '}
              {sides.enemy.items} items · {sides.enemy.kit}
            </span>
          </span>
        </div>
      )}

      {/*
        * Replan rather than repeat.
        *
        * The repeat is honest and dumb: half of it is refused as on cooldown. This
        * asks the solver for the continuation instead, using the duel's own runner
        * — so the search sees her health falling, which is the only reason the
        * answer can differ from the one the strip's own button gives.
        */}
      {onSolve && (
        <div className="duel-plan">
          <button className="btn solve" onClick={search} disabled={searching}>
            {searching ? 'Searching …' : 'Replan for the fastest kill'}
          </button>
          {planned && (
            <button className="btn" onClick={onReset}>
              Back to the typed combo
            </button>
          )}
          {found && <span className="duel-plan-note mono">{found}</span>}
          {planned && !found && (
            <span className="duel-plan-note mono">Running a searched continuation.</span>
          )}
        </div>
      )}

      <div className="duel-verdict">
        {winnerName ? (
          <>
            <span className="duel-winner">{winnerName} wins</span>
            <span className="duel-margin mono">
              {Math.round(survivor).toLocaleString('en-US')} HP left
            </span>
            <span className="duel-when mono">at {formatSeconds(outcome.endTime)} s</span>
          </>
        ) : (
          <>
            <span className="duel-winner draw">
              {outcome.healthA <= 0 && outcome.healthB <= 0 ? 'Both die' : 'Nobody dies'}
            </span>
            <span className="duel-margin mono">
              {Math.round(outcome.healthA).toLocaleString('en-US')} ·{' '}
              {Math.round(outcome.healthB).toLocaleString('en-US')} HP left
            </span>
            <span className="duel-when mono">after {formatSeconds(outcome.endTime)} s</span>
          </>
        )}
      </div>

      {/*
        * The fight itself, as two lanes running at a trigger line — see `DuelLanes`.
        * It replaced a pair of health curves: those answered who wins and nothing
        * about how, which is the only part worth watching.
        */}
      <DuelLanes
        outcome={outcome}
        viName={viName}
        enemyName={enemyName}
        viIcons={icons?.vi ?? {}}
        enemyIcons={icons?.enemy ?? {}}
        playhead={playhead ?? null}
      />

      <ul className="duel-limits">
        <li>
          Nobody moves: no range, no kiting, no dash spent escaping. Both stand in
          each other&apos;s face for the whole fight.
        </li>
        <li>
          Both sides keep going: the typed combo repeats as cooldowns allow, and the
          other side presses what it has and attacks in between. A duel does not end
          because a plan ran out.
        </li>
        {enemyGap && <li>{enemyGap}</li>}
        <li>
          Settled after {outcome.passes} {outcome.passes === 1 ? 'pass' : 'passes'}
          {outcome.unsettled ? ' — and it was still moving, so read it with suspicion.' : '.'}
        </li>
      </ul>
    </div>
  );
}
