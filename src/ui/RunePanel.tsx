/**
 * Rune selection.
 *
 * The tree layout comes straight from Data Dragon, so every rune in the game is
 * selectable. Whether a rune actually *does* anything in the simulation is a
 * separate question — Data Dragon ships no numbers for runes at all — so each
 * one is badged with whether it is modelled, and the panel says so plainly.
 */

import { useMemo } from 'react';
import { imageUrls } from '../data/ddragon';
import type { DDragonRune, DDragonRuneTree } from '../data/types';
import { SHARD_DEFINITIONS, getRuneDefinition, isRuneModelled } from '../model/runes';
import { Panel } from './components/Panel';
import type { BuildState } from '../state/build';

interface Props {
  trees: DDragonRuneTree[];
  build: BuildState;
  offline: boolean;
  onChange: (patch: Partial<BuildState>) => void;
}

/** Stat shard rows. Data Dragon does not describe these, so they are fixed. */
const SHARD_ROWS: { label: string; ids: number[] }[] = [
  { label: 'Offensiv', ids: [5008, 5005, 5007] },
  { label: 'Flexibel', ids: [5008, 5010, 5001] },
  { label: 'Defensiv', ids: [5011, 5013, 5001] },
];

export function RunePanel({ trees, build, offline, onChange }: Props) {
  const primary = trees.find((tree) => tree.id === build.primaryTreeId) ?? null;
  const secondary = trees.find((tree) => tree.id === build.secondaryTreeId) ?? null;

  const selectedCount = useMemo(
    () =>
      [build.keystoneId, ...build.primaryRuneIds, ...build.secondaryRuneIds, ...build.shardIds].filter(
        (id) => id !== null,
      ).length,
    [build],
  );

  const unmodelled = useMemo(
    () =>
      [build.keystoneId, ...build.primaryRuneIds, ...build.secondaryRuneIds]
        .filter((id): id is number => typeof id === 'number')
        .filter((id) => !isRuneModelled(id)),
    [build],
  );

  if (offline || trees.length === 0) {
    return (
      <Panel index="04" title="Runen">
        <p className="empty-note">
          Data Dragon ist nicht erreichbar — die Runenbäume können nicht geladen werden.
        </p>
      </Panel>
    );
  }

  function selectPrimaryTree(treeId: number): void {
    onChange({
      primaryTreeId: treeId,
      keystoneId: null,
      primaryRuneIds: [null, null, null],
      ...(build.secondaryTreeId === treeId ? { secondaryTreeId: null, secondaryRuneIds: [null, null] } : {}),
    });
  }

  function selectSecondaryTree(treeId: number): void {
    onChange({ secondaryTreeId: treeId, secondaryRuneIds: [null, null] });
  }

  function pickPrimary(rowIndex: number, runeId: number): void {
    const next = [...build.primaryRuneIds];
    next[rowIndex] = next[rowIndex] === runeId ? null : runeId;
    onChange({ primaryRuneIds: next });
  }

  /**
   * The secondary tree allows two runes from two *different* rows, so picking a
   * rune from a row that is already represented replaces that pick.
   */
  function pickSecondary(rowIndex: number, runeId: number, rowsById: Map<number, number>): void {
    const current = [...build.secondaryRuneIds];
    const existingIndex = current.findIndex(
      (id) => id !== null && rowsById.get(id) === rowIndex,
    );

    if (existingIndex !== -1) {
      current[existingIndex] = current[existingIndex] === runeId ? null : runeId;
    } else {
      const free = current.findIndex((id) => id === null);
      if (free === -1) {
        // Both slots taken by other rows: replace the oldest pick.
        current[0] = runeId;
      } else {
        current[free] = runeId;
      }
    }
    onChange({ secondaryRuneIds: current });
  }

  function pickShard(rowIndex: number, shardId: number): void {
    const next = [...build.shardIds];
    next[rowIndex] = next[rowIndex] === shardId ? null : shardId;
    onChange({ shardIds: next });
  }

  const secondaryRowById = new Map<number, number>();
  secondary?.slots.slice(1).forEach((slot, rowIndex) => {
    slot.runes.forEach((rune) => secondaryRowById.set(rune.id, rowIndex));
  });

  return (
    <Panel
      index="04"
      title="Runen"
      actions={
        <div className="rune-header-actions">
          <span className="tag">{selectedCount} gewählt</span>
          <button
            className="btn subtle"
            onClick={() =>
              onChange({
                keystoneId: null,
                primaryTreeId: null,
                primaryRuneIds: [null, null, null],
                secondaryTreeId: null,
                secondaryRuneIds: [null, null],
                shardIds: [null, null, null],
              })
            }
          >
            Zurücksetzen
          </button>
        </div>
      }
    >
      <div className="field">
        <span className="field-label">Primärer Pfad</span>
        <div className="rune-tree-row">
          {trees.map((tree) => (
            <button
              key={tree.id}
              className={`rune-tree${build.primaryTreeId === tree.id ? ' selected' : ''}`}
              onClick={() => selectPrimaryTree(tree.id)}
              title={tree.name}
            >
              <img src={imageUrls.rune(tree.icon)} alt="" />
              <span>{tree.name}</span>
            </button>
          ))}
        </div>
      </div>

      {primary && (
        <div className="rune-rows">
          <RuneRow
            label="Schlüsselstein"
            runes={primary.slots[0]?.runes ?? []}
            isSelected={(rune) => build.keystoneId === rune.id}
            onPick={(rune) =>
              onChange({ keystoneId: build.keystoneId === rune.id ? null : rune.id })
            }
            large
          />
          {primary.slots.slice(1).map((slot, rowIndex) => (
            <RuneRow
              key={rowIndex}
              label={`Reihe ${rowIndex + 1}`}
              runes={slot.runes}
              isSelected={(rune) => build.primaryRuneIds[rowIndex] === rune.id}
              onPick={(rune) => pickPrimary(rowIndex, rune.id)}
            />
          ))}
        </div>
      )}

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Sekundärer Pfad</span>
        <div className="rune-tree-row">
          {trees
            .filter((tree) => tree.id !== build.primaryTreeId)
            .map((tree) => (
              <button
                key={tree.id}
                className={`rune-tree${build.secondaryTreeId === tree.id ? ' selected' : ''}`}
                onClick={() => selectSecondaryTree(tree.id)}
                title={tree.name}
              >
                <img src={imageUrls.rune(tree.icon)} alt="" />
                <span>{tree.name}</span>
              </button>
            ))}
        </div>
      </div>

      {secondary && (
        <div className="rune-rows">
          {secondary.slots.slice(1).map((slot, rowIndex) => (
            <RuneRow
              key={rowIndex}
              label={`Reihe ${rowIndex + 1}`}
              runes={slot.runes}
              isSelected={(rune) => build.secondaryRuneIds.includes(rune.id)}
              onPick={(rune) => pickSecondary(rowIndex, rune.id, secondaryRowById)}
            />
          ))}
          <p className="field-hint">Zwei Runen aus zwei verschiedenen Reihen.</p>
        </div>
      )}

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Attributsplitter</span>
        <div className="rune-rows">
          {SHARD_ROWS.map((row, rowIndex) => (
            <div className="rune-row" key={row.label}>
              <span className="rune-row-label">{row.label}</span>
              <div className="rune-row-items">
                {row.ids.map((shardId, columnIndex) => {
                  const definition = SHARD_DEFINITIONS.find((entry) => entry.id === shardId);
                  return (
                    <button
                      key={`${shardId}-${columnIndex}`}
                      className={`shard${build.shardIds[rowIndex] === shardId ? ' selected' : ''}`}
                      onClick={() => pickShard(rowIndex, shardId)}
                      title={definition?.note}
                    >
                      {definition?.name ?? shardId}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {unmodelled.length > 0 && (
        <p className="rune-warning">
          <span className="tag warn">nicht modelliert</span> {unmodelled.length}{' '}
          {unmodelled.length === 1 ? 'gewählte Rune wirkt' : 'gewählte Runen wirken'} sich in der
          Simulation nicht aus — sie {unmodelled.length === 1 ? 'ist' : 'sind'} im Ergebnis nicht
          enthalten.
        </p>
      )}
    </Panel>
  );
}

interface RowProps {
  label: string;
  runes: DDragonRune[];
  isSelected: (rune: DDragonRune) => boolean;
  onPick: (rune: DDragonRune) => void;
  large?: boolean;
}

function RuneRow({ label, runes, isSelected, onPick, large }: RowProps) {
  return (
    <div className="rune-row">
      <span className="rune-row-label">{label}</span>
      <div className="rune-row-items">
        {runes.map((rune) => {
          const modelled = isRuneModelled(rune.id);
          const definition = getRuneDefinition(rune.id);
          return (
            <button
              key={rune.id}
              className={`rune${large ? ' large' : ''}${isSelected(rune) ? ' selected' : ''}${
                modelled ? '' : ' unmodelled'
              }`}
              onClick={() => onPick(rune)}
              title={`${rune.name}\n${stripHtml(rune.shortDesc)}${
                definition ? `\n\nSimulation: ${definition.note}` : '\n\nNicht modelliert.'
              }`}
            >
              <img src={imageUrls.rune(rune.icon)} alt={rune.name} />
              {modelled && <span className="rune-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}
