/**
 * What each stat is worth to this combo — per point, and per thousand gold.
 *
 * Same table shape as the item ledger next to it, because it answers the same
 * question one level down. Every reading is per *one* unit of the stat: one
 * attack damage, one percent of crit, one lethality — so the rows can be read
 * against each other without doing arithmetic first.
 *
 * Where the price came from lives in the Reference window's own table; here it is
 * named in the last column so a surprising row can be traced.
 */

import { displayFactor, displayUnit, type StatValueRow } from '../model/statValue';
import { STAT_LABELS } from '../model/stats';

interface Props {
  rows: StatValueRow[];
}

const num = (value: number): string =>
  Math.abs(value) >= 100
    ? Math.round(value).toLocaleString('en-US')
    : (Math.round(value * 10) / 10).toString();

/** Amounts read in the unit a player thinks in: 28.6 AD, 25 %, 33 lethality. */
function amount(value: number, unit: string): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${unit}`;
}

export function StatValuePanel({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="empty-note">Nothing to weigh yet — this combo deals no damage.</p>;
  }

  const best = Math.max(...rows.map((row) => Math.abs(row.gold?.perThousand ?? 0)), 1);

  return (
    <div className="item-value">
      <table className="item-value-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Per 1</th>
            <th>Base gold</th>
            <th>1,000 g buys</th>
            <th>Worth</th>
            <th>Faster by</th>
            <th>Priced by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const unit = displayUnit(row.key);
            return (
              <tr key={String(row.key)}>
                <th scope="row">
                  <span>
                    {STAT_LABELS[row.key]}
                    {unit === '%' && <em>per 1 %</em>}
                  </span>
                </th>
                <td className="mono strong">+{num(row.perStep)}</td>
                <td className="mono">{row.gold ? `${num(row.gold.goldPerPoint)} g` : '—'}</td>
                <td className="mono">
                  {row.gold
                    ? amount(row.gold.amountPerThousand * displayFactor(row.key), unit)
                    : '—'}
                </td>
                <td>
                  {row.gold ? (
                    <>
                      <span className="value-bar">
                        <span
                          className="value-bar-fill"
                          style={{
                            width: `${Math.max(1, (Math.abs(row.gold.perThousand) / best) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="mono strong">{num(row.gold.perThousand)}</span>
                    </>
                  ) : (
                    <span className="dim">no price</span>
                  )}
                </td>
                <td className="mono">
                  {Math.abs(row.secondsSaved) >= 0.02 ? (
                    <span className={row.secondsSaved > 0 ? 'good' : 'dim'}>
                      {row.secondsSaved > 0 ? '−' : '+'}
                      {Math.abs(row.secondsSaved).toFixed(2)} s
                    </span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td className="mono dim">{row.gold ? row.gold.sourceName : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
