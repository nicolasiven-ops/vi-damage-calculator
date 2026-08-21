/**
 * The combo as a timeline — one row per step you pressed.
 *
 * The rows follow the combo, not the ability list: Q → AA → E → AA is four rows,
 * and the second AA is its own row rather than sharing one with the first. That
 * is the whole point of the view. Reading down the left edge is reading the combo
 * in order; reading across is reading the clock. A row per *ability* looked
 * tidier and answered a question nobody asks — "when did I use E, ever" — while
 * hiding the one everybody asks: what happened, in what order, and what was
 * still on cooldown while it did.
 *
 * Each row carries everything that step caused: its cast, the hits that landed
 * from it (including procs like Denting Blows, which belong to the attack that
 * triggered them), and — on the same line, drawn faintly behind the cast — the
 * cooldown or recharge timer it started.
 *
 * Below the combo come the consequences that are not steps: damage procced by
 * gear, windows gear opened, windows the champion's kit opened.
 *
 * Only what the engine produced is drawn (`analysis.spans` and `analysis.curve`).
 * This view re-derives nothing; it has no opinion of its own about durations.
 * The axis is shared with the damage chart above it (see `timeAxis.ts`), so a
 * moment sits at the same x in both.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComboAnalysis } from '../engine/analysis';
import {
  DAMAGE_TYPE_LABELS,
  type AbilitySlot,
  type ComboStep,
  type DamageInstance,
  type DamageType,
  type TimelineLane,
  type TimelineSpan,
} from '../engine/types';
import type { AbilityMeta } from '../model/champions/types';
import {
  AXIS_LEFT,
  axisTicks,
  formatSeconds,
  formatTick,
  plotWidthOf,
  timeToX,
  timeWindowOf,
  windowSpan,
} from './timeAxis';

interface Props {
  analysis: ComboAnalysis;
  /** The combo itself: the rows are its steps, in order. */
  combo: ComboStep[];
  /** For the row names: ability names as Data Dragon spells them. */
  abilities: AbilityMeta[];
  linkedStepUid?: string | null;
  /**
   * Which rows to draw.
   *
   * 'combo' is the combo's own steps and nothing else — the reading that belongs
   * next to the result, where the question is what was pressed and when.
   * 'groups' is everything that is not a step: procs, buffs, shreds, crowd
   * control, sustain. 'all' is both, for a view that stands alone.
   */
  rows?: 'combo' | 'groups' | 'all';
  /** Where playback stands, in seconds; null when it is not running. */
  playhead?: number | null;
  pinnedStepUid?: string | null;
  onPinStep?: (uid: string | null) => void;
}

const RULER_HEIGHT = 26;
const MIN_WIDTH = 520;
const ROW_HEIGHT = 27;
const BAR_HEIGHT = 19;
const CLIP_ARROW = 6;
/*
 * Room between groups: enough that the heading reads as belonging to the group
 * below it rather than to the row above. The divider sits high in the gap, the
 * heading low, so the pairing is unambiguous.
 */
const GROUP_GAP = 34;
const GROUP_RULE_OFFSET = 24;
const GROUP_TITLE_OFFSET = 10;
const TIER_STEP = 12;

/** Lanes that belong to a combo step rather than to a group of their own. */
const STEP_LANES: TimelineLane[] = ['P', 'Q', 'W', 'E', 'R', 'AA', 'summoner', 'idle'];

/**
 * Timers share their step's row instead of getting a strip below it.
 *
 * A cooldown belongs to the press that started it, so it reads better on the
 * same line — drawn faintly, behind the cast, so the solid block stays the thing
 * that happened and the pale bar is the consequence still running.
 */
function isTimer(kind: string): boolean {
  return kind === 'cooldown' || kind === 'recharge' || kind === 'attack-timer';
}

const SLOT_COLOR: Record<AbilitySlot, string> = {
  P: 'var(--slot-p)',
  Q: 'var(--slot-q)',
  W: 'var(--slot-w)',
  E: 'var(--slot-e)',
  R: 'var(--slot-r)',
};

const TYPE_COLOR: Record<DamageType, string> = {
  physical: 'var(--series-physical)',
  magic: 'var(--series-magic)',
  true: 'var(--series-true)',
};

