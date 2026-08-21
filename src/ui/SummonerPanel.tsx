/**
 * Summoner spell selection — the same two slots the client gives you.
 *
 * It sits between runes and simulation because that is where it sits in a
 * build: after what you scale with, before how you press it. The picked spells
 * are what the combo bar offers, so this panel decides that strip's contents
 * rather than the strip guessing.
 *
 * Both slots always render, even empty, so the panel's height never moves — the
 * two sidebars are cast from one mould and a collapsing panel breaks the pair.
 */

import { imageUrls } from '../data/ddragon';
import type { DDragonSummonerSpell } from '../data/types';
import { isSummonerSimulated } from '../model/summoners';
import { Panel } from './components/Panel';
import { SelectMenu, type SelectOption } from './components/SelectMenu';
import type { LoadoutState } from '../state/build';

interface Props {
  summoners: Record<string, DDragonSummonerSpell>;
  version: string;
  offline: boolean;
  loadout: LoadoutState;
  onChange: (patch: Partial<LoadoutState>) => void;
}

const EMPTY = '__none__';

export function SummonerPanel({ summoners, version, offline, loadout, onChange }: Props) {
  const all = Object.values(summoners).sort((a, b) => a.name.localeCompare(b.name));

  if (offline || all.length === 0) {
    return (
      <Panel title="Summoners">
        <p className="empty-note">
          Data Dragon is unreachable — die Spell-Liste kann nicht geladen werden.
        </p>
      </Panel>
    );
  }

  function pick(slot: number, id: string): void {
    const next = [...loadout.summonerIds];
    next[slot] = id === EMPTY ? null : id;
    // Two Flashes is not a build. Taking a spell the other slot holds swaps
    // them, which is what dragging one onto the other does in the client.
    const other = slot === 0 ? 1 : 0;
    if (id !== EMPTY && loadout.summonerIds[other] === id) next[other] = loadout.summonerIds[slot] ?? null;
    onChange({ summonerIds: next });
  }

  function optionsFor(): SelectOption[] {
    return [
      { id: EMPTY, label: 'Kein Spell' },
      ...all.map((spell) => ({
        id: spell.id,
        label: spell.name,
        detail: `${spell.cooldownBurn} s${isSummonerSimulated(spell.id) ? ' · simuliert' : ''}`,
        iconUrl: imageUrls.summoner(version, spell.image.full),
      })),
    ];
  }

  return (
    <Panel title="Summoners">
      <div className="summoner-slots">
        {[0, 1].map((slot) => {
          const id = loadout.summonerIds[slot] ?? null;
          const spell = id ? summoners[id] : undefined;
          return (
            <div className="summoner-slot" key={slot}>
              <div className={`summoner-icon${spell ? '' : ' empty'}`} aria-hidden="true">
                {spell ? (
                  <img src={imageUrls.summoner(version, spell.image.full)} alt="" />
                ) : (
                  <span>{slot === 0 ? 'D' : 'F'}</span>
                )}
              </div>
              <div className="summoner-choice">
                <SelectMenu
                  value={id ?? EMPTY}
                  options={optionsFor()}
                  onChange={(next) => pick(slot, next)}
                  ariaLabel={`Summoner spell ${slot === 0 ? 'D' : 'F'}`}
                  placeholder="Kein Spell"
                  searchable
                  searchPlaceholder="Spell suchen …"
                />
                <p className="summoner-hint">
                  {spell
                    ? isSummonerSimulated(spell.id)
                      ? `${spell.cooldownBurn} s — wird simuliert`
                      : `${spell.cooldownBurn} s — nur Auswahl`
                    : 'Leer'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
