/**
 * The duel as two lanes of icons running at a trigger line.
 *
 * The health curves answered "who wins" and nothing else. What a fight actually
 * consists of is a sequence: he presses this, she presses that, this lands, that
 * one is eaten by a knock-up. So: two lanes, one per champion, time running right
 * to left. Everything upcoming queues on the right, the vertical line is *now*, and
 * an icon crossing it is the moment its effect happens.
 *
 * Three things make it readable rather than decorative:
 *
 *  - **Distance is time.** One second is a fixed number of pixels in both lanes, so
 *    two icons level with each other happened together, and a gap is a gap in the
 *    fight. Nothing is spaced for looks.
 *  - **The trigger line is shared.** Both lanes cross the same line, so "who got
 *    there first" is a thing you can see rather than compute.
 *  - **Crowd control stops the lane it is aimed at.** Not as decoration: the engine
 *    genuinely refuses to act during those windows (see `Interruption`), so the
 *    hatched band is the reason the icons behind it are late.
 *
 * It reads the playhead the rest of the app already owns, so "Start simulation"
 * drives it: with the clock at rest the whole fight stands still with its opening
 * on the line, and while it runs the icons slide left through it.
 */

import type { DuelOutcome } from '../engine/duel';
import type { DamageInstance, TimelineSpan } from '../engine/types';

interface Props {
  outcome: DuelOutcome;
  viName: string;
  enemyName: string;
  /** Icons by ability slot, from Data Dragon. */
  viIcons: Partial<Record<string, string>>;
  enemyIcons: Partial<Record<string, string>>;
  /** Where the fight is right now, or null when the clock is at rest. */
  playhead: number | null;
}

/** Pixels per second. The whole scale of the view is this one number. */
const SCALE = 132;
/** Where *now* sits, as a share of the width. */
const TRIGGER = 0.22;
const LANE_HEIGHT = 62;

interface Beat {
  id: string;
  time: number;
  label: string;
  icon: string | null;
  /** Letter shown when there is no icon: AA, or the slot. */
  glyph: string;
  amount: number;
  kind: string;
}

/**
 * One lane's beats: what this side did, at the moment it happened.
 *
 * Damage instances rather than presses, because a press that was refused did not
 * happen and a press that produced three instances is three things landing. Same
 * instant folds together — a proc riding an attack is one beat with one icon, not
 * two icons on one pixel.
 */
function beatsOf(
  instances: DamageInstance[],
  icons: Partial<Record<string, string>>,
): Beat[] {
  const out: Beat[] = [];
  for (const instance of instances) {
    if (instance.mitigated <= 0) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.time - instance.time) < 0.02) {
      last.amount += instance.mitigated;
      if (!last.icon && icons[instance.sourceId]) {
        last.icon = icons[instance.sourceId] ?? null;
        last.label = instance.sourceLabel;
        last.glyph = instance.sourceId;
      }
      continue;
    }
    out.push({
      id: instance.id,
      time: instance.time,
      label: instance.sourceLabel,
      icon: icons[instance.sourceId] ?? null,
      glyph: instance.sourceId === 'AA' ? 'AA' : instance.sourceId.slice(0, 2),
      amount: instance.mitigated,
      kind: instance.sourceKind,
    });
  }
  return out;
}

/**
 * The windows a side could not act in — which is the *other* side's crowd control.
 *
 * Read from the opponent's timeline on purpose. A champion's own run records both
 * the crowd control they applied and the windows they lost to someone else's, both
 * in the `cc` lane, and telling those apart after the fact means trusting a label.
 * Whose lane a band belongs on is not ambiguous at all: the one who could not act.
 */
function stopsOf(spans: TimelineSpan[]): TimelineSpan[] {
  return spans.filter(
    (span) => span.lane === 'cc' && span.stopsActions === true && span.end > span.start,
  );
}

export function DuelLanes({
  outcome,
  viName,
  enemyName,
  viIcons,
  enemyIcons,
  playhead,
}: Props) {
  const now = playhead ?? 0;
  const viBeats = beatsOf(outcome.a.instances, viIcons);
  const enemyBeats = beatsOf(outcome.b.instances, enemyIcons);

  /*
   * Health at this instant, read off the curves the driver built. The bars are the
   * reason the lanes are worth watching: an icon crossing the line and a bar
   * dropping are the same event seen twice.
   */
  const healthAt = (curve: { time: number; health: number }[]): number => {
    let value = curve[0]?.health ?? 0;
    for (const point of curve) {
      if (point.time > now + 0.0005) break;
      value = point.health;
    }
    return value;
  };

  const viFull = outcome.curveA[0]?.health ?? 1;
  const enemyFull = outcome.curveB[0]?.health ?? 1;
  const viNow = healthAt(outcome.curveA);
  const enemyNow = healthAt(outcome.curveB);

  const lane = (
    side: 'vi' | 'enemy',
    name: string,
    beats: Beat[],
    stops: TimelineSpan[],
    full: number,
    left: number,
  ) => (
    <div className={`lane lane-${side}`}>
      <div className="lane-head">
        <span className="lane-name">{name}</span>
        <span className="lane-health mono">
          {Math.round(left).toLocaleString('en-US')}
          <span className="lane-health-max"> / {Math.round(full).toLocaleString('en-US')}</span>
        </span>
      </div>
      <div className="lane-bar">
        <div
          className="lane-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, (left / Math.max(1, full)) * 100))}%` }}
        />
      </div>
      <div className="lane-track">
        {/*
          * The windows this side is stopped in. Drawn behind the icons and hatched,
          * because it is a stretch of time rather than a thing that happened — and
          * the icons after it are late *because* of it.
          */}
        {stops.map((span) => (
          <div
            key={span.id}
            className="lane-stop"
            style={{
              left: `calc(${TRIGGER * 100}% + ${(span.start - now) * SCALE}px)`,
              width: `${Math.max(4, (span.end - span.start) * SCALE)}px`,
            }}
            title={`${span.label} — cannot act for ${(span.end - span.start).toFixed(2)} s`}
          />
        ))}

        {beats.map((beat) => {
          const offset = (beat.time - now) * SCALE;
          /* Fired already, firing right now, or still coming. */
          const state = offset < -6 ? 'past' : offset <= 6 ? 'firing' : 'coming';
          return (
            <div
              key={beat.id}
              className={`lane-beat is-${state} kind-${beat.kind}`}
              style={{ left: `calc(${TRIGGER * 100}% + ${offset}px)` }}
              title={`${beat.time.toFixed(2)} s · ${beat.label} · ${Math.round(beat.amount)} damage`}
            >
              {beat.icon ? (
                <img src={beat.icon} alt="" />
              ) : (
                <span className="lane-glyph mono">{beat.glyph}</span>
              )}
              <span className="lane-amount mono">{Math.round(beat.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="lanes" style={{ ['--lane-height' as string]: `${LANE_HEIGHT}px` }}>
      {lane('vi', viName, viBeats, stopsOf(outcome.b.spans), viFull, viNow)}
      {lane('enemy', enemyName, enemyBeats, stopsOf(outcome.a.spans), enemyFull, enemyNow)}

      {/* Now. One line for both lanes, because that is what makes them comparable. */}
      <div className="lane-trigger" style={{ left: `${TRIGGER * 100}%` }}>
        <span className="lane-trigger-time mono">{now.toFixed(2)} s</span>
      </div>
    </div>
  );
}
