/**
 * Damage per second, moment by moment — the burst window as a shape.
 *
 * The running total says how much has landed; it cannot say how *fast*, because
 * every combo's total curve rises and a steep rise looks much like a long one.
 * This is the derivative: at any moment, the rate damage is arriving at. Each
 * hit is a hill of its own, so the picture is the combo's rhythm — where the
 * burst is, how long it lasts, and how deep the gaps between presses are.
 *
 * Two things carry meaning besides the shape. The line is coloured by the combo
 * step that owns each stretch, from one press to the next, which makes the graph
 * its own timeline: the hill under "3 · Relentless Force" is what E did. And
 * every damage instant carries a dot, the same as on the running total, so a
 * bump can be pointed at and clicked.
 *
 * Nothing is filled in beneath the line on purpose: the area is not a quantity
 * anyone reads here, and a coloured wash under a spiky curve buried the spikes.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import type { TimelineLane, TimelineSpan } from '../engine/types';
import { TYPE_COLOR, laneColor } from './palette';
import {
  AXIS_LEFT,
  AXIS_RIGHT,
  axisTicks,
  formatSeconds,
  formatTick,
  plotWidthOf,
  timeToX,
  timeWindowOf,
  windowSpan,
  xToTime,
} from './timeAxis';

interface Props {
  analysis: ComboAnalysis;
  /** Where playback stands, in seconds; null when it is not running. */
  playhead?: number | null;
  linkedStepUid?: string | null;
  pinnedStepUid?: string | null;
  onPinStep?: (uid: string | null) => void;
}

const HEIGHT = 300;
const MIN_WIDTH = 520;
const PADDING = { top: 18, bottom: 34 };

/**
 * The width of the bell each hit is spread over, in seconds.
 *
 * A hit is an instant — a rate at an instant is either zero or infinite — so any
 * "damage per second at this moment" has to spread each hit over some window.
 * A box window (damage inside ±0.5 s) gives the right numbers and a staircase:
 * the curve jumps the moment a hit enters or leaves the box, so the shape is
 * made of the window's edges rather than the fight's.
 *
 * A Gaussian bell spreads the same damage smoothly, so the curve is smooth
 * everywhere and every bump belongs to a hit rather than to an edge. The area
 * under the curve is still the total damage — the smoothing moves damage in
 * time, it never invents or loses any.
 *
 * 0.09 s is deliberately narrow. A wider bell (0.3 s was tried) merged hits that
 * are 0.2 s apart into one broad hump, which looked like a smooth ramp the fight
 * never had — the shape was the smoothing's, not the combo's. At 0.09 s every
 * damage instance keeps its own hill and only truly simultaneous hits — an
 * ability and its on-hit riders — share one, which is right: they *are* one
 * moment.
 *
 * The peaks are correspondingly high, and that is not an exaggeration: 400
 * damage landing in an instant really is a rate of thousands per second for that
 * instant. The area under each hill is still exactly that hit's damage.
 */
const SIGMA = 0.09;
/** Beyond three sigma a hit contributes less than a thousandth. */
const KERNEL_REACH = SIGMA * 3;

/**
 * The combo, as stretches of time.
 *
 * One stretch per step, from the moment it was pressed until the next one was —
 * which is what makes the graph readable as a timeline: the hump under "3 · E"
 * is what E did, and the dip after it is the wait before the next press. Effect
 * spans were tried here first and were the wrong choice: a four-second buff and
 * a shield that lasts the whole fight colour everything and explain nothing,
 * while the thing you actually want to attribute a bump to is the button.
 */
function comboStretches(
  spans: TimelineSpan[],
  window: { start: number; end: number },
): { stepUid: string; label: string; lane: TimelineLane; from: number; to: number }[] {
  /*
   * A step can produce two cast spans: the input gap ("Q cast") and the cast
   * itself ("Vault Breaker (Q)"). The stretch starts at the earlier one, because
   * that is when the button went down, but it is *named* after the longer one —
   * the gap's label is a mechanism, the cast's label is the move.
   */
  const firstCast = new Map<string, { start: number; label: string; span: number; lane: TimelineLane }>();
  for (const span of spans) {
    if (span.kind !== 'cast' || !span.stepUid) continue;
    const seen = firstCast.get(span.stepUid);
    const length = span.end - span.start;
    firstCast.set(span.stepUid, {
      start: seen ? Math.min(seen.start, span.start) : span.start,
      label: !seen || length > seen.span ? span.label : seen.label,
      span: seen ? Math.max(seen.span, length) : length,
      lane: span.lane,
    });
  }

  const ordered = [...firstCast.entries()]
    .map(([stepUid, entry]) => ({ stepUid, ...entry }))
    .sort((a, b) => a.start - b.start);

  return ordered
    .map((entry, index) => ({
      stepUid: entry.stepUid,
      label: `${index + 1} · ${entry.label}`,
      lane: entry.lane,
      from: entry.start,
      // A step owns the time until the next one was pressed, and the last one
      // owns the rest of the fight.
      to: ordered[index + 1]?.start ?? window.end,
    }))
    .filter((entry) => entry.to > window.start && entry.from < window.end);
}

