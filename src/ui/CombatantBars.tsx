/**
 * A combatant's health and resource, drawn the way the game draws them.
 *
 * Both sides get the same frame: name, the two numbers, a health track and a
 * resource track under it. Health is green on both sides and the resource is
 * blue, as in the client — the enemy's bar is red on the map, but in the panel
 * that shows the two side by side, red would read as "already hurt" rather than
 * as "the other team".
 *
 * Damage from the step in focus stays on the bar as a translucent chunk past the
 * end of the fill, which is how the client shows health just lost: the bar says
 * both where the target is and what this hit took off it.
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
  /** Health lost in the focused step, drawn translucent past the fill. */
  lost?: number;
  /** Mana, energy, fury — null for the resourceless. */
  resource?: (BarValue & { label: string }) | null;
  /** Shown on the right of the name row instead of the health numbers. */
  note?: string;
  /**
   * Crowd control on this combatant at the moment shown.
   *
   * Its own rail under the health, because it answers a different question:
   * not how much is left but whether they can do anything about it. The fade is
   * the remaining time — full at the start of the effect, gone at its end.
   */
  crowdControl?: { label: string; seconds: number }[];
}

const int = (value: number): string => Math.round(value).toLocaleString('en-US');
const share = (value: BarValue): number =>
  Math.max(0, Math.min(100, (value.current / Math.max(1, value.max)) * 100));

export function CombatantBars({
  name,
  side,
  health,
  shield = 0,
  lost = 0,
  resource,
  note,
  crowdControl,
}: Props) {
  const healthShare = share(health);
  // Cannot run past the rail: a hit bigger than the health that was there is
  // drawn as the part of the bar it actually emptied.
  const lostShare = Math.max(0, Math.min(100 - healthShare, (lost / Math.max(1, health.max)) * 100));
  return (
    <div className={`combatant side-${side}`}>
      <div className="combatant-head">
        <span className="combatant-name">{name}</span>
        {note && <span className="combatant-numbers mono">{note}</span>}
      </div>

      {/* The numbers ride on the bar, the way the HUD puts them. */}
      <div className="bar-track health">
        <div className="bar-fill health" style={{ width: `${healthShare}%` }} />
        {lostShare > 0 && (
          <div
            className="bar-fill lost"
            style={{ left: `${healthShare}%`, width: `${lostShare}%` }}
            title={`${int(lost)} damage in this step`}
          />
        )}
        {shield > 0 && (
          /*
           * Past the end of health, not over the front of it.
           *
           * A shield in the client extends the bar to the right — it is health
           * you have on top of what is left, and drawn from the left edge it read
           * as the first 190 points of health being special.
           */
          <div
            className="bar-fill shield"
            style={{
              left: `${healthShare}%`,
              width: `${Math.min(100 - healthShare, (shield / Math.max(1, health.max)) * 100)}%`,
            }}
          />
        )}
        <span className="bar-caption mono">
          {int(health.current)} / {int(health.max)}
          {shield > 0 ? ` (+${int(shield)})` : ''}
        </span>
      </div>

      {/*
        * The crowd-control rail, only while something is on it.
        *
        * Nothing here changes a damage number — the target never acts in this
        * simulation — but the airborne window is why the next two hits land
        * unanswered, and a row of bars that leaves it out is missing the reason.
        */}
      {crowdControl && crowdControl.length > 0 && (
        <div className="cc-rail">
          {crowdControl.map((entry) => (
            <span className="cc-chip" key={entry.label}>
              <span className="cc-label">{entry.label}</span>
              <span className="cc-time mono">{entry.seconds.toFixed(2)} s</span>
            </span>
          ))}
        </div>
      )}

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
