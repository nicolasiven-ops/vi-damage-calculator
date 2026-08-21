/**
 * What the build's items contribute, and what that costs per point of gold.
 *
 * One row per item, ranked by contribution. The bar is the share of the combo's
 * damage; the last column is the same damage priced per 1,000 gold, which is the
 * only fair way to compare a component with a legendary.
 *
 * Contributions do not sum to the total on purpose — see the note in
 * `itemValue.ts`. Each row answers "what would taking this out cost me", which
 * is the question the shop asks.
 */

import type { ItemValueRow } from '../model/itemValue';
import { killCarriedBy } from '../model/itemValue';
import { imageUrls } from '../data/ddragon';

interface Props {
  rows: ItemValueRow[];
  version: string;
  /** How many of the build's items still have an unmodelled passive. */
  unmodelled: number;
}

const num = (value: number): string => Math.round(value).toLocaleString('en-US');

export function ItemValuePanel({ rows, version, unmodelled }: Props) {
  if (rows.length === 0) {
    return <p className="empty-note">No items in the build — nothing to weigh yet.</p>;
  }

  const best = Math.max(...rows.map((row) => Math.abs(row.contribution)), 1);
  const carried = killCarriedBy(rows);

  return (
    <div className="item-value">
      <table className="item-value-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Gold</th>
            <th>Contributes</th>
            <th>Share</th>
            <th>Per 1,000 g</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.killsWith && !row.killsWithout ? 'is-decisive' : ''}>
              <th scope="row">
                <img src={imageUrls.item(version, row.imageFile)} alt="" />
                <span>
                  {row.name}
                  {!row.passiveModelled && (
                    <em title="This item's passive is not modelled yet — the number is what its stats do, which is a floor.">
                      stats only
                    </em>
                  )}
                </span>
              </th>
              <td className="mono">{num(row.gold)}</td>
              <td className="mono strong">{num(row.contribution)}</td>
              <td>
                <span className="value-bar">
                  <span
                    className="value-bar-fill"
                    style={{ width: `${Math.max(1, (Math.abs(row.contribution) / best) * 100)}%` }}
                  />
                </span>
                <span className="mono dim">{(row.share * 100).toFixed(1)}%</span>
              </td>
              <td className="mono">
                {row.perThousandGold === null ? '—' : num(row.perThousandGold)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {carried && (
        <p className="item-value-note">
          <span className="tag good">Carries the kill</span> Without {carried.name} this combo
          leaves the target alive.
        </p>
      )}

      {unmodelled > 0 && (
        <p className="item-value-note dim">
          {unmodelled} of these {unmodelled === 1 ? 'has a passive' : 'have passives'} that is not
          modelled yet, so {unmodelled === 1 ? 'its number is' : 'their numbers are'} what the stats
          alone do.
        </p>
      )}
    </div>
  );
}
