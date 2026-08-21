/**
 * Damage per second, moment by moment — the burst window as a shape.
 *
 * The running total says how much has landed; it cannot say how *fast*, because
 * every combo's total curve rises and a steep rise looks much like a long one.
 * This is the derivative: at any moment, the damage inside a one-second window
 * around it. The peak is the burst, the valleys are the waiting, and the width of
 * the hump is how long the burst actually lasted.
 *
 * The window is centred rather than trailing. A trailing window puts the peak
 * half a second *after* the hits that caused it and draws a plateau where nothing
 * happened, which reads as damage continuing; centred, the hump sits on the
 * moment it belongs to. It does mean the curve starts rising slightly before the
 * first hit — the honest cost of asking "how fast, around here".
 *
 * The coloured stretches behind the curve are what was happening: casts, buffs,
 * shreds, crowd control, sustain. That is the second half of the point — the
 * graph is its own timeline, so a dent in the rate can be read against the thing
 * that caused it without looking anywhere else.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import type { TimelineLane, TimelineSpan } from '../engine/types';
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
/** The band strip above the plot: one line per overlapping stretch. */
const BAND_HEIGHT = 15;
const BAND_GAP = 3;
const MAX_BAND_LINES = 4;

/**
 * The averaging window, in seconds.
 *
 * One second, because "damage per second" is the unit everyone already reads and
 * a shorter window turns single hits into spikes so narrow they carry no shape.
 */
const WINDOW_SECONDS = 1;

/** What each stretch is drawn in — the same colours the Gantt uses. */
function laneColor(lane: TimelineLane): string {
  switch (lane) {
    case 'proc':
      return 'var(--gold-300)';
    case 'cc':
      return 'var(--status-bad)';
    case 'sustain':
      return 'var(--status-good)';
    case 'debuff':
      return 'var(--series-physical)';
    case 'buff':
      return 'var(--blue-200)';
    case 'P':
      return 'var(--slot-p)';
    case 'Q':
      return 'var(--slot-q)';
    case 'W':
      return 'var(--slot-w)';
    case 'E':
      return 'var(--slot-e)';
    case 'R':
      return 'var(--slot-r)';
    default:
      return 'var(--text-dim)';
  }
}

/**
 * Which stretches are "something happening".
 *
 * Cooldowns and attack timers are the opposite — they are the waiting — and
 * drawing them here would colour the whole graph and say nothing.
 */
