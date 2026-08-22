/**
 * The base gold value of every stat — what the shop charges for one point.
 *
 * A reference table rather than a reading of this build: it does not change when
 * the combo does. It exists because every "is that worth it" question eventually
 * comes back to these numbers, and because the two ways they are found are worth
 * seeing side by side.
 *
 * Sold on its own — Long Sword, Dagger, Cloak of Agility — and the price is the
 * division. Never sold on its own — lethality, penetration, most of the interesting
 * ones — and the price is what is left of an item's cost once the stats it is
 * bundled with are paid for at their own prices. The last column shows exactly
 * which subtraction was made, because a derived price inherits every assumption
 * underneath it.
 */

import type { StatPriceRow } from '../model/statValue';

interface Props {
  rows: StatPriceRow[];
}

const gold = (value: number): string =>
  value >= 100
    ? Math.round(value).toLocaleString('en-US')
    : (Math.round(value * 100) / 100).toString();

export function StatGoldPanel({ rows }: Props) {
  const priced = rows.filter((row) => row.rate);
  const unpriced = rows.filter((row) => !row.rate);

  return (
    <div className="item-value">
      <table className="item-value-table stat-gold-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>One unit</th>
            <th>Base gold</th>
            <th>Priced by</th>
            <th>Minus</th>
          </tr>
        </thead>
        <tbody>
          {priced.map((row) => (
            <tr key={String(row.key)}>
              <th scope="row">
                <span>{row.label}</span>
              </th>
              <td className="mono dim">1{row.unit}</td>
              <td className="mono strong">{gold(row.rate!.goldPerPoint)} g</td>
              <td className="mono">{row.rate!.sourceName}</td>
              <td className="mono dim">
                {row.rate!.derivedFrom ? row.rate!.derivedFrom : <span className="dim">—</span>}
              </td>
            </tr>
          ))}
          {unpriced.map((row) => (
            <tr key={String(row.key)} className="is-unpriced">
              <th scope="row">
                <span>{row.label}</span>
              </th>
              <td className="mono dim">1{row.unit}</td>
              <td className="mono dim">no price</td>
              <td className="mono dim" colSpan={2}>
                nothing in the shop sells it in a form this can isolate
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
