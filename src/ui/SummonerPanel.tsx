/**
 * Summoner spells — the two slots, the way the client shows them.
 *
 * Two large icons and nothing else, because that is all a chosen spell needs to
 * say. Clicking one opens the nine legal spells underneath it; picking closes
 * it again. A dropdown per slot said the same thing in three times the height,
 * with the name spelled out for a choice nobody reads by name.
 *
 * It sits between runes and simulation because that is where it sits in a build:
 * after what you scale with, before how you press it. The picked spells are what
 * the combo bar offers, so this panel decides that strip's contents rather than
 * the strip guessing.
 */

import { useState } from 'react';
import { isSummonerSimulated } from '../model/summoners';
import { Panel } from './components/Panel';
import type { LoadoutState } from '../state/build';

/** One spell the picker can offer, whatever file it came from. */
export interface SummonerOption {
  id: string;
  name: string;
  /** What the combo strip calls it, where there is room for one word. */
  shortName?: string;
  iconUrl: string;
  cooldownBurn: string;
}

interface Props {
  summoners: SummonerOption[];
  offline: boolean;
  loadout: LoadoutState;
  onChange: (patch: Partial<LoadoutState>) => void;
}

export function SummonerPanel({ summoners, offline, loadout, onChange }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const all = summoners;
  const byId = new Map(all.map((entry) => [entry.id, entry]));

  if (offline || all.length === 0) {
    return (
      <Panel title="Summoners">
        <p className="empty-note">
          Data Dragon is unreachable — die Spell-Liste kann nicht geladen werden.
        </p>
      </Panel>
    );
  }

  function pick(slot: number, id: string | null): void {
    const next = [...loadout.summonerIds];
    const previous = next[slot] ?? null;
    next[slot] = id;
    // Two Flashes is not a build. Taking a spell the other slot holds swaps the
    // two, which is what dragging one onto the other does in the client.
    const other = slot === 0 ? 1 : 0;
    if (id !== null && next[other] === id) next[other] = previous;
    onChange({ summonerIds: next });
    setOpen(null);
  }

  return (
    <Panel title="Summoners">
      <div className="summoner-slots">
        {[0, 1].map((slot) => {
          const id = loadout.summonerIds[slot] ?? null;
          const spell = id ? byId.get(id) : undefined;
          const key = slot === 0 ? 'D' : 'F';
          return (
            <button
              key={slot}
              className={`summoner-slot${open === slot ? ' open' : ''}`}
              onClick={() => setOpen((current) => (current === slot ? null : slot))}
              aria-expanded={open === slot}
              title={spell ? spell.name : `Slot ${key} — nothing picked`}
            >
              {spell ? (
                <img src={spell.iconUrl} alt={spell.name} />
              ) : (
                <span className="summoner-empty">{key}</span>
              )}
              <span className="summoner-key">{key}</span>
            </button>
          );
        })}
      </div>

      {open !== null && (
        <div className="summoner-picker">
          {all.map((spell) => {
            const chosen = loadout.summonerIds[open] === spell.id;
            return (
              <button
                key={spell.id}
                className={`summoner-option${chosen ? ' selected' : ''}`}
                onClick={() => pick(open, chosen ? null : spell.id)}
                title={`${spell.name} — ${spell.cooldownBurn} s${
                  isSummonerSimulated(spell.id) ? ' · wird simuliert' : ' · nur Auswahl'
                }`}
              >
                <img src={spell.iconUrl} alt={spell.name} />
                {/* A dot for the ones the engine resolves, as on the runes. */}
                {isSummonerSimulated(spell.id) && <span className="summoner-dot" />}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
