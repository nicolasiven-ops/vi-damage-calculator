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

import type { DDragonRuneTree, DDragonSummonerSpell } from '../data/types';
import type { ResolvedItem } from '../model/items';
import { getItemEffect } from '../model/itemEffects';
import { SHARD_DEFINITIONS, getRuneDefinition, isRuneModelled } from '../model/runes';
import { summonerGap } from '../model/summoners';
import type { LoadoutState } from '../state/build';
import { activeItemIds, activeRuneIds, activeShardIds, activeSummonerIds } from '../state/build';
import { Panel } from './components/Panel';

interface Props {
  loadout: LoadoutState;
  items: ResolvedItem[];
  /** Data Dragon's spell table, for naming what the picks refer to. */
  summoners: Record<string, DDragonSummonerSpell>;
  /**
   * The rune trees, purely to name the runes.
   *
   * The maintained registry only knows the runes the engine models, so an
   * unmodelled one had no name here — and "Rune 8137" is the one thing a note
   * about it must not say, since the whole point is telling you which pick is
   * missing from the result.
   */
  runeTrees: DDragonRuneTree[];
  /** Names the side, so the two panels never look interchangeable. */
  title: string;
}

export function LoadoutNotes({ loadout, items, summoners, runeTrees, title }: Props) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const picked = activeItemIds(loadout)
    .map((id) => byId.get(id))
    .filter((item): item is ResolvedItem => Boolean(item));

  const simulated = picked.filter((item) => getItemEffect(item.id));
  /*
   * Only items that have something to leave out.
   *
   * A Cloth Armor has no passive, so "the passive is not modelled" is not a
   * footnote about it — it is a line of noise about an item that is fully
   * accounted for.
   */
  const statsOnly = picked.filter(
    (item) => !getItemEffect(item.id) && item.descriptionText.trim().length > 0,
  );
  const unparsed = picked.filter((item) => item.unparsedStatLines.length > 0);

  const runeNames = new Map<number, string>();
  for (const tree of runeTrees) {
    for (const slot of tree.slots) {
      for (const rune of slot.runes) runeNames.set(rune.id, rune.name);
    }
  }
  for (const shard of SHARD_DEFINITIONS) runeNames.set(shard.id, shard.name);

  const runeIds = [...activeRuneIds(loadout), ...activeShardIds(loadout)];
  const runesNotModelled = runeIds
    .filter((id) => !isRuneModelled(id))
    .map((id) => runeNames.get(id) ?? getRuneDefinition(id)?.name ?? `Rune ${id}`);

  /*
   * Summoner spells are worth their own lines rather than one blanket sentence:
   * Ignite lands in the numbers, Exhaust would change them and does not, and
   * Flash never could. Collapsing those into "not modelled" would read as three
   * equal omissions.
   */
  const summonerNotes = activeSummonerIds(loadout)
    .map((id) => ({ name: summoners[id]?.name ?? id.replace(/^Summoner/, ''), gap: summonerGap(id) }))
    .filter((entry): entry is { name: string; gap: string } => entry.gap !== null);

  const empty =
    summonerNotes.length === 0 &&
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

      {summonerNotes.length > 0 && (
        <div className="item-note">
          <span className="tag warn">summoner</span>
          <ul>
            {summonerNotes.map((entry) => (
              <li key={entry.name}>
                <strong>{entry.name}</strong> — {entry.gap}
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
