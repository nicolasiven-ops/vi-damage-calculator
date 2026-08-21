/**
 * A combatant's health and resource, drawn the way the game draws them.
 *
 * Both sides get the same frame: name, the two numbers, a health track and a
 * resource track under it. Colour carries the side the way League does — green
 * for the champion you are playing, red for the one you are hitting, blue for
 * the resource — because that mapping needs no legend for anyone who has played
 * the game.
 *
 * Both bars empty towards the left: the fill is anchored at the left edge and
 * shrinks, so the empty part grows in from the right. That is what a health bar
 * in the client does, and reading it should not require re-learning it here.
 *
 */

export interface BarValue {
  current: number;
  max: number;
}

interface Props {
  name: string;
  /** Which side of the fight, which decides the health colour. */
  side: 'ally' | 'enemy';
  health: BarValue;
  /** Shield sits past the end of health, as an overlay, the way it does in game. */
  shield?: number;
  /** Mana, energy, fury — null for the resourceless. */
  resource?: (BarValue & { label: string }) | null;
  /** Shown on the right of the name row instead of the health numbers. */
  note?: string;
}

const int = (value: number): string => Math.round(value).toLocaleString('en-US');
const share = (value: BarValue): number =>
  Math.max(0, Math.min(100, (value.current / Math.max(1, value.max)) * 100));

export function CombatantBars({
  name,
  side,
  health,
  shield = 0,
  resource,
  note,
}: Props) {
  return (
    <div className={`combatant side-${side}`}>
      <div className="combatant-head">
        <span className="combatant-name">{name}</span>
        {note && <span className="combatant-numbers mono">{note}</span>}
      </div>

      {/* The numbers ride on the bar, the way the HUD puts them. */}
      <div className="bar-track health">
        <div className="bar-fill health" style={{ width: `${share(health)}%` }} />
        {shield > 0 && (
          <div
            className="bar-fill shield"
            style={{ width: `${Math.min(100, (shield / Math.max(1, health.max)) * 100)}%` }}
          />
        )}
        <span className="bar-caption mono">
          {int(health.current)} / {int(health.max)}
          {shield > 0 ? ` (+${int(shield)})` : ''}
        </span>
      </div>

      {/* A resourceless champion gets an empty rail rather than a missing one,
          so the two sides stay the same height whatever they run on. */}
      <div className={`bar-track resource${resource ? '' : ' empty'}`}>
        {resource && (
          <>
            <div className="bar-fill resource" style={{ width: `${share(resource)}%` }} />
            <span className="bar-caption mono">
              {int(resource.current)} / {int(resource.max)}
            </span>
          </>
        )}
        {!resource && <span className="bar-caption mono muted">no resource</span>}
      </div>
    </div>
  );
}
