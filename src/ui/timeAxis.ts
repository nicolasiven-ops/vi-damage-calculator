/**
 * The one time axis both timeline views draw on.
 *
 * The cumulative damage curve and the Gantt view describe the same seconds, so a
 * moment has to sit at the same x in both. Stacked, they become a third thing
 * neither is alone: the curve says how much has landed by 2 s, the bars below say
 * what was busy at 2 s and what was still on cooldown — read together, along one
 * vertical line.
 *
 * That only works if the geometry is shared rather than merely similar, which is
 * why it lives here instead of as two sets of constants that happen to match
 * until someone edits one of them.
 */

/** Left margin: wide enough for the Gantt's lane names, shared by the chart. */
export const AXIS_LEFT = 152;

/**
 * Right margin. The chart needs it for its band labels and the health rule; the
 * Gantt uses it for the arrows of bars that run past the window.
 */
export const AXIS_RIGHT = 132;

/** The stretch of time a view draws. Absolute seconds since combo start. */
export interface TimeWindow {
  start: number;
  end: number;
}

/**
 * How much of the run-up to keep in view before the first hit lands.
 *
 * Not zero: a Q that was charging before the fight is worth *seeing* as
 * something already in flight, and a bar that starts exactly at the left edge
 * reads as if it started there.
 */
const LEAD_IN = 0.25;

/** Below this, the run-up is short enough to simply show. */
const TRIM_THRESHOLD = 0.6;

/**
 * The window to draw for a combo.
 *
 * Starts shortly before the first hit rather than at zero. A fully charged Vault
 * Breaker spends 1.5 s before anything lands — 38 % of a four-second combo — and
 * in game that hold usually happens on the way in, not during the trade.
 * Squeezing the trade into the remaining 62 % made the interesting part small to
 * pay for a part nobody is deciding anything about.
 *
 * The labels stay absolute, so the numbers still match the detail table: the
 * first hit is at 1.50 s in both. Bars that begin before the window are drawn
 * clipped, with an arrow, exactly like cooldowns that run past its end.
 */
export function timeWindowOf(firstHitAt: number, durationSeconds: number): TimeWindow {
  const start = firstHitAt > TRIM_THRESHOLD ? Math.max(0, firstHitAt - LEAD_IN) : 0;
  const end = Math.max(start + 0.8, start + (durationSeconds - start) * 1.04);
  return { start, end };
}

/** Seconds the window spans. Never zero, so it is safe to divide by. */
export function windowSpan(window: TimeWindow): number {
  return Math.max(0.0001, window.end - window.start);
}

/** Pixels available for the plot itself, at a given total width. */
export function plotWidthOf(totalWidth: number): number {
  return Math.max(120, totalWidth - AXIS_LEFT - AXIS_RIGHT);
}

/** Time to x, in the coordinate system of a viewBox `totalWidth` units wide. */
export function timeToX(time: number, totalWidth: number, window: TimeWindow): number {
  const clamped = Math.min(Math.max(time, window.start), window.end);
  return AXIS_LEFT + ((clamped - window.start) / windowSpan(window)) * plotWidthOf(totalWidth);
}

/** X back to time — for the cursor and for hit testing. */
export function xToTime(x: number, totalWidth: number, window: TimeWindow): number {
  const ratio = (x - AXIS_LEFT) / plotWidthOf(totalWidth);
  return Math.min(Math.max(window.start + ratio * windowSpan(window), window.start), window.end);
}

/**
 * Tick positions, at most one per `perTick` pixels, on values a human would pick.
 *
 * Both views ask for the same ticks at the same width, so their grids line up
 * rather than nearly lining up.
 */
export function axisTicks(window: TimeWindow, totalWidth: number, perTick = 96): number[] {
  const span = windowSpan(window);
  const target = Math.max(2, Math.round(plotWidthOf(totalWidth) / perTick));
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) *
    magnitude;

  const ticks: number[] = [];
  const first = Math.ceil(window.start / step - 1e-9) * step;
  for (let value = first; value <= window.end + 1e-9; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  return ticks;
}

/** Seconds, formatted the way both views label them. */
export function formatSeconds(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * An axis tick's label — shared, so the two stacked axes read identically.
 *
 * Decimals follow the tick's own value rather than the size of the clock:
 * rounding everything above 10 s to whole seconds labelled the line at 12.5 s
 * as "13 s", a grid line pointing at one time and naming another.
 */
export function formatTick(value: number): string {
  return Number.isInteger(value) ? `${value.toFixed(0)} s` : `${value.toFixed(1)} s`;
}