const GROUP_LANES: { title: string; lane: TimelineLane; label: string }[] = [
  { title: 'Procs', lane: 'proc', label: 'Item & rune damage' },
  { title: 'Buffs', lane: 'buff', label: 'On Vi' },
  { title: 'Debuffs', lane: 'debuff', label: 'On the target' },
  // What the target cannot do, and what it is getting back — the two things
  // that happen to the target without being damage.
  { title: 'Crowd control', lane: 'cc', label: 'The target cannot act' },
  { title: 'Sustain', lane: 'sustain', label: 'Health going back up' },
];

function groupLaneColor(lane: TimelineLane): string {
  if (lane === 'proc') return 'var(--gold-300)';
  if (lane === 'cc') return 'var(--status-bad)';
  if (lane === 'sustain') return 'var(--status-good)';
  if (lane === 'debuff') return 'var(--series-physical)';
  return 'var(--blue-200)';
}

/**
 * The colour of one effect, by what it does.
 *
 * Offensive buffs take the teal the app already uses for "this is helping your
 * damage"; buffs that only keep you alive take green, because that is the
 * distinction being drawn — Sterak's shield and Hail of Blades are not the same
 * kind of good. Debuffs take the physical-damage orange: they sit on the target,
 * and they are why the numbers after them are bigger.
 */
function effectColor(span: TimelineSpan, fallback: string): string {
  switch (span.effectKind) {
    case 'offense':
      return 'var(--effect-offense)';
    case 'defense':
      return 'var(--effect-defense)';
    case 'debuff':
      return 'var(--effect-debuff)';
    default:
      return fallback;
  }
}

/** What a combo step is called, and which colour it owns. */
function describeStep(
  step: ComboStep,
  abilities: AbilityMeta[],
): { label: string; color: string } {
  switch (step.action.kind) {
    case 'ability': {
      const slot = step.action.slot;
      const name = abilities.find((ability) => ability.slot === slot)?.name ?? slot;
      return { label: `${slot} · ${name}`, color: SLOT_COLOR[slot] };
    }
    case 'attack':
      return { label: 'Basic attack', color: 'var(--gold-300)' };
    case 'wait':
      return { label: `Wait ${step.action.seconds} s`, color: 'var(--status-warn)' };
    case 'summoner':
      return {
        label: step.action.summonerId === 'SummonerDot' ? 'Ignite' : 'Smite',
        color: 'var(--series-true)',
      };
    case 'item':
      return { label: 'Item active', color: 'var(--text-secondary)' };
  }
}

/**
 * Which row a hit belongs in.
 *
 * Its step, when it has one and it came from the champion or the attack — a
 * Denting Blows proc belongs to the attack that triggered it, not to a lane of
 * its own. Gear damage goes to the procs group instead, because that is the
 * question it answers: how much did the items add.
 */
function rowKeyOfHit(instance: DamageInstance): string | null {
  if (instance.sourceKind === 'item' || instance.sourceKind === 'rune') return 'lane:proc';
  return instance.stepUid ? `step:${instance.stepUid}` : null;
}

function rowKeyOfSpan(span: TimelineSpan): string | null {
  if (STEP_LANES.includes(span.lane)) {
    return span.stepUid ? `step:${span.stepUid}` : null;
  }
  return `lane:${span.lane}`;
}

interface Row {
  key: string;
  label: string;
  color: string;
  top: number;
  height: number;
  tierPad: number;
  groupTitle: string | null;
  groupDivider: boolean;
  /**
   * Sub-line per span, for rows where overlap means two different things.
   *
   * In a step's row, overlap is the point: the cast and the cooldown it started
   * belong on one line, one behind the other. In a group row it is the opposite
   * — Denting Blows' shred and its attack speed are two effects that happen to
   * run at once, and drawing them on top of each other showed one.
   */
  subRow: Map<string, number>;
}

/**
 * Greedy row packing: each item takes the first line it fits on.
 *
 * Used only for the group rows; see the note on `Row.subRow`.
 */
function packRows(spans: TimelineSpan[]): Map<string, number> {
  const lineEnds: number[] = [];
  const out = new Map<string, number>();
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    let line = lineEnds.findIndex((freeFrom) => span.start >= freeFrom - 0.0005);
    if (line === -1) {
      line = lineEnds.length;
      lineEnds.push(0);
    }
    lineEnds[line] = span.end;
    out.set(span.id, line);
  }
  return out;
}

