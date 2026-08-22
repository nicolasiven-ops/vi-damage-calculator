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

import type { DuelOutcome } from '../engine/duel';

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
}

const WIDTH = 720;
const HEIGHT = 210;
const PAD = { left: 46, right: 16, top: 16, bottom: 26 };

function formatSeconds(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function line(
  curve: { time: number; health: number }[],
  span: number,
  most: number,
): string {
  const x = (time: number) =>
    PAD.left + (span <= 0 ? 0 : (time / span) * (WIDTH - PAD.left - PAD.right));
  const y = (health: number) =>
    HEIGHT - PAD.bottom - (most <= 0 ? 0 : (health / most) * (HEIGHT - PAD.top - PAD.bottom));

  /*
   * Stepped, not sloped. Health does not drain — it drops when something lands,
   * and a diagonal between two hits draws seconds of bleeding that never happened.
   */
  const parts: string[] = [];
  curve.forEach((point, index) => {
    const previous = curve[index - 1];
    if (!previous) {
      parts.push(`M ${x(point.time).toFixed(1)} ${y(point.health).toFixed(1)}`);
      return;
    }
    parts.push(`L ${x(point.time).toFixed(1)} ${y(previous.health).toFixed(1)}`);
    parts.push(`L ${x(point.time).toFixed(1)} ${y(point.health).toFixed(1)}`);
  });
  return parts.join(' ');
}

export function DuelPanel({ outcome, viName, enemyName, enemyGap, sides, blocked }: Props) {
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

  const span = Math.max(outcome.endTime, 0.5);
  const most = Math.max(
    outcome.curveA[0]?.health ?? 1,
    outcome.curveB[0]?.health ?? 1,
  );
  const x = (time: number) => PAD.left + (time / span) * (WIDTH - PAD.left - PAD.right);
  const y = (health: number) =>
    HEIGHT - PAD.bottom - (health / most) * (HEIGHT - PAD.top - PAD.bottom);

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

      <svg className="duel-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img">
        <title>
          {`${viName} against ${enemyName}: health over ${formatSeconds(outcome.endTime)} s`}
        </title>

        {/* Quarters of the taller health pool, so both lines share one scale. */}
        {[0, 0.25, 0.5, 0.75, 1].map((share) => (
          <g key={share}>
            <line
              className="duel-grid"
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(most * share)}
              y2={y(most * share)}
            />
            <text className="duel-tick mono" x={PAD.left - 6} y={y(most * share) + 3}>
              {Math.round(most * share).toLocaleString('en-US')}
            </text>
          </g>
        ))}

        <path className="duel-line vi" d={line(outcome.curveA, span, most)} />
        <path className="duel-line enemy" d={line(outcome.curveB, span, most)} />

        {/* The moment it ended, which is the only instant worth a line. */}
        {outcome.winner && (
          <line
            className="duel-end"
            x1={x(outcome.endTime)}
            x2={x(outcome.endTime)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
          />
        )}

        <text className="duel-axis mono" x={PAD.left} y={HEIGHT - 8}>
          0 s
        </text>
        <text className="duel-axis mono" x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">
          {formatSeconds(span)} s
        </text>
      </svg>

      <div className="duel-legend">
        <span className="duel-key vi">{viName}</span>
        <span className="duel-key enemy">{enemyName}</span>
      </div>

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
