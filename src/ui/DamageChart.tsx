/**
 * Cumulative damage over the combo.
 *
 * Form: a stacked *step* area. Damage in League lands in instants, not
 * continuously, so the curve holds flat between hits and jumps at each one —
 * drawing it as a smooth line would imply damage that is not happening.
 *
 * Colour: three categorical series (physical / magic / true), taken from the
 * validated palette in `references/palette.md` and re-validated against this
 * app's navy surface (#0A1428):
 *   physical #d95926 · magic #3987e5 · true #199e70
 *   worst all-pairs CVD ΔE 9.4, normal-vision ΔE 20.9, all ≥ 3:1 on surface.
 * Identity is never colour-alone: the legend is always present and each band is
 * direct-labelled at its right edge when it is tall enough to hold text.
 *
 * The dashed rule is the target's starting health, so where the curve crosses
 * it is exactly where the target dies.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import { DAMAGE_TYPE_LABELS, type DamageInstance, type DamageType } from '../engine/types';
import {
  AXIS_LEFT,
  AXIS_RIGHT,
  axisTicks,
  formatTick,
  plotWidthOf,
  timeToX,
  timeWindowOf,
  windowSpan,
} from './timeAxis';

/*
 * Fixed height, measured width.
 *
 * The chart used to draw into a fixed 940×380 viewBox scaled to fit, which meant
 * its height followed the window: at 1440 px wide it grew past 400 px and pushed
 * the timeline off the screen. Now the viewBox tracks the container's real width
 * and the height stays put, so the plot gets wider on a big screen instead of
 * taller — and the labels keep one size at every width.
 */
const HEIGHT = 260;
const MIN_WIDTH = 560;
const PADDING = { top: 18, right: AXIS_RIGHT, bottom: 40, left: AXIS_LEFT };

const SERIES_ORDER: DamageType[] = ['physical', 'magic', 'true'];
import { TYPE_COLOR as SERIES_COLOR } from './palette';

interface Props {
  analysis: ComboAnalysis;
  targetStartingHealth: number;
  /** The step highlighted right now, from hover anywhere or from the pin. */
  linkedStepUid?: string | null;
  /**
   * Where playback stands, in seconds — null when it is not running.
   *
   * Drawn as a dashed rule so the curve can be read as a position and not only
   * as a shape: everything left of the line has happened.
   */
  playhead?: number | null;
  /** The step pinned by clicking; survives the cursor leaving the chart. */
  pinnedStepUid?: string | null;
  onPinStep?: (uid: string | null) => void;
}

/**
 * One point in time on the curve, with everything that landed at it.
 *
 * Hits can share a timestamp exactly: Denting Blows procs on the attack that
 * triggered it, so both land at the same instant. Drawing them as two separate
 * points put one circle on top of the other and made the hidden one impossible
 * to hover — the readout below then only ever showed one of the two.
 */
interface Step {
  time: number;
  /** Cumulative mitigated damage per type at this point in time. */
  totals: Record<DamageType, number>;
  total: number;
  /** Everything that landed at this instant, in the order it resolved. */
  instances: DamageInstance[];
}

/** Two hits count as simultaneous when the clock cannot tell them apart. */
const SAME_INSTANT = 1e-6;

