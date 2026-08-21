/**
 * The ability bar, as the client draws it: five icons in a row, points under each.
 *
 * Clicking an icon puts a point in it and cycles back to zero past the last rank
 * — five for the basics, three for the ultimate — which is the same gesture as
 * levelling a skill in game, minus the level requirement this app has no reason
 * to enforce.
 *
 * It replaced a stacked list of five rows with names and separate pip strips.
 * That list was 222 px of sidebar for information the row says in 70, and the
 * names are on the combo palette and in every tooltip anyway.
 */

import type { AbilitySlot } from '../engine/types';

export interface AbilityTile {
  slot: AbilitySlot | 'P';
  name: string;
  icon: string | null;
  /** 1 or less marks a passive: no points to spend, so no pips. */
  maxRank: number;
  rank: number;
}

interface Props {
  tiles: AbilityTile[];
  /**
   * Left out for a read-only strip.
   *
   * The target's abilities are shown because they say who you are fighting, but
   * nothing it does is simulated — so there is nothing to set.
   */
  onRankChange?: (slot: AbilitySlot | 'P', rank: number) => void;
}

export function AbilityStrip({ tiles, onRankChange }: Props) {
  return (
    <div className="ability-strip">
      {tiles.map((tile) => {
        const passive = tile.maxRank <= 1;
        const editable = Boolean(onRankChange) && !passive;
        // Past the last rank it starts over, so one control both adds and clears.
        const next = (tile.rank + 1) % (tile.maxRank + 1);
        return (
          <button
            key={tile.slot}
            className={`ability-tile slot-${tile.slot.toLowerCase()}${editable ? '' : ' readonly'}`}
            onClick={editable ? () => onRankChange?.(tile.slot, next) : undefined}
            disabled={!editable}
            title={
              passive
                ? `${tile.name} — passive`
                : editable
                  ? `${tile.name} — rank ${tile.rank} of ${tile.maxRank}`
                  : `${tile.name} — not simulated`
            }
            aria-label={
              passive ? `${tile.name}, passive` : `${tile.name}, rank ${tile.rank} of ${tile.maxRank}`
            }
          >
            <span className="ability-badge">
              {tile.icon ? <img src={tile.icon} alt="" /> : <span>{tile.slot}</span>}
              <span className="ability-key">{tile.slot}</span>
            </span>
            {/* The passive keeps an empty rail so all five tiles are one height. */}
            <span className={`ability-pips${passive ? ' none' : ''}`}>
              {Array.from({ length: passive ? 1 : tile.maxRank }, (_, index) => (
                <span
                  key={index}
                  className={`rank-pip${index < tile.rank ? ' filled' : ''}`}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
