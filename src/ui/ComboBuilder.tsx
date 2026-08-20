/**
 * The combo builder: drag the steps into the order you actually press them.
 *
 * Order is not cosmetic here — the simulation replays the list on a clock, so
 * moving the third auto in front of the ultimate genuinely changes the numbers.
 */

import { useMemo, useState } from 'react';
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
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AbilitySlot, ComboStep } from '../engine/types';
import type { AbilityMeta } from '../model/champions/types';
import { step as makeStep } from '../state/build';
import { Panel } from './components/Panel';

interface Props {
  combo: ComboStep[];
  abilities: AbilityMeta[];
  spellIcons: Partial<Record<AbilitySlot, string>>;
  onChange: (combo: ComboStep[]) => void;
  learnedRanks: Record<AbilitySlot, number>;
}

const PRESETS: { name: string; description: string; build: () => ComboStep[] }[] = [
  {
    name: 'Standard-Engage',
    description: 'Q (voll) → AA → E → AA → R → AA',
    build: () => [
      makeStep({ kind: 'ability', slot: 'Q' }, 1.25),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'E' }),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'R' }),
      makeStep({ kind: 'attack' }),
    ],
  },
  {
    name: 'Ult-Engage',
    description: 'R → AA → E → AA → Q → AA',
    build: () => [
      makeStep({ kind: 'ability', slot: 'R' }),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'E' }),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'Q' }, 1.25),
      makeStep({ kind: 'attack' }),
    ],
  },
  {
    name: 'Voller Burst',
    description: 'Alles inklusive Entzünden, bis W dreifach proct',
    build: () => [
      makeStep({ kind: 'ability', slot: 'Q' }, 1.25),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'E' }),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'R' }),
      makeStep({ kind: 'summoner', summonerId: 'SummonerDot' }),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'ability', slot: 'E' }),
      makeStep({ kind: 'attack' }),
      makeStep({ kind: 'attack' }),
    ],
  },
  {
    name: 'Nur Auto-Attacks',
    description: '6 Basisangriffe — Referenz für reine DPS',
    build: () => Array.from({ length: 6 }, () => makeStep({ kind: 'attack' })),
  },
];