export function DamageChart({
  analysis,
  targetStartingHealth,
  linkedStepUid,
  playhead,
  pinnedStepUid,
  onPinStep,
}: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const [WIDTH, setWidth] = useState(940);
  const observerRef = useRef<ResizeObserver | null>(null);

  /*
   * Measured through a callback ref rather than an effect.
   *
   * On the first render the combo has no damage yet — patch data is still
   * loading — so this component returns early and the plot element does not
   * exist. An effect with an empty dependency list runs exactly then, finds
   * nothing, and never runs again: the chart stayed at its default width
   * forever. A callback ref fires whenever the element appears or is replaced.
   */
  const attachPlot = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;

    const measure = (value: number): boolean => {
      if (value <= 0) return false;
      setWidth(Math.max(MIN_WIDTH, Math.round(value)));
      return true;
    };

    /*
     * Measured up front, retried until it works, then watched.
     *
     * Neither half is enough alone. The observer only delivers callbacks with
     * rendered frames, so a tab opened in the background never gets one — but
     * that same tab also reports width 0 while it has no layout, which makes the
     * first synchronous read useless. Retrying on animation frames covers the
     * gap in both directions and stops as soon as there is a real width.
     */
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

  const activeSeries = useMemo(
    () => SERIES_ORDER.filter((type) => analysis.byType.some((entry) => entry.type === type)),
    [analysis.byType],
  );

  const maxValue = Math.max(analysis.totalMitigated, targetStartingHealth) * 1.08 || 1;
  /*
   * A rise this small is under a pixel tall, so a point of its own would be a
   * marker sitting on what looks like the same height as the one before it —
   * read, reasonably, as the same point drawn twice. Its damage still counts and
   * the hit is still listed under the point it merged into; what it loses is a
   * marker nobody could tell apart from its neighbour.
   */
  const invisibleRise = maxValue * 0.006;

  const steps = useMemo<Step[]>(() => {
    const running: Record<DamageType, number> = { physical: 0, magic: 0, true: 0 };
    const result: Step[] = [{ time: 0, totals: { ...running }, total: 0, instances: [] }];

    for (const point of analysis.curve) {
      running[point.instance.type] += point.instance.mitigated;
      const totals = { ...running };
      const total = running.physical + running.magic + running.true;
      const last = result[result.length - 1]!;

      /*
       * Fold into the point already there when a new marker would be a lie.
       *
       * Three cases. A simultaneous hit is one instant. A rise under a pixel is
       * indistinguishable from its neighbour. And — the one that took four
       * reports to find — a *repeat of the same effect on the same step* is one
       * effect: Ignite ticks five times over five seconds, and the engine
       * rightly credits every tick to the step that cast it, so five markers
       * appeared scattered across the combo, each one pointing back at the first
       * step. One Ignite, one marker; the ticks are still in the tooltip and
       * every point of their damage is still in the curve.
       *
       * Two basic attacks are not this case: same source, different steps.
       */
      const previousHit = last.instances[last.instances.length - 1];
      const sameEffectSameStep =
        !!previousHit &&
        previousHit.sourceId === point.instance.sourceId &&
        previousHit.stepUid === point.instance.stepUid;

      if (
        result.length > 1 &&
        (Math.abs(point.instance.time - last.time) < SAME_INSTANT ||
          total - last.total < invisibleRise ||
          sameEffectSameStep)
      ) {
        last.totals = totals;
        last.total = total;
        last.instances.push(point.instance);
        continue;
      }

      result.push({
        time: point.instance.time,
        totals,
        total,
        instances: [point.instance],
      });
    }
    return result;
  }, [analysis.curve, invisibleRise]);

  const maxTime = Math.max(0.6, steps[steps.length - 1]?.time ?? 1);
  // Shared with the Gantt view below, so a moment sits at the same x in both.
  const window = timeWindowOf(analysis.timeToFirstDamage, analysis.duration);
  const endTime = window.end;

  const x = (time: number) =>
    timeToX(time, WIDTH, window);
  const y = (value: number) =>
    HEIGHT - PADDING.bottom - (value / maxValue) * (HEIGHT - PADDING.top - PADDING.bottom);

  if (analysis.curve.length === 0) {
    return (
      <p className="empty-note">
        No damage yet — the combo has no step that deals any.
      </p>
    );
  }

  /** Staircase along the top of one stacked level. */
  function stairPoints(level: number): [number, number][] {
    const points: [number, number][] = [];
    const stackAt = (stepIndex: number): number => {
      const stepEntry = steps[stepIndex]!;
      return activeSeries
        .slice(0, level)
        .reduce((sum, type) => sum + stepEntry.totals[type], 0);
    };

    points.push([x(0), y(stackAt(0))]);
    for (let i = 1; i < steps.length; i += 1) {
      const time = steps[i]!.time;
      points.push([x(time), y(stackAt(i - 1))]);
      points.push([x(time), y(stackAt(i))]);
    }
    points.push([x(endTime), y(stackAt(steps.length - 1))]);
    return points;
  }

  const yTicks = niceTicks(maxValue, 5);
  // Roughly one time label per 170 px, so they never collide as the plot narrows.
  const xTicks = axisTicks(window, WIDTH);

  /** The instant closest to the pointer, so the whole plot is one hit target. */
  function nearestStepIndex(event: { clientX: number; currentTarget: SVGSVGElement }): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = WIDTH / rect.width;
    const localX = (event.clientX - rect.left) * ratio;
    const time = window.start + ((localX - AXIS_LEFT) / plotWidthOf(WIDTH)) * windowSpan(window);
    let nearest = 0;
    let best = Infinity;
    steps.forEach((entry, index) => {
      const distance = Math.abs(entry.time - time);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    return nearest;
  }

  /** True when every hit at this instant belongs to the given combo step. */
  const stepOf = (step: Step): string | null => step.instances[0]?.stepUid ?? null;
  const belongsTo = (step: Step, uid: string | null | undefined): boolean =>
    !!uid && step.instances.some((instance) => instance.stepUid === uid);

  /*
   * With nothing hovered the readout falls back to the pinned instant, so a
   * click leaves something to read rather than just a highlight.
   */
  const hovered =
    hoverIndex !== null
      ? steps[hoverIndex]
      : (steps.find((step) => belongsTo(step, pinnedStepUid)) ?? null);

  return (
    <figure className="chart-figure">
      <div className="chart-legend">
        {activeSeries.map((type) => (
          <span className="chart-legend-item" key={type}>
            <span className="chart-swatch" style={{ background: SERIES_COLOR[type] }} />
            {DAMAGE_TYPE_LABELS[type]}
          </span>
        ))}
        <span className="chart-legend-item muted">
          <span className="chart-swatch dashed" />
          Target health
        </span>
      </div>

      <div className="chart-scroll" ref={attachPlot}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ height: HEIGHT }}
          className="chart-svg"
          role="img"
          aria-label={`Cumulative damage over ${maxTime.toFixed(2)} seconds, split by damage type`}
          /*
            * The cursor moves the chart's own read-out and nothing else.
            *
            * It used to also set the focused step, so dragging the mouse across
            * the chart rewrote the stat sheets on both sides on the way past.
            */
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => setHoverIndex(nearestStepIndex(event))}
          onClick={(event) => onPinStep?.(stepOf(steps[nearestStepIndex(event)]!))}
        >
          <title>Cumulative damage over time</title>

          {/* Grid — recessive, behind everything */}
          {yTicks.map((tick) => (
            <line
              key={`gy${tick}`}
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-grid"
            />
          ))}

          {/* Stacked step areas, bottom band first */}
          {activeSeries.map((type, level) => {
            const top = stairPoints(level + 1);
            const bottom = stairPoints(level).reverse();
            const path = [...top, ...bottom].map(([px, py]) => `${px},${py}`).join(' ');
            return (
              <polygon
                key={type}
                points={path}
                fill={SERIES_COLOR[type]}
                fillOpacity={0.55}
                stroke="var(--surface-1)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            );
          })}

          {/* Total line on top of the stack */}
          <polyline
            points={stairPoints(activeSeries.length).map(([px, py]) => `${px},${py}`).join(' ')}
            fill="none"
            stroke="var(--gold-200)"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Target health reference */}
          {targetStartingHealth <= maxValue && (
            <>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y(targetStartingHealth)}
                y2={y(targetStartingHealth)}
                className="chart-reference"
              />
              <text
                x={WIDTH - PADDING.right + 8}
                y={y(targetStartingHealth) + 4}
                className="chart-reference-label"
              >
                {Math.round(targetStartingHealth).toLocaleString('en-US')} HP
              </text>
            </>
          )}

          {/*
           * One marker per instant, not per hit: simultaneous hits share it.
           * A marker belonging to the highlighted combo step gets a gold ring,
           * which is what ties a click here to the card in the strip above.
           */}
          {steps.slice(1).map((step, index) => {
            const isLinked = belongsTo(step, linkedStepUid);
            return (
              <circle
                key={step.instances[0]!.id}
                cx={x(step.time)}
                cy={y(step.total)}
                r={hoverIndex === index + 1 || isLinked ? 6 : 4}
                fill="var(--surface-1)"
                stroke={
                  isLinked
                    ? 'var(--gold-300)'
                    : SERIES_COLOR[step.instances[step.instances.length - 1]!.type]
                }
                strokeWidth={isLinked ? 3 : 2}
              />
            );
          })}

          {/* Direct labels on bands tall enough to hold them */}
          {activeSeries.map((type, level) => {
            const lastStep = steps[steps.length - 1]!;
            const below = activeSeries
              .slice(0, level)
              .reduce((sum, entry) => sum + lastStep.totals[entry], 0);
            const value = lastStep.totals[type];
            const bandHeight = y(below) - y(below + value);
            if (bandHeight < 18) return null;
            return (
              <text
                key={`label${type}`}
                x={WIDTH - PADDING.right + 8}
                y={y(below + value / 2) + 4}
                className="chart-band-label"
                fill={SERIES_COLOR[type]}
              >
                {Math.round(value).toLocaleString('en-US')}
              </text>
            );
          })}

          {/* Playback's own rule, dashed, drawn under the crosshair. */}
          {playhead !== null && playhead !== undefined && (
            <line
              x1={x(playhead)}
              x2={x(playhead)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              className="chart-playhead"
            />
          )}

          {/* Crosshair */}
          {hovered && (
            <line
              x1={x(hovered.time)}
              x2={x(hovered.time)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              className="chart-crosshair"
            />
          )}

          {/* Axes */}
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            className="chart-axis"
          />
          {yTicks.map((tick) => (
            <text key={`ty${tick}`} x={PADDING.left - 10} y={y(tick) + 4} className="chart-tick end">
              {formatCompact(tick)}
            </text>
          ))}
          {xTicks.map((tick) => (
            <text
              key={`tx${tick}`}
              x={x(tick)}
              y={HEIGHT - PADDING.bottom + 20}
              className="chart-tick middle"
            >
              {formatTick(tick)}
            </text>
          ))}
          <text
            x={PADDING.left}
            y={HEIGHT - 8}
            className="chart-axis-title"
          >
            Time since combo start
          </text>
        </svg>
      </div>
    </figure>
  );
}
/** Round tick values to something a human would have chosen. */
function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) *
    magnitude;
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

function formatCompact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return value.toFixed(0);
}
