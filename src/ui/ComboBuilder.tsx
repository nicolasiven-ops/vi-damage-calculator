/**
 * The combo builder: drag the steps into the order you actually press them.
 *
 * Order is not cosmetic here — the simulation replays the list on a clock, so
 * moving the third auto in front of the ultimate genuinely changes the numbers.
 *
 * It lives as a pinned strip above the analysis rather than a panel in a column,
 * because it is the one thing you never want out of view: every number below it
 * is a consequence of this list, and editing the list while its result is
 * off-screen is editing blind. Hovering a row of the timeline lights up the card
 * that produced it, which is what makes the strip readable as a cause.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AbilitySlot, ComboStep } from '../engine/types';
import type { AbilityMeta } from '../model/champions/types';
import { step as makeStep } from '../state/build';
import { reorderStep } from '../state/combo';

/** One taken summoner spell, as the strip needs to show it. */
export interface SummonerChip {
  id: string;
  name: string;
  iconUrl?: string;
}

interface Props {
  combo: ComboStep[];
  abilities: AbilityMeta[];
  spellIcons: Partial<Record<AbilitySlot, string>>;
  /**
   * The summoner spells this side actually took.
   *
   * The strip used to offer Ignite and Smite unconditionally, which put two
   * spells on the palette that the build may not own and left the other seven
   * unreachable. What you picked in the sidebar is what you can press here.
   */
  summoners: SummonerChip[];
  /**
   * Takes an updater, not a finished list — deliberately.
   *
   * Every edit here derives from the current combo (append, remove, reorder),
   * and the `combo` prop is only as fresh as the last completed render. This app
   * re-runs the whole simulation on every state change, so a second click can
   * easily arrive while the first one is still rendering: both would then build
   * their new list from the same stale prop and the earlier step would vanish.
   * Adding Q, then AA, then E in quick succession lost the AA that way.
   *
   * Passing an updater moves the read to the moment the state is applied, which
   * is the only point where "current" is actually current. The signature keeps
   * it that way: handing over a plain array does not compile.
   */
  onChange: (update: (current: ComboStep[]) => ComboStep[]) => void;
  learnedRanks: Record<AbilitySlot, number>;
  /** How long the combo takes once simulated, for the strip's own summary. */
  durationSeconds?: number;
  /** The step the analysis is currently pointing at, if any. */
  linkedStepUid?: string | null;
  /** The step held by a click in the analysis, shown more strongly. */
  pinnedStepUid?: string | null;
  /**
   * Steps the simulation never reached, because the target was already dead.
   *
   * Kept in the list and dimmed: deleting them would be editing the plan on the
   * player's behalf, and a build that overkills is worth seeing as one.
   */
  unusedStepUids?: string[];
  /**
   * Toggle the focused step.
   *
   * The card is where you point at a press, so clicking one focuses that
   * moment and the stats, the health bar and the timeline follow it.
   */
  onPinStep?: (uid: string | null) => void;
}

