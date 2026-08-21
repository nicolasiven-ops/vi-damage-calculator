/**
 * What this side's gear does and does not do, in one place at the bottom.
 *
 * These notes used to hang off the items panel and the runes panel, which had
 * two consequences: the same kind of information appeared in two places, and
 * both panels grew and shrank with the picks — so the two sidebars stopped
 * lining up as soon as one side had an unmodelled passive and the other did not.
 *
 * As its own panel it is always there, always last, and always the same shape.
 * That it is sometimes empty is the point: "everything here is simulated" is
 * worth reading too.
 */

import type { ResolvedItem } from '../model/items';
import { getItemEffect } from '../model/itemEffects';
import { getRuneDefinition, isRuneModelled } from '../model/runes';
import type { LoadoutState } from '../state/build';
import { activeItemIds, activeRuneIds, activeShardIds } from '../state/build';
import { Panel } from './components/Panel';

interface Props {
  loadout: LoadoutState;
  items: ResolvedItem[];
  /** Names the side, so the two panels never look interchangeable. */
  title: string;
}

export function LoadoutNotes({ loadout, items, title }: Props) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const picked = activeItemIds(loadout)
    .map((id) => byId.get(id))
    .filter((item): item is ResolvedItem => Boolean(item));

  const simulated = picked.filter((item) => getItemEffect(item.id));
  const statsOnly = picked.filter((item) => !getItemEffect(item.id));
  const unparsed = picked.filter((item) => item.unparsedStatLines.length > 0);

  const runeIds = [...activeRuneIds(loadout), ...activeShardIds(loadout)];
  const runesNotModelled = runeIds
    .filter((id) => !isRuneModelled(id))
    .map((id) => getRuneDefinition(id)?.name ?? `Rune ${id}`);

  const empty =
    simulated.length === 0 &&
    statsOnly.length === 0 &&
    unparsed.length === 0 &&
    runesNotModelled.length === 0;

  return (
    <Panel title={title} className="loadout-notes">
      {empty && (
        <p className="field-hint">
          Nothing picked yet that needs a footnote. Passives and rune formulas that this
          calculator does not model are listed here as soon as they are in the build.
        </p>
      )}

      {simulated.length > 0 && (
        <div className="item-note">
          <span className="tag good">simulated</span>
          <ul>
            {simulated.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — {getItemEffect(item.id)?.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {statsOnly.length > 0 && (
        <div className="item-note">
          <span className="tag warn">stats only</span>
          <ul>
            {statsOnly.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — stats count in full, the passive is not modelled.
              </li>
            ))}
          </ul>
        </div>
      )}

      {runesNotModelled.length > 0 && (
        <div className="item-note">
          <span className="tag warn">not modelled</span>
          <ul>
            {runesNotModelled.map((name) => (
              <li key={name}>
                <strong>{name}</strong> — no effect in the simulation, not part of the result.
              </li>
            ))}
          </ul>
        </div>
      )}

      {unparsed.length > 0 && (
        <div className="item-note">
          <span className="tag danger">unread</span>
          <ul>
            {unparsed.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — {item.unparsedStatLines.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
