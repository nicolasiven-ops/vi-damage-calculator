/**
 * The ability bar, as the client draws it: five icons in a row, points under each.
 *
 * Clicking an icon puts a point in it and cycles back to zero past the last rank
 * — five for the basics, three for the ultimate — which is the same gesture as
 * levelling a skill in game. It now spends from a budget: one point per level, so
 * a click that cannot be paid for is refused and says so in the tooltip. Right
 * click takes a single point back, which the cycle cannot do once an ability is
 * halfway up.
 *
 * Points skilled past what the level pays for are drawn as hollow pips rather
 * than dropped. Drag the level down and the last points taken go grey in the order
 * they were taken; drag it back up and they come back, which is why the order is
 * worth storing.
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
  /**
   * Ranks skilled but not paid for at this level, drawn hollow behind the filled
   * pips. Zero for every tile when the level covers the whole order.
   */
  held?: number;
  /**
   * What the simulation says about this ability at the focused moment.
   *
   * The client shows this on the icon and so does this strip: ranks say what you
   * bought, this says what you can press.
   */
  readiness?: {
    readyIn: number;
    cooldown: number;
    charges?: { available: number; max: number; nextIn: number; interval: number };
  };
}

interface Props {
  tiles: AbilityTile[];
  /**
   * Left out for a read-only strip.
   *
   * The target's abilities are shown because they say who you are fighting, but
   * nothing it does is simulated — so there is nothing to set.
   */
  onSkillUp?: (slot: AbilitySlot) => void;
  /** One point back, from a right click. */
  onSkillDown?: (slot: AbilitySlot) => void;
  /** Every point back, which is what clicking past the last rank does. */
  onSkillClear?: (slot: AbilitySlot) => void;
  /** Points spent and available, for refusing a click that cannot be paid for. */
  points?: { spent: number; available: number };
}

export function AbilityStrip({
  tiles,
  onSkillUp,
  onSkillDown,
  onSkillClear,
  points,
}: Props) {
  const broke = points ? points.spent >= points.available : false;
  return (
    <div className="ability-strip">
      {tiles.map((tile) => {
        const passive = tile.maxRank <= 1;
        const editable = Boolean(onSkillUp) && !passive;
        const held = tile.held ?? 0;
        const atMax = tile.rank + held >= tile.maxRank;
        // Past the last rank it starts over, so one control both adds and clears.
        const affordable = !broke;
        return (
          <button
            key={tile.slot}
            className={`ability-tile slot-${tile.slot.toLowerCase()}${editable ? '' : ' readonly'}`}
            onClick={
              editable
                ? () => {
                    const slot = tile.slot as AbilitySlot;
                    if (atMax) onSkillClear?.(slot);
                    else if (affordable) onSkillUp?.(slot);
                  }
                : undefined
            }
            onContextMenu={
              editable
                ? (event) => {
                    event.preventDefault();
                    onSkillDown?.(tile.slot as AbilitySlot);
                  }
                : undefined
            }
            disabled={!editable}
            title={
              passive
                ? `${tile.name} — passive`
                : !editable
                  ? `${tile.name} — not simulated`
                  : atMax
                    ? `${tile.name} — rank ${tile.rank} of ${tile.maxRank}. Click to take every point back.`
                    : affordable
                      ? `${tile.name} — rank ${tile.rank} of ${tile.maxRank}. Click for a point, right click to take one back.`
                      : `${tile.name} — rank ${tile.rank} of ${tile.maxRank}. No points left at this level.`
            }
            aria-label={
              passive ? `${tile.name}, passive` : `${tile.name}, rank ${tile.rank} of ${tile.maxRank}`
            }
          >
            <span className="ability-badge">
              {tile.icon ? <img src={tile.icon} alt="" /> : <span>{tile.slot}</span>}
              <span className="ability-key">{tile.slot}</span>

              {/*
               * The cooldown, the way the game draws it: the icon goes dark and
               * the dark part shrinks away as it comes back up. The seconds are
               * on top of it, because "3.4" is the number you actually want.
               *
               * A charge ability has two timers and only one of them is the
               * answer. With a charge in hand, the ability is castable and the
               * short gap between casts is the only thing running — that gets a
               * faint dim and no number. With no charges left, the thing you are
               * waiting for is the recharge, so *that* is what the wedge sweeps
               * and what the seconds count down. Showing the gap there was the
               * bug: a bright, apparently ready icon on an ability that could not
               * be cast for another six seconds.
               */}
              {(() => {
                const state = readinessOf(tile);
                if (!state) return null;
                return (
                  <>
                    {/*
                     * A wedge from twelve o'clock, clockwise, the way the client
                     * draws it — not a bar. A bar has to start somewhere, and
                     * wherever that is, it reads as a value rather than as time
                     * running out.
                     */}
                    <span
                      className="ability-cd-wipe"
                      style={{
                        background: `conic-gradient(rgba(3, 6, 12, ${
                          state.kind === 'recharge' ? 0.74 : 0.34
                        }) ${state.percent.toFixed(1)}%, transparent 0)`,
                      }}
                    />
                    {state.kind === 'recharge' && (
                      <span className="ability-cd-seconds mono">
                        {state.remaining < 10
                          ? state.remaining.toFixed(1)
                          : Math.round(state.remaining)}
                      </span>
                    )}
                  </>
                );
              })()}

              {/* Charges in hand, where the client puts them. */}
              {tile.readiness?.charges && tile.readiness.charges.max > 1 && (
                <span className="ability-charges mono">{tile.readiness.charges.available}</span>
              )}
            </span>
            {/* The passive keeps an empty rail so all five tiles are one height. */}
            {/*
              * Three states per pip, not two: paid for, skilled but not paid for
              * at this level, and empty. The middle one is the point of the whole
              * thing — it says "you took this, the level does not cover it" rather
              * than quietly forgetting the decision.
              */}
            <span className={`ability-pips${passive ? ' none' : ''}`}>
              {Array.from({ length: passive ? 1 : tile.maxRank }, (_, index) => (
                <span
                  key={index}
                  className={`rank-pip${
                    index < tile.rank ? ' filled' : index < tile.rank + held ? ' held' : ''
                  }`}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Which of an ability's timers to draw, and how far it has got.
 *
 * Returns null when there is nothing to draw. 'recharge' is the one you are
 * waiting for — no charges left, or a plain ability on cooldown; 'gap' is the
 * short unavailability after a cast that still has charges in hand.
 */
function readinessOf(
  tile: AbilityTile,
): { kind: 'recharge' | 'gap'; remaining: number; percent: number } | null {
  const readiness = tile.readiness;
  if (!readiness) return null;
  const charges = readiness.charges;

  if (charges && charges.max > 1) {
    if (charges.available === 0 && charges.nextIn > 0.05) {
      return {
        kind: 'recharge',
        remaining: charges.nextIn,
        percent: Math.min(100, (charges.nextIn / Math.max(0.1, charges.interval)) * 100),
      };
    }
    if (readiness.readyIn > 0.05) {
      return {
        kind: 'gap',
        remaining: readiness.readyIn,
        percent: Math.min(100, (readiness.readyIn / Math.max(0.1, readiness.cooldown)) * 100),
      };
    }
    return null;
  }

  if (readiness.readyIn <= 0.05) return null;
  return {
    kind: 'recharge',
    remaining: readiness.readyIn,
    percent: Math.min(100, (readiness.readyIn / Math.max(0.1, readiness.cooldown)) * 100),
  };
}