export function ComboBuilder({
  combo,
  abilities,
  spellIcons,
  summoners,
  onChange,
  learnedRanks,
  durationSeconds,
  linkedStepUid,
  pinnedStepUid,
  unusedStepUids,
  onPinStep,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const castable = useMemo(
    () => abilities.filter((ability) => ability.castable),
    [abilities],
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange((current) => reorderStep(current, String(active.id), String(over.id)));
  }

  function add(step: ComboStep): void {
    onChange((current) => [...current, step]);
  }

  function remove(uid: string): void {
    onChange((current) => current.filter((entry) => entry.uid !== uid));
  }

  function update(uid: string, patch: Partial<ComboStep>): void {
    onChange((current) =>
      current.map((entry) => (entry.uid === uid ? { ...entry, ...patch } : entry)),
    );
  }


  return (
    <div className="combo-bar">
      <div className="combo-bar-head">
        <h2 className="combo-bar-title">Combo</h2>
        <span className="combo-bar-meta mono">
          {combo.length} {combo.length === 1 ? 'step' : 'steps'}
          {durationSeconds !== undefined && combo.length > 0
            ? ` · ${durationSeconds.toFixed(2)} s`
            : ''}
        </span>
        <div className="combo-bar-spacer" />
        <button
          className="btn subtle danger"
          onClick={() => onChange(() => [])}
          disabled={combo.length === 0}
        >
          Clear
        </button>
      </div>

      <div className="combo-bar-track">
        <div className="action-palette">
          <div className="action-chips">
          {castable.map((ability) => {
            const unlearned = (learnedRanks[ability.slot] ?? 0) < 1;
            return (
              <button
                key={ability.slot}
                className={`action-chip slot-${ability.slot.toLowerCase()}${unlearned ? ' unlearned' : ''}`}
                onClick={() =>
                  add(
                    makeStep(
                      { kind: 'ability', slot: ability.slot },
                      ability.chargeable ? ability.chargeable.maxSeconds : undefined,
                    ),
                  )
                }
                title={
                  unlearned
                    ? `${ability.name} is not learned`
                    : `Add ${ability.name}`
                }
              >
                {spellIcons[ability.slot] ? (
                  <img src={spellIcons[ability.slot]} alt="" className="chip-icon" />
                ) : (
                  <span className="chip-letter">{ability.slot}</span>
                )}
                <span className="chip-key">{ability.slot}</span>
              </button>
            );
          })}
          <button
            className="action-chip slot-aa"
            onClick={() => add(makeStep({ kind: 'attack' }))}
            title="Add a basic attack"
          >
            <span className="chip-letter">AA</span>
            <span className="chip-key">Attack</span>
          </button>
          {/*
           * No "wait" chip. A combo is what you press, and the clock between
           * presses is the simulation's job — an idle step is a way to fake a
           * timing the engine already derives. Existing waits in a stored combo
           * still render and still work.
           */}
          {summoners.map((summoner) => (
            <button
              key={summoner.id}
              className="action-chip neutral"
              onClick={() => add(makeStep({ kind: 'summoner', summonerId: summoner.id }))}
              title={`Add ${summoner.name}`}
            >
              {summoner.iconUrl ? (
                <img src={summoner.iconUrl} alt="" className="chip-icon" />
              ) : (
                <span className="chip-letter">{summoner.name.slice(0, 2)}</span>
              )}
              <span className="chip-key">{summoner.name}</span>
            </button>
          ))}
          </div>
        </div>

        {combo.length === 0 ? (
          <p className="empty-note">
            Noch keine Schritte. Links eine Aktion anklicken — danach lassen sich die Karten
            per Drag &amp; Drop umsortieren.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToParentElement]}
          >
            <SortableContext
              items={combo.map((entry) => entry.uid)}
              strategy={horizontalListSortingStrategy}
            >
              <ol className="combo-strip">
                {combo.map((entry) => (
                  <SortableStep
                    key={entry.uid}
                    step={entry}
                    abilities={abilities}
                    spellIcons={spellIcons}
                    summoners={summoners}
                    linked={linkedStepUid === entry.uid}
                    pinned={pinnedStepUid === entry.uid}
                    unused={unusedStepUids?.includes(entry.uid) ?? false}
                    unlearned={
                      entry.action.kind === 'ability' &&
                      (learnedRanks[entry.action.slot] ?? 0) < 1
                    }
                    onPin={() => onPinStep?.(entry.uid)}
                    onRemove={() => remove(entry.uid)}
                    onUpdate={(patch) => update(entry.uid, patch)}
                    chargeMaxSeconds={chargeMax(entry, abilities)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- one card */

interface StepProps {
  step: ComboStep;

  abilities: AbilityMeta[];
  summoners: SummonerChip[];
  spellIcons: Partial<Record<AbilitySlot, string>>;
  /** True while the analysis is pointing at this step. */
  linked: boolean;
  /** True while a click in the analysis holds this step. */
  pinned: boolean;
  /** True when the target died before this step. */
  unused: boolean;
  /** True when the ability has no rank: it can be planned, it just does nothing. */
  unlearned: boolean;
  onPin: () => void;
  onRemove: () => void;
  /** Editing this step's own numbers: charge length, wait length. */
  onUpdate: (patch: Partial<ComboStep>) => void;
  /** How long this one can be held, when it can be held at all. */
  chargeMaxSeconds: number;
}

function SortableStep({
  step,
  abilities,
  spellIcons,
  summoners,
  linked,
  pinned,
  unused,
  unlearned,
  onPin,
  onRemove,
  onUpdate,
  chargeMaxSeconds,
}: StepProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.uid,
  });

  /*
   * The card is measured as well as sorted, so the floating control can be
   * placed against it. dnd-kit wants the node; so do we.
   */
  const card = useRef<HTMLLIElement | null>(null);
  const holdRefs = (element: HTMLLIElement | null): void => {
    setNodeRef(element);
    card.current = element;
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const descriptor = describeStep(step, abilities, summoners);
  // Bound to a const so the narrowing survives into the lookup below.
  const action = step.action;
  const icon =
    action.kind === 'ability'
      ? spellIcons[action.slot]
      : action.kind === 'summoner'
        ? summoners.find((summoner) => summoner.id === action.summonerId)?.iconUrl
        : undefined;

  /*
   * The whole card is the drag handle.
   *
   * It used to be a grip strip along the top, with arrow buttons for moving a
   * step one place — two mechanisms for one job, and the arrows were the clumsier
   * one. Dragging the card itself is the direct version, so the arrows are gone
   * and the card follows the pointer.
   *
   * The controls inside it stop the pointer from reaching the drag sensor, so the
   * charge slider still slides and the remove button still clicks.
   */
  const stopDrag = {
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    // Removing a step or moving its charge slider is not a request to focus
    // that step, so those clicks stop here.
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  };

  return (
    <li
      ref={holdRefs}
      style={style}
      className={`combo-card ${descriptor.className}${isDragging ? ' dragging' : ''}${
        linked ? ' is-linked' : ''
      }${pinned ? ' is-pinned' : ''}${unused ? ' is-unused' : ''}${
        unlearned ? ' is-unlearned' : ''
      }`}
      title={
        unlearned
          ? 'Not learned — the step stays in the plan and contributes nothing'
          : unused
            ? 'The target was already dead — this step never happened'
            : undefined
      }
      onClick={onPin}
      {...attributes}
      {...listeners}
      aria-label={`${descriptor.label} — click to focus, drag to reorder`}
    >
      <div className="combo-card-grip">
        {icon ? (
          <img src={icon} alt="" className="combo-icon" />
        ) : (
          <span className="combo-glyph">{descriptor.glyph}</span>
        )}
        <span className="combo-label">{descriptor.label}</span>
      </div>

      {pinned && step.action.kind === 'ability' && step.chargeSeconds !== undefined && (
        <FloatingControl anchor={card}>
          <span className="combo-charge-label">
            <span>Charge</span>
            <span className="mono">{step.chargeSeconds.toFixed(2)} s</span>
          </span>
          <input
            type="range"
            min={0}
            max={chargeMaxSeconds}
            step={0.05}
            value={step.chargeSeconds}
            onChange={(event) => onUpdate({ chargeSeconds: Number(event.target.value) })}
          />
        </FloatingControl>
      )}

      {pinned && step.action.kind === 'wait' && (
        <FloatingControl anchor={card}>
          <span className="combo-charge-label">
            <span>Duration</span>
            <span className="mono">{step.action.seconds.toFixed(2)} s</span>
          </span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={step.action.seconds}
            onChange={(event) =>
              onUpdate({ action: { kind: 'wait', seconds: Number(event.target.value) } })
            }
          />
        </FloatingControl>
      )}

      <div className="combo-card-tools" {...stopDrag}>
        <button className="combo-tool remove" onClick={onRemove} aria-label="Remove">
          ×
        </button>
      </div>
    </li>
  );
}

/**
 * A control that hovers above its card and occupies no layout at all.
 *
 * The strip scrolls sideways, which makes it a clipping box: anything drawn
 * outside it disappears, so a popover inside a card was either cut off or had to
 * be paid for with a lane of empty strip. Fixed positioning is outside that box
 * entirely — measured against the card, redrawn when anything moves, and taking
 * no space whatsoever.
 */
function FloatingControl({
  anchor,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const [spot, setSpot] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    function place(): void {
      const element = anchor.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      // The width comes from the card, so the two edges line up exactly.
      setSpot({ left: box.left + box.width / 2, top: box.top - 6, width: box.width });
    }
    place();
    // Capture phase: the strip's own scrolling does not bubble.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  if (!spot) return null;
  return (
    <div
      className="combo-charge floating"
      style={{ left: spot.left, top: spot.top, width: spot.width }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** How long this ability can be held, from the champion's own metadata. */
function chargeMax(step: ComboStep, abilities: AbilityMeta[]): number {
  if (step.action.kind !== 'ability') return 0;
  const slot = step.action.slot;
  return abilities.find((ability) => ability.slot === slot)?.chargeable?.maxSeconds ?? 1.25;
}

function describeStep(
  step: ComboStep,
  abilities: AbilityMeta[],
  summoners: SummonerChip[],
): { label: string; glyph: string; className: string } {
  switch (step.action.kind) {
    case 'ability': {
      const slot = step.action.slot;
      const meta = abilities.find((ability) => ability.slot === slot);
      return {
        label: meta?.name ?? slot,
        glyph: slot,
        className: `slot-${slot.toLowerCase()}`,
      };
    }
    case 'attack':
      return { label: 'Basic attack', glyph: 'AA', className: 'slot-aa' };
    case 'wait':
      return { label: 'Wait', glyph: '⏱', className: 'neutral' };
    case 'summoner': {
      // A stored combo can name a spell the current build no longer takes; it
      // still ran, so it still renders — just without an icon to draw it with.
      const id = step.action.summonerId;
      const taken = summoners.find((summoner) => summoner.id === id);
      const label = taken?.name ?? id.replace(/^Summoner/, '');
      return { label, glyph: label.slice(0, 2), className: 'neutral' };
    }
    case 'item':
      return { label: 'Item active', glyph: '◆', className: 'neutral' };
  }
}