function isHappening(span: TimelineSpan): boolean {
  if (span.kind === 'cooldown' || span.kind === 'recharge' || span.kind === 'attack-timer') {
    return false;
  }
  return span.lane !== 'idle';
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

  /**
   * The stretches, packed into lines so two at once are two bars.
   *
   * Anything past the fourth line is dropped rather than squeezed — and the
   * footer says how many, because a silently shortened list reads as a complete
   * one.
   */
  const bands = useMemo(() => {
    const spans = analysis.spans
      .filter(isHappening)
      .filter((span) => span.end > window.start && span.start < window.end)
      .sort((a, b) => a.start - b.start || b.end - a.end);

    const lineEnds: number[] = [];
    const placed: { span: TimelineSpan; line: number }[] = [];
    let dropped = 0;

    for (const span of spans) {
      let line = lineEnds.findIndex((freeFrom) => span.start >= freeFrom - 0.0005);
      if (line === -1) {
        if (lineEnds.length >= MAX_BAND_LINES) {
          dropped += 1;
          continue;
        }
        line = lineEnds.length;
        lineEnds.push(0);
      }
      lineEnds[line] = span.end;
      placed.push({ span, line });
    }
    return { placed, dropped, lines: lineEnds.length };
  }, [analysis.spans, window]);

  const bandsHeight = bands.lines * (BAND_HEIGHT + BAND_GAP);
  const plotTop = PADDING.top + bandsHeight;
  const plotBottom = HEIGHT - PADDING.bottom;

  /**
   * The rate curve, sampled every two pixels.
   *
   * Sampling in pixels rather than in seconds keeps the cost the same whether
   * the combo is two seconds long or forty, and two pixels is finer than the
   * line is thick.
   */
  const samples = useMemo(() => {
    const instances = analysis.curve.map((point) => point.instance);
    const steps = Math.max(2, Math.round(plotWidth / 2));
    const half = WINDOW_SECONDS / 2;
    const out: { time: number; rate: number }[] = [];

    for (let index = 0; index <= steps; index += 1) {
      const time = window.start + (windowSpan(window) * index) / steps;
      let sum = 0;
      for (const instance of instances) {
        if (instance.time > time - half && instance.time <= time + half) sum += instance.mitigated;
      }
      out.push({ time, rate: sum / WINDOW_SECONDS });
    }
    return out;
  }, [analysis.curve, window, plotWidth]);

  const peak = useMemo(
    () => samples.reduce((best, entry) => (entry.rate > best.rate ? entry : best), { time: 0, rate: 0 }),
    [samples],
  );

  const maxRate = Math.max(1, peak.rate) * 1.12;
  const y = (rate: number) => plotBottom - (rate / maxRate) * (plotBottom - plotTop);

  const rateAt = (time: number): number => {
    let closest = samples[0];
    for (const entry of samples) {
      if (!closest || Math.abs(entry.time - time) < Math.abs(closest.time - time)) closest = entry;
    }
    return closest?.rate ?? 0;
  };

  const area = useMemo(() => {
    if (samples.length === 0) return '';
    const line = samples.map((entry) => `${x(entry.time)} ${y(entry.rate)}`).join(' L ');
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    return `M ${x(first.time)} ${plotBottom} L ${line} L ${x(last.time)} ${plotBottom} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, maxRate, plotTop, plotBottom, width]);

  const yTicks = useMemo(() => {
    const raw = maxRate / 3;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
    const step = Math.max(magnitude, Math.round(raw / magnitude) * magnitude);
    const out: number[] = [];
    for (let value = step; value < maxRate; value += step) out.push(value);
    return out;
  }, [maxRate]);

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
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line
                x1={AXIS_LEFT}
                x2={width - AXIS_RIGHT}
                y1={y(tick)}
                y2={y(tick)}
                className="chart-grid"
              />
              <text x={AXIS_LEFT - 10} y={y(tick) + 4} className="chart-tick end">
                {Math.round(tick).toLocaleString('en-US')}
              </text>
            </g>
          ))}

          {/* the stretches where something was happening */}
          {bands.placed.map(({ span, line }) => {
            const left = x(Math.max(span.start, window.start));
            const right = x(Math.min(span.end, window.end));
            const barWidth = Math.max(2, right - left);
            const top = PADDING.top + line * (BAND_HEIGHT + BAND_GAP);
            const color = laneColor(span.lane);
            const linked = !!span.stepUid && span.stepUid === linkedStepUid;
            return (
              <g
                key={span.id}
                className={`dps-band${linked ? ' is-linked' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (span.stepUid) onPinStep?.(span.stepUid);
                }}
              >
                <title>
                  {span.label}
                  {span.detail ? ` · ${span.detail}` : ''} · {formatSeconds(span.start)}–
                  {formatSeconds(span.end)} s
                </title>
                {/* the stretch, projected down over the curve */}
                <rect
                  x={left}
                  y={top}
                  width={barWidth}
                  height={plotBottom - top}
                  fill={color}
                  opacity={linked ? 0.14 : 0.07}
                />
                {/* and its own bar, where the label fits */}
                <rect
                  x={left}
                  y={top}
                  width={barWidth}
                  height={BAND_HEIGHT}
                  rx={2}
                  fill={color}
                  opacity={linked ? 0.95 : 0.72}
                />
                {barWidth > 34 && (
                  <text
                    x={left + 5}
                    y={top + BAND_HEIGHT - 4}
                    className="dps-band-label"
                    clipPath="none"
                  >
                    {span.label.length * 6.2 > barWidth - 8
                      ? span.label.slice(0, Math.max(1, Math.floor((barWidth - 8) / 6.2)))
                      : span.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* the rate itself */}
          <path d={area} className="dps-area" />
          <path
            d={samples.map((entry, index) => `${index === 0 ? 'M' : 'L'} ${x(entry.time)} ${y(entry.rate)}`).join(' ')}
            className="dps-line"
          />

          {/* the peak, named */}
          <circle cx={x(peak.time)} cy={y(peak.rate)} r={4} className="dps-peak" />
          <text x={x(peak.time) + 8} y={y(peak.rate) - 6} className="dps-peak-label mono">
            {Math.round(peak.rate).toLocaleString('en-US')} dps
          </text>

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
        Damage inside a {WINDOW_SECONDS.toFixed(0)} s window centred on each moment · peak{' '}
        {Math.round(peak.rate).toLocaleString('en-US')} dps at {formatSeconds(peak.time)} s
        {bands.dropped > 0
          ? ` · ${bands.dropped} more overlapping stretch${bands.dropped === 1 ? '' : 'es'} not drawn`
          : ''}
        {pinnedStepUid ? ' · click a stretch to follow its step' : ''}
      </figcaption>
    </figure>
  );
}
