/**
 * What each stat is worth to this combo — per point, and per thousand gold.
 *
 * Same table shape as the item ledger next to it, because it answers the same
 * question one level down. The bar is the share of the best row, so the ranking
 * is readable before any number is.
 */

import type { StatValueRow } from '../model/statValue';

interface Props {
  rows: StatValueRow[];
}

const num = (value: number): string => Math.round(value).toLocaleString('en-US');

/** Amounts read in the unit a player thinks in: 28.6 AD, 12 %, 40 haste. */
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
            <th>Per point</th>
            <th>1,000 g buys</th>
            <th>Worth</th>
            <th>Faster by</th>
            <th>Priced by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.key)}>
              <th scope="row">
                <span>{row.label}</span>
              </th>
              <td className="mono">
                +{num(row.perStep)}{' '}
                <span className="dim">per {amount(row.step * row.factor, row.unit)}</span>
              </td>
              <td className="mono">
                {row.gold ? amount(row.gold.amountPerThousand * row.factor, row.unit) : '—'}
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
                  <span className="dim">not sold on its own</span>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