export function DpsChart({ analysis, playhead, linkedStepUid, pinnedStepUid, onPinStep }: Props) {
  const [width, setWidth] = useState(940);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const attachPlot = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;

    const measure = (value: number): boolean => {
      if (value <= 0) return false;
      setWidth(Math.max(MIN_WIDTH, Math.round(value)));
      return true;
    };

    if (!measure(element.getBoundingClientRect().width)) {
      let attempts = 0;
      const retry = (): void => {
        if (!element.isConnected || attempts > 30) return;
        attempts += 1;
        if (!measure(element.getBoundingClientRect().width)) requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  // The same window and margins as the total curve and the Gantt: one axis.
  const window = useMemo(
    () => timeWindowOf(analysis.timeToFirstDamage, analysis.duration),
    [analysis.timeToFirstDamage, analysis.duration],
  );
  const plotWidth = plotWidthOf(width);
  const x = (time: number) => timeToX(time, width, window);
  const ticks = useMemo(() => axisTicks(window, width), [window, width]);

  /*
   * No strip of bars above the plot any more: the stretches are the graph's own
   * colours, and a second copy of them as Gantt bars was the same information
   * twice — once where it means something and once where it just took height.
   */
  const plotTop = PADDING.top;
  const plotBottom = HEIGHT - PADDING.bottom;

  /**
   * The rate curve, sampled every two pixels.
   *
   * Sampling in pixels rather than in seconds keeps the cost the same whether
   * the combo is two seconds long or forty, and two pixels is finer than the
   * line is thick.
   */
  const samples = useMemo(() => {
    const hits = analysis.curve.map((point) => point.instance);
    // One sample per pixel: a hill this narrow is a few pixels wide, and
    // sampling coarser than the line is thick would clip its top off.
    const steps = Math.max(2, Math.round(plotWidth));
    const scale = 1 / (SIGMA * Math.sqrt(2 * Math.PI));
    const out: { time: number; rate: number }[] = [];

    for (let index = 0; index <= steps; index += 1) {
      const time = window.start + (windowSpan(window) * index) / steps;
      let rate = 0;
      for (const hit of hits) {
        const gap = hit.time - time;
        if (gap > KERNEL_REACH) break; // hits are in time order
        if (gap < -KERNEL_REACH) continue;
        rate += hit.mitigated * scale * Math.exp(-(gap * gap) / (2 * SIGMA * SIGMA));
      }
      out.push({ time, rate });
    }
    return out;
  }, [analysis.curve, window, plotWidth]);

  /**
   * The curve, cut at every press and coloured by the step that owns it.
   *
   * Neighbouring stretches share a sample so the fills touch instead of leaving
   * a hairline of background between them.
   */
  const segments = useMemo(() => {
    const stretches = comboStretches(analysis.spans, window);

    const ownerAt = (time: number) =>
      stretches.find((entry) => time >= entry.from - 0.0005 && time < entry.to - 0.0005) ??
      (stretches.length > 0 && time >= (stretches[stretches.length - 1]?.from ?? 0)
        ? stretches[stretches.length - 1]
        : null);

    type Segment = {
      color: string;
      label: string;
      stepUid?: string;
      points: { time: number; rate: number }[];
    };
    const out: Segment[] = [];
    let current: Segment | null = null;

    for (const sample of samples) {
      const owner = ownerAt(sample.time);
      const color = owner ? laneColor(owner.lane) : 'var(--text-dim)';
      const label = owner?.label ?? 'Before the first press';
      if (!current || current.label !== label) {
        if (current) {
          current.points.push(sample);
          out.push(current);
        }
        current = {
          color,
          label,
          ...(owner?.stepUid ? { stepUid: owner.stepUid } : {}),
          points: [sample],
        };
      } else {
        current.points.push(sample);
      }
    }
    if (current) out.push(current);
    return out;
  }, [analysis.spans, samples, window]);

  /**
   * The hits, folded to one entry per instant.
   *
   * Same rule as the running total's markers: what lands together is one point,
   * because two circles on the same pixel are one circle with a lie in it.
   */
  const instants = useMemo(() => {
    const out: {
      id: string;
      time: number;
      damage: number;
      label: string;
      color: string;
      stepUid?: string;
    }[] = [];
    for (const point of analysis.curve) {
      const hit = point.instance;
      const last = out[out.length - 1];
      if (last && Math.abs(hit.time - last.time) < 0.005) {
        last.damage += hit.mitigated;
        last.label = `${last.label}, ${hit.sourceLabel}`;
        continue;
      }
      out.push({
        id: hit.id,
        time: hit.time,
        damage: hit.mitigated,
        label: hit.sourceLabel,
        color: TYPE_COLOR[hit.type],
        ...(hit.stepUid ? { stepUid: hit.stepUid } : {}),
      });
    }
    return out;
  }, [analysis.curve]);

  const biggestHit = useMemo(
    () => instants.reduce((most, entry) => Math.max(most, entry.damage), 0),
    [instants],
  );

  const peak = useMemo(
    () => samples.reduce((best, entry) => (entry.rate > best.rate ? entry : best), { time: 0, rate: 0 }),
    [samples],
  );

  // Just enough headroom that the peak's own label is not clipped by the top.
  const maxRate = Math.max(1, peak.rate) * 1.06;
  const y = (rate: number) => plotBottom - (rate / maxRate) * (plotBottom - plotTop);

  const rateAt = (time: number): number => {
    let closest = samples[0];
    for (const entry of samples) {
      if (!closest || Math.abs(entry.time - time) < Math.abs(closest.time - time)) closest = entry;
    }
    return closest?.rate ?? 0;
  };

  /**
   * The scale's own top value is the peak.
   *
   * A label on the curve saying "2,368 dps" sat where the step names go and had
   * to dodge them; the axis already had a free slot at exactly that height. So
   * the topmost tick is the maximum rate the combo reaches, and the ticks below
   * it are round numbers.
   */
  const yTicks = useMemo(() => {
    const raw = maxRate / 4;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
    const step = Math.max(magnitude, Math.round(raw / magnitude) * magnitude);
    const out: number[] = [];
    for (let value = step; value < peak.rate * 0.94; value += step) out.push(value);
    return [...out, peak.rate];
  }, [maxRate, peak.rate]);

  if (analysis.curve.length === 0) {
    return <p className="empty-note">No damage yet — the combo has no step that deals any.</p>;
  }

  const readTime = cursorTime ?? playhead ?? null;

  return (
    <figure className="chart-figure">
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-swatch" style={{ background: 'var(--series-physical)' }} />
          Damage per second
        </span>
        <span className="chart-legend-item muted">Peak {Math.round(peak.rate).toLocaleString('en-US')} at {formatSeconds(peak.time)} s</span>
        {readTime !== null && (
          <span className="chart-legend-item">
            <b className="mono">{Math.round(rateAt(readTime)).toLocaleString('en-US')}</b> dps at{' '}
            {formatSeconds(readTime)} s
          </span>
        )}
      </div>

      <div className="chart-plot" ref={attachPlot}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="chart-svg"
          preserveAspectRatio="none"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = width / rect.width;
            setCursorTime(xToTime((event.clientX - rect.left) * ratio, width, window));
          }}
          onMouseLeave={() => setCursorTime(null)}
          onClick={() => onPinStep?.(null)}
        >
          {/* value grid */}
          {yTicks.map((tick, index) => {
            const isPeak = index === yTicks.length - 1;
            return (
              <g key={`y${tick}`}>
                <line
                  x1={AXIS_LEFT}
                  x2={width - AXIS_RIGHT}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={isPeak ? 'chart-grid is-peak' : 'chart-grid'}
                />
                <text
                  x={AXIS_LEFT - 10}
                  y={y(tick) + 4}
                  className={isPeak ? 'chart-tick end is-peak' : 'chart-tick end'}
                >
                  {Math.round(tick).toLocaleString('en-US')}
                </text>
              </g>
            );
          })}

          {/* the rate itself, one fill per stretch */}
          {segments.map((segment, index) => {
            const first = segment.points[0]!;
            const last = segment.points[segment.points.length - 1]!;
            const line = segment.points
              .map((entry) => `${x(entry.time)} ${y(entry.rate)}`)
              .join(' L ');
            const linked = !!segment.stepUid && segment.stepUid === linkedStepUid;
            return (
              <g
                key={`${segment.label}-${index}`}
                onClick={(event) => {
                  if (!segment.stepUid) return;
                  event.stopPropagation();
                  onPinStep?.(segment.stepUid);
                }}
                className={segment.stepUid ? 'dps-segment is-clickable' : 'dps-segment'}
              >
                <title>{segment.label}</title>
                <path
                  d={`M ${line}`}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={linked ? 3 : 2}
                  strokeLinejoin="round"
                />
                {/* the step's name, on the graph — this is the timeline now */}
                {x(last.time) - x(first.time) > 42 && (
                  <text
                    x={x(first.time) + 5}
                    y={plotTop + 12}
                    className="dps-step-label"
                    fill={segment.color}
                  >
                    {segment.label.length * 6.1 > x(last.time) - x(first.time) - 8
                      ? `${segment.label.slice(
                          0,
                          Math.max(1, Math.floor((x(last.time) - x(first.time) - 14) / 6.1)),
                        )}…`
                      : segment.label}
                  </text>
                )}
                {/* and its boundary, so the cut is visible where the rate is flat */}
                <line
                  x1={x(first.time)}
                  x2={x(first.time)}
                  y1={plotTop}
                  y2={plotBottom}
                  stroke={segment.color}
                  strokeWidth={1}
                  opacity={0.22}
                />
              </g>
            );
          })}

          {/*
            * One dot per instant, as on the running total: the marker is where
            * the damage landed, and simultaneous hits share it rather than
            * stacking three circles on one pixel.
            */}
          {instants.map((instant) => {
            const linked = !!instant.stepUid && instant.stepUid === linkedStepUid;
            const pinned = !!instant.stepUid && instant.stepUid === pinnedStepUid;
            /*
             * The dot's size is the hit's size.
             *
             * A 20-damage tick and a 400-damage ability used to get the same
             * circle, and since the tick's own hill is a few pixels tall, its dot
             * appeared to float on the slope of its neighbour — a point with no
             * visible cause, which is worse than no point at all. Now the circle
             * is proportional, so a small hit looks like a small hit, and the
             * ones too small to see at all are left to the list views.
             */
            const share = instant.damage / Math.max(1, biggestHit);
            if (instant.damage < analysis.totalMitigated * 0.005) return null;
            const radius = linked || pinned ? 6 : 2.5 + share * 2.5;
            return (
              <g
                key={instant.id}
                onClick={(event) => {
                  if (!instant.stepUid) return;
                  event.stopPropagation();
                  onPinStep?.(instant.stepUid);
                }}
                className={instant.stepUid ? 'dps-hit is-clickable' : 'dps-hit'}
              >
                <title>
                  {formatSeconds(instant.time)} s · {instant.label} ·{' '}
                  {Math.round(instant.damage).toLocaleString('en-US')} damage
                </title>
                <circle
                  cx={x(instant.time)}
                  cy={y(rateAt(instant.time))}
                  r={radius}
                  fill="var(--surface-1)"
                  stroke={linked || pinned ? 'var(--gold-300)' : instant.color}
                  strokeWidth={linked || pinned ? 3 : 2}
                />
              </g>
            );
          })}

          {playhead !== null && playhead !== undefined && (
            <line
              x1={x(playhead)}
              x2={x(playhead)}
              y1={PADDING.top}
              y2={plotBottom}
              className="chart-playhead"
            />
          )}
          {cursorTime !== null && (
            <line
              x1={x(cursorTime)}
              x2={x(cursorTime)}
              y1={PADDING.top}
              y2={plotBottom}
              className="chart-crosshair"
            />
          )}

          {/* axis */}
          <line
            x1={AXIS_LEFT}
            x2={width - AXIS_RIGHT}
            y1={plotBottom}
            y2={plotBottom}
            className="chart-axis"
          />
          {ticks.map((tick) => (
            <text key={`t${tick}`} x={x(tick)} y={plotBottom + 20} className="chart-tick middle">
              {formatTick(tick)}
            </text>
          ))}
        </svg>
      </div>

      <figcaption className="chart-caption">
        Damage per second at each moment · every hit is its own hill, {SIGMA.toFixed(2)} s wide · the
        area under the curve is the {Math.round(analysis.totalMitigated).toLocaleString('en-US')}{' '}
        damage dealt, coloured by the combo step that owns each stretch · peak {Math.round(peak.rate).toLocaleString('en-US')} dps at{' '}
        {formatSeconds(peak.time)} s
        {pinnedStepUid ? ' · click a stretch to follow its step' : ''}
      </figcaption>
    </figure>
  );
}