export function ComboTimeline({
  analysis,
  combo,
  abilities,
  linkedStepUid,
  rows: which = 'all',
  playhead,
  pinnedStepUid,
  onPinStep,
}: Props) {
  const [width, setWidth] = useState(940);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  /*
   * Measuring the width: the observer only fires with rendered frames, and the
   * first synchronous read is 0 in a tab that has no layout yet. Together they
   * cover both cases.
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

  const window = useMemo(
    () => timeWindowOf(analysis.timeToFirstDamage, analysis.duration),
    [analysis.timeToFirstDamage, analysis.duration],
  );

  const plotWidth = plotWidthOf(width);
  const x = (time: number) => timeToX(time, width, window);

  /** Hits by row, with tiers so two close labels do not overprint. */
  const hitsByRow = useMemo(() => {
    const perRow = new Map<string, { instance: DamageInstance; tier: number }[]>();
    const minGap = (windowSpan(window) / Math.max(1, plotWidth)) * 46;

    for (const point of analysis.curve) {
      const key = rowKeyOfHit(point.instance);
      if (!key) continue;
      const list = perRow.get(key) ?? [];
      let tier = 0;
      while (
        list.some(
          (entry) =>
            entry.tier === tier && Math.abs(point.instance.time - entry.instance.time) < minGap,
        )
      ) {
        tier += 1;
      }
      list.push({ instance: point.instance, tier });
      perRow.set(key, list);
    }
    return perRow;
  }, [analysis.curve, window, plotWidth]);

  const spansByRow = useMemo(() => {
    const perRow = new Map<string, TimelineSpan[]>();
    for (const span of analysis.spans) {
      const key = rowKeyOfSpan(span);
      if (!key) continue;
      const list = perRow.get(key) ?? [];
      list.push(span);
      perRow.set(key, list);
    }
    return perRow;
  }, [analysis.spans]);

  /**
   * The rows: the combo in order, then the groups that are not steps.
   *
   * A step with nothing to show still gets its row — a skipped step is part of
   * the sequence, and a gap in the numbering would be a worse lie than an empty
   * line.
   */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let cursor = RULER_HEIGHT;

    const push = (
      key: string,
      label: string,
      color: string,
      groupTitle: string | null,
      groupDivider: boolean,
      stack: boolean,
    ): void => {
      if (groupDivider) cursor += GROUP_GAP;
      const tierPad =
        Math.max(0, ...(hitsByRow.get(key)?.map((hit) => hit.tier) ?? [0])) * TIER_STEP;

      const spans = spansByRow.get(key) ?? [];
      const subRow = stack ? packRows(spans) : new Map<string, number>();
      const lines = stack ? Math.max(1, ...[...subRow.values()].map((line) => line + 1)) : 1;

      const height = ROW_HEIGHT * lines + tierPad;
      out.push({
        key,
        label,
        color,
        top: cursor,
        height,
        tierPad,
        groupTitle,
        groupDivider,
        subRow,
      });
      cursor += height;
    };

    if (which !== 'groups') combo.forEach((step, index) => {
      const { label, color } = describeStep(step, abilities);
      // A step's own row never stacks: cast and cooldown belong on one line.
      push(
        `step:${step.uid}`,
        `${index + 1} · ${label}`,
        color,
        // With the groups left out there is only one group, so naming it is
        // noise: the window's own title already says what this is.
        index === 0 && which === 'all' ? 'Combo' : null,
        false,
        false,
      );
    });

    if (which === 'combo') return out;

    for (const group of GROUP_LANES) {
      const key = `lane:${group.lane}`;
      const hasContent = (spansByRow.get(key)?.length ?? 0) > 0 || (hitsByRow.get(key)?.length ?? 0) > 0;
      if (!hasContent) continue;
      /*
       * Group rows stack: two effects running at once are two effects. With the
       * combo drawn elsewhere the first group needs no gap above it — the gap
       * exists to separate it from the steps.
       */
      push(
        key,
        group.label,
        groupLaneColor(group.lane),
        group.title,
        which !== 'groups' || out.length > 0,
        true,
      );
    }

    return out;
  }, [combo, abilities, spansByRow, hitsByRow, which]);

  const lastRow = rows[rows.length - 1];
  const height = (lastRow ? lastRow.top + lastRow.height : RULER_HEIGHT) + 28;
  const ticks = useMemo(() => axisTicks(window, width), [window, width]);

  const isLinked = (uid?: string): boolean => !!uid && uid === linkedStepUid;
  const isPinned = (uid?: string): boolean => !!uid && uid === pinnedStepUid;

  /** The step a row stands for, so hovering the row lights the combo card. */
  const stepUidOf = (key: string): string | undefined =>
    key.startsWith('step:') ? key.slice(5) : undefined;

  function timeAt(event: { clientX: number; currentTarget: SVGSVGElement }): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = width / rect.width;
    const localX = (event.clientX - rect.left) * ratio;
    return Math.min(
      Math.max(window.start + ((localX - AXIS_LEFT) / plotWidth) * windowSpan(window), window.start),
      window.end,
    );
  }

  if (rows.length === 0) {
    return <p className="empty-note">Nothing to draw — the combo has no steps yet.</p>;
  }

  /** One bar. Timers are drawn first and faintly, casts solid on top of them. */
  const renderSpan = (span: TimelineSpan, row: Row) => {
    const timer = isTimer(span.kind);
    const clippedLeft = span.start < window.start - 0.0005;
    const clippedRight = span.end > window.end + 0.0005;
    const left = x(span.start) + (clippedLeft ? CLIP_ARROW : 0);
    const right = x(span.end) - (clippedRight ? CLIP_ARROW : 0);
    const barWidth = Math.max(2, right - left);
    const line = row.subRow.get(span.id) ?? 0;
    const barTop = row.top + row.tierPad + line * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const linked = isLinked(span.stepUid);
    const pinned = isPinned(span.stepUid);

    const caption = timer
      ? `${span.label} ${formatSeconds(span.fullSeconds)} s`
      : span.label;
    // Timers label their right edge — where they run out, which is the useful
    // moment — so two timers in one row do not put their text in one place.
    const captionFits = barWidth > caption.length * 5.3 + 12;

    // An effect is coloured by what it does; everything else by its row.
    const color = effectColor(span, row.color);

    return (
      <g
        key={span.id}
        className={`gantt-span kind-${span.kind}${timer ? ' is-timer' : ''}${
          linked ? ' is-linked' : ''
        }${pinned ? ' is-pinned' : ''}`}
        onClick={(event) => {
          // Stops the chart's own "clicked nothing" handler from undoing this.
          event.stopPropagation();
          onPinStep?.(span.stepUid ?? null);
        }}
      >
        <title>
          {`${span.label} · ${formatSeconds(span.start)}–${formatSeconds(
            span.start + span.fullSeconds,
          )} s (${formatSeconds(span.fullSeconds)} s)${span.detail ? `\n${span.detail}` : ''}`}
        </title>
        <rect
          x={left}
          y={barTop}
          width={barWidth}
          height={BAR_HEIGHT}
          rx={2}
          fill={color}
          fillOpacity={timer ? 0.09 : span.kind === 'idle' ? 0.16 : 0.34}
          stroke={color}
          strokeOpacity={timer ? 0.28 : span.kind === 'idle' ? 0.6 : 0.9}
          strokeDasharray={span.kind === 'idle' ? '3 3' : undefined}
        />

        {/* The charge portion of a cast, marked off inside the bar */}
        {span.parts && span.parts.length > 1 && span.kind === 'cast' && !clippedLeft && (
          <rect
            x={left}
            y={barTop}
            width={Math.max(
              1,
              (span.parts[0]!.seconds / Math.max(0.0001, span.fullSeconds)) * barWidth,
            )}
            height={BAR_HEIGHT}
            rx={2}
            fill="url(#gantt-hatch)"
            pointerEvents="none"
          />
        )}

        {clippedLeft && (
          <path
            d={`M${left} ${barTop} l-${CLIP_ARROW} ${BAR_HEIGHT / 2} l${CLIP_ARROW} ${BAR_HEIGHT / 2} z`}
            fill={color}
            fillOpacity={timer ? 0.35 : 0.65}
            pointerEvents="none"
          />
        )}
        {clippedRight && (
          <path
            d={`M${right} ${barTop} l${CLIP_ARROW} ${BAR_HEIGHT / 2} l-${CLIP_ARROW} ${BAR_HEIGHT / 2} z`}
            fill={color}
            fillOpacity={timer ? 0.35 : 0.65}
            pointerEvents="none"
          />
        )}

        {captionFits && (
          <text
            className={`gantt-span-label${timer ? ' is-timer' : ''}`}
            x={timer ? right - 6 : left + 6}
            y={barTop + BAR_HEIGHT / 2 + 3.5}
            textAnchor={timer ? 'end' : 'start'}
            pointerEvents="none"
          >
            {caption}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="gantt" ref={attachPlot} data-keep-selection>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height }}
        className="gantt-svg"
        role="img"
        aria-label={`Combo timeline over ${formatSeconds(analysis.duration)} seconds, ${rows.length} rows`}
        onMouseMove={(event) => setCursorTime(timeAt(event))}
        onMouseLeave={() => setCursorTime(null)}
        /*
         * Clicking nothing clears the selection.
         *
         * The rows and the hits stop the click before it gets here, so this only
         * fires on the empty parts of the chart — which is the gesture people
         * already expect from a canvas: click away to let go.
         */
        onClick={() => onPinStep?.(null)}
      >
        <defs>
          {/* Charge time is hatched: nothing happens during it except waiting. */}
          <pattern
            id="gantt-hatch"
            width="5"
            height="5"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="5" height="5" fill="rgba(255,255,255,0.03)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* ---------------------------------------------------------- grid */}
        {ticks.map((tick) => (
          <g key={`t${tick}`}>
            <line
              className="gantt-grid"
              x1={x(tick)}
              x2={x(tick)}
              y1={RULER_HEIGHT - 7}
              y2={height - 24}
            />
            <text className="gantt-tick" x={x(tick)} y={13}>
              {formatTick(tick)}
            </text>
          </g>
        ))}

        {/* ---------------------------------------------------------- rows */}
        {rows.map((row, index) => (
          <g key={`row-${row.key}`}>
            {index % 2 === 1 && (
              <rect
                className="gantt-lane-alt"
                x={AXIS_LEFT}
                y={row.top}
                width={plotWidth}
                height={row.height}
              />
            )}
            {row.groupDivider && (
              <line
                className="gantt-group-rule"
                x1={12}
                x2={AXIS_LEFT + plotWidth}
                y1={row.top - GROUP_RULE_OFFSET}
                y2={row.top - GROUP_RULE_OFFSET}
              />
            )}
            {row.groupTitle && (
              <text
                className="gantt-group-title"
                x={12}
                y={row.groupDivider ? row.top - GROUP_TITLE_OFFSET : 13}
              >
                {row.groupTitle}
              </text>
            )}
            <text
              className={`gantt-lane-label${
                isPinned(stepUidOf(row.key)) ? ' is-pinned' : isLinked(stepUidOf(row.key)) ? ' is-linked' : ''
              }`}
              x={AXIS_LEFT - 12}
              y={row.top + row.tierPad + ROW_HEIGHT / 2 + 4}
              textAnchor="end"
              fill={row.color}
              onClick={(event) => {
                event.stopPropagation();
                onPinStep?.(stepUidOf(row.key) ?? null);
              }}
            >
              {row.label}
            </text>
          </g>
        ))}

        {/* Timers first, so the solid casts sit on top of them */}
        {rows.map((row) =>
          (spansByRow.get(row.key) ?? [])
            .filter((span) => isTimer(span.kind))
            .map((span) => renderSpan(span, row)),
        )}
        {rows.map((row) =>
          (spansByRow.get(row.key) ?? [])
            .filter((span) => !isTimer(span.kind))
            .map((span) => renderSpan(span, row)),
        )}

        {/* ---------------------------------------------------------- hits */}
        {rows.map((row) =>
          (hitsByRow.get(row.key) ?? []).map(({ instance, tier }) => {
            const y = row.top + row.tierPad + ROW_HEIGHT / 2;
            const cx = x(instance.time);
            const linked = isLinked(instance.stepUid);
            const pinned = isPinned(instance.stepUid);
            return (
              <g
                key={instance.id}
                className={`gantt-hit${linked ? ' is-linked' : ''}${pinned ? ' is-pinned' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPinStep?.(instance.stepUid ?? null);
                }}
              >
                <title>
                  {`${instance.sourceLabel} · ${formatSeconds(instance.time)} s\n${Math.round(
                    instance.mitigated,
                  ).toLocaleString('en-US')} effective of ${Math.round(instance.raw).toLocaleString(
                    'en-US',
                  )} raw · ${DAMAGE_TYPE_LABELS[instance.type]}`}
                </title>
                <path
                  d={`M${cx} ${y - 6.5} l6.5 6.5 l-6.5 6.5 l-6.5 -6.5 z`}
                  fill={TYPE_COLOR[instance.type]}
                  stroke={linked || pinned ? 'var(--gold-200)' : 'var(--surface-1)'}
                  strokeWidth={linked || pinned ? 2 : 1}
                />
                <text
                  className="gantt-hit-label"
                  x={cx + 10}
                  y={y + 4 - tier * TIER_STEP}
                  pointerEvents="none"
                >
                  {Math.round(instance.mitigated).toLocaleString('en-US')}
                </text>
              </g>
            );
          }),
        )}

        {/* ------------------------------------------------------- playhead */}
        {/*
          * The same rule as on the chart above, at the same x — that shared axis
          * is what makes the two views one picture while it runs: the curve says
          * how much has landed, the bars say what was busy landing it.
          */}
        {playhead !== null && playhead !== undefined && (
          <g pointerEvents="none">
            <line
              className="gantt-playhead"
              x1={x(playhead)}
              x2={x(playhead)}
              y1={RULER_HEIGHT - 7}
              y2={height - 24}
            />
            <text
              className="gantt-playhead-label mono"
              x={Math.min(x(playhead) + 5, width - 40)}
              y={height - 28}
            >
              {formatSeconds(playhead)} s
            </text>
          </g>
        )}

        {/* ------------------------------------------------------ crosshair */}
        {cursorTime !== null && (
          <g pointerEvents="none">
            <line
              className="gantt-cursor"
              x1={x(cursorTime)}
              x2={x(cursorTime)}
              y1={RULER_HEIGHT - 7}
              y2={height - 24}
            />
            <rect
              x={Math.min(x(cursorTime) + 3, width - 46)}
              y={RULER_HEIGHT - 22}
              width={43}
              height={15}
              rx={2}
              fill="var(--surface-raised)"
            />
            <text
              className="gantt-cursor-label"
              x={Math.min(x(cursorTime) + 6, width - 43)}
              y={RULER_HEIGHT - 11}
            >
              {formatSeconds(cursorTime)} s
            </text>
          </g>
        )}

        {/* ----------------------------------------------------------- axis */}
        <line
          className="gantt-axis"
          x1={AXIS_LEFT}
          x2={AXIS_LEFT + plotWidth}
          y1={height - 24}
          y2={height - 24}
        />
        <text className="gantt-foot" x={AXIS_LEFT} y={height - 8}>
          {window.start > 0.0005
            ? `Time since combo start · first hit at ${formatSeconds(analysis.timeToFirstDamage)} s · the ${formatSeconds(window.start)} s of run-up before it are off-screen`
            : `Time since combo start · ${formatSeconds(analysis.duration)} s total`}
        </text>
      </svg>

      <div className="gantt-legend">
        <span>
          <i className="swatch cast" /> Cast time
        </span>
        <span>
          <i className="swatch charge" /> Charge time
        </span>
        <span>
          <i className="swatch cd" /> Cooldown / recharge (same row, behind the cast)
        </span>
        <span>
          <i className="swatch idle" /> Idle
        </span>
        <span>
          <i className="swatch hit" /> Hit (number is effective damage)
        </span>
        <span>
          <i className="swatch buff-offense" /> Buff: damage
        </span>
        <span>
          <i className="swatch buff-defense" /> Buff: survivability
        </span>
        <span>
          <i className="swatch debuff" /> Debuff on the target
        </span>
      </div>
    </div>
  );
}
