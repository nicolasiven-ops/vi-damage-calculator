/**
 * What you changed, and what it did.
 *
 * Theorycrafting is a sequence of small experiments, and until now every one of
 * them vanished the moment the next one started: the number on screen belongs to
 * the current build, and what the last four changes bought was in nobody's head
 * after ten minutes.
 *
 * Each row is one change, newest first, with the damage it moved — and a click
 * puts that build back. That is the half that makes it more than a diary: a log
 * you can walk backwards is an undo with reasons attached.
 */

import type { ChangeLogEntry } from '../state/changeLog';

interface Props {
  entries: ChangeLogEntry[];
  /** Puts a build from the log back on screen. */
  onRestore?: (id: number) => void;
}

const signed = (value: number): string => {
  const rounded = Math.round(value);
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')}`;
};

export function ChangeLogPanel({ entries, onRestore }: Props) {
  if (entries.length === 0) {
    return (
      <p className="empty-note">
        Nothing yet. Change the build — an item, a rank, the target — and what it did shows up
        here.
      </p>
    );
  }

  const biggest = Math.max(...entries.map((entry) => Math.abs(entry.delta)), 1);

  return (
    <div className="item-value">
      <table className="item-value-table change-log-table">
        <thead>
          <tr>
            <th>Change</th>
            <th>Damage</th>
            <th>Moved</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <th scope="row">
                <button
                  className="change-restore"
                  onClick={() => onRestore?.(entry.id)}
                  title="Put this build back"
                >
                  {entry.label}
                </button>
              </th>
              <td className="mono">
                {Math.round(entry.before).toLocaleString('en-US')} →{' '}
                <span className="strong">{Math.round(entry.after).toLocaleString('en-US')}</span>
              </td>
              <td>
                <span className="value-bar">
                  <span
                    className={`value-bar-fill${entry.delta < 0 ? ' is-down' : ''}`}
                    style={{ width: `${Math.max(1, (Math.abs(entry.delta) / biggest) * 100)}%` }}
                  />
                </span>
                <span className={`mono ${entry.delta < 0 ? 'bad' : 'good'}`}>
                  {signed(entry.delta)}
                </span>
              </td>
              <td className="mono">
                {entry.killedAfter === entry.killedBefore ? (
                  <span className="dim">—</span>
                ) : entry.killedAfter ? (
                  <span className="good">kills now</span>
                ) : (
                  <span className="bad">stopped killing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
