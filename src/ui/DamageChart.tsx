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

import { useMemo, useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import { DAMAGE_TYPE_LABELS, type DamageInstance, type DamageType } from '../engine/types';

const WIDTH = 940;
const HEIGHT = 380;
const PADDING = { top: 24, right: 132, bottom: 44, left: 66 };

const SERIES_ORDER: DamageType[] = ['physical', 'magic', 'true'];
const SERIES_COLOR: Record<DamageType, string> = {
  physical: 'var(--series-physical)',
  magic: 'var(--series-magic)',
  true: 'var(--series-true)',
};

interface Props {
  analysis: ComboAnalysis;
  targetStartingHealth: number;
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

export function DamageChart({ analysis, targetStartingHealth }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const activeSeries = useMemo(
    () => SERIES_ORDER.filter((type) => analysis.byType.some((entry) => entry.type === type)),
    [analysis.byType],
  );

  const steps = useMemo<Step[]>(() => {
    const running: Record<DamageType, number> = { physical: 0, magic: 0, true: 0 };
    const result: Step[] = [{ time: 0, totals: { ...running }, total: 0, instances: [] }];

    for (const point of analysis.curve) {
      running[point.instance.type] += point.instance.mitigated;
      const totals = { ...running };
      const total = running.physical + running.magic + running.true;
      const last = result[result.length - 1]!;

      // Fold a simultaneous hit into the step that is already there, so the
      // curve keeps one reachable point per instant.
      if (result.length > 1 && Math.abs(point.instance.time - last.time) < SAME_INSTANT) {
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
  }, [analysis.curve]);

  const maxTime = Math.max(0.6, steps[steps.length - 1]?.time ?? 1);
  const endTime = maxTime * 1.06;
  const maxValue = Math.max(analysis.totalMitigated, targetStartingHealth) * 1.08 || 1;

  const x = (time: number) =>
    PADDING.left + (time / endTime) * (WIDTH - PADDING.left - PADDING.right);
  const y = (value: number) =>
    HEIGHT - PADDING.bottom - (value / maxValue) * (HEIGHT - PADDING.top - PADDING.bottom);

  if (analysis.curve.length === 0) {
    return (
      <p className="empty-note">
        Keine Schadensinstanzen — die Combo enthält noch keine Aktion, die Schaden verursacht.
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
  const xTicks = niceTicks(endTime, 6);

  const hovered = hoverIndex !== null ? steps[hoverIndex] : null;

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
          Leben des Ziels
        </span>
      </div>

      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="chart-svg"
          role="img"
          aria-label={`Kumulierter Schaden über ${maxTime.toFixed(2)} Sekunden, aufgeteilt nach Schadensart`}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => {
            const svg = event.currentTarget;
            const rect = svg.getBoundingClientRect();
            const ratio = WIDTH / rect.width;
            const localX = (event.clientX - rect.left) * ratio;
            const time = ((localX - PADDING.left) / (WIDTH - PADDING.left - PADDING.right)) * endTime;
            let nearest = 0;
            let best = Infinity;
            steps.forEach((entry, index) => {
              const distance = Math.abs(entry.time - time);
              if (distance < best) {
                best = distance;
                nearest = index;
              }
            });
            setHoverIndex(nearest);
          }}
        >
          <title>Kumulierter Schaden über Zeit</title>

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
                {Math.round(targetStartingHealth).toLocaleString('de-DE')} LP
              </text>
            </>
          )}

          {/* One marker per instant, not per hit: simultaneous hits share it */}
          {steps.slice(1).map((step, index) => (
            <circle
              key={step.instances[0]!.id}
              cx={x(step.time)}
              cy={y(step.total)}
              r={hoverIndex === index + 1 ? 6 : 4}
              fill="var(--surface-1)"
              stroke={SERIES_COLOR[step.instances[step.instances.length - 1]!.type]}
              strokeWidth={2}
            />
          ))}

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
                {Math.round(value).toLocaleString('de-DE')}
              </text>
            );
          })}

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
              {tick.toFixed(1)} s
            </text>
          ))}
          <text
            x={PADDING.left}
            y={HEIGHT - 8}
            className="chart-axis-title"
          >
            Zeit seit Combo-Start
          </text>
        </svg>
      </div>

      {hovered && (
        <figcaption className="chart-tooltip" role="status">
          <span className="chart-tooltip-time mono">{hovered.time.toFixed(2)} s</span>
          {hovered.instances.length === 0 ? (
            <span className="chart-tooltip-source">Combo-Start</span>
          ) : (
            // Everything that landed at this instant, each hit on its own line.
            <span className="chart-tooltip-hits">
              {hovered.instances.map((instance) => (
                <span className="chart-tooltip-hit" key={instance.id}>
                  <span className="chart-tooltip-source">{instance.sourceLabel}</span>
                  <span className="chart-tooltip-value mono">
                    +{Math.round(instance.mitigated).toLocaleString('de-DE')}
                  </span>
                  <span
                    className="chart-tooltip-type"
                    style={{ color: SERIES_COLOR[instance.type] }}
                  >
                    {DAMAGE_TYPE_LABELS[instance.type]}
                  </span>
                </span>
              ))}
            </span>
          )}
          <span className="chart-tooltip-total mono">
            gesamt {Math.round(hovered.total).toLocaleString('de-DE')}
          </span>
        </figcaption>
      )}
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