export function ComboBuilder({ combo, abilities, spellIcons, onChange, learnedRanks }: Props) {
  const [showPresets, setShowPresets] = useState(false);

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
    const from = combo.findIndex((entry) => entry.uid === active.id);
    const to = combo.findIndex((entry) => entry.uid === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(combo, from, to));
  }

  function add(step: ComboStep): void {
    onChange([...combo, step]);
  }

  function remove(uid: string): void {
    onChange(combo.filter((entry) => entry.uid !== uid));
  }

  function update(uid: string, patch: Partial<ComboStep>): void {
    onChange(combo.map((entry) => (entry.uid === uid ? { ...entry, ...patch } : entry)));
  }

  function move(uid: string, direction: -1 | 1): void {
    const index = combo.findIndex((entry) => entry.uid === uid);
    const next = index + direction;
    if (index === -1 || next < 0 || next >= combo.length) return;
    onChange(arrayMove(combo, index, next));
  }

  return (
    <Panel
      index="01"
      title="Combo"
      actions={
        <div className="combo-header-actions">
          <button className="btn subtle" onClick={() => setShowPresets((value) => !value)}>
            Vorlagen
          </button>
          <button
            className="btn subtle danger"
            onClick={() => onChange([])}
            disabled={combo.length === 0}
          >
            Leeren
          </button>
        </div>
      }
    >
      {showPresets && (
        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              className="preset-card"
              onClick={() => {
                onChange(preset.build());
                setShowPresets(false);
              }}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-desc">{preset.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className="action-palette">
        <span className="field-label">Hinzufügen</span>
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
                    ? `${ability.name} ist nicht gelernt`
                    : `${ability.name} hinzufügen`
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
          <button className="action-chip slot-aa" onClick={() => add(makeStep({ kind: 'attack' }))}>
            <span className="chip-letter">AA</span>
            <span className="chip-key">Angriff</span>
          </button>
          <button
            className="action-chip neutral"
            onClick={() => add(makeStep({ kind: 'wait', seconds: 0.5 }))}
          >
            <span className="chip-letter">⏱</span>
            <span className="chip-key">Warten</span>
          </button>
          <button
            className="action-chip neutral"
            onClick={() => add(makeStep({ kind: 'summoner', summonerId: 'SummonerDot' }))}
          >
            <span className="chip-letter">🔥</span>
            <span className="chip-key">Entzünden</span>
          </button>
          <button
            className="action-chip neutral"
            onClick={() => add(makeStep({ kind: 'summoner', summonerId: 'SummonerSmite' }))}
          >
            <span className="chip-letter">⚡</span>
            <span className="chip-key">Schmettern</span>
          </button>
        </div>
      </div>

      <hr className="divider" />

      {combo.length === 0 ? (
        <p className="empty-note">
          Noch keine Schritte. Oben eine Aktion anklicken oder eine Vorlage laden — danach lassen
          sich die Karten per Drag &amp; Drop umsortieren.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentElement]}
        >
          <SortableContext items={combo.map((entry) => entry.uid)} strategy={rectSortingStrategy}>
            <ol className="combo-list">
              {combo.map((entry, index) => (
                <SortableStep
                  key={entry.uid}
                  step={entry}
                  index={index}
                  abilities={abilities}
                  spellIcons={spellIcons}
                  onRemove={() => remove(entry.uid)}
                  onUpdate={(patch) => update(entry.uid, patch)}
                  onMove={(direction) => move(entry.uid, direction)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- one card */

interface StepProps {
  step: ComboStep;
  index: number;
  abilities: AbilityMeta[];
  spellIcons: Partial<Record<AbilitySlot, string>>;
  onRemove: () => void;
  onUpdate: (patch: Partial<ComboStep>) => void;
  onMove: (direction: -1 | 1) => void;
}

function SortableStep({
  step,
  index,
  abilities,
  spellIcons,
  onRemove,
  onUpdate,
  onMove,
}: StepProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.uid,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const descriptor = describeStep(step, abilities);
  const icon = step.action.kind === 'ability' ? spellIcons[step.action.slot] : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`combo-card ${descriptor.className}${isDragging ? ' dragging' : ''}`}
    >
      <div className="combo-card-grip" {...attributes} {...listeners} aria-label="Schritt verschieben">
        <span className="combo-index mono">{index + 1}</span>
        {icon ? (
          <img src={icon} alt="" className="combo-icon" />
        ) : (
          <span className="combo-glyph">{descriptor.glyph}</span>
        )}
        <span className="combo-label">{descriptor.label}</span>
      </div>

      {step.action.kind === 'ability' && step.chargeSeconds !== undefined && (
        <label className="combo-charge">
          <span className="combo-charge-label">
            Ladung <span className="mono">{step.chargeSeconds.toFixed(2)} s</span>
          </span>
          <input
            type="range"
            min={0}
            max={1.25}
            step={0.05}
            value={step.chargeSeconds}
            onChange={(event) => onUpdate({ chargeSeconds: Number(event.target.value) })}
          />
        </label>
      )}

      {step.action.kind === 'wait' && (
        <label className="combo-charge">
          <span className="combo-charge-label">
            Dauer <span className="mono">{step.action.seconds.toFixed(2)} s</span>
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
        </label>
      )}

      <div className="combo-card-tools">
        <button className="combo-tool" onClick={() => onMove(-1)} aria-label="Nach vorn">
          ‹
        </button>
        <button className="combo-tool" onClick={() => onMove(1)} aria-label="Nach hinten">
          ›
        </button>
        <button className="combo-tool remove" onClick={onRemove} aria-label="Entfernen">
          ×
        </button>
      </div>
    </li>
  );
}

function describeStep(
  step: ComboStep,
  abilities: AbilityMeta[],
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
      return { label: 'Basisangriff', glyph: 'AA', className: 'slot-aa' };
    case 'wait':
      return { label: 'Warten', glyph: '⏱', className: 'neutral' };
    case 'summoner':
      return {
        label: step.action.summonerId === 'SummonerDot' ? 'Entzünden' : 'Schmettern',
        glyph: step.action.summonerId === 'SummonerDot' ? '🔥' : '⚡',
        className: 'neutral',
      };
    case 'item':
      return { label: 'Item-Aktiv', glyph: '◆', className: 'neutral' };
  }
}
