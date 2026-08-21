/**
 * Rune selection.
 *
 * The tree layout comes straight from Data Dragon, so every rune in the game is
 * selectable. Whether a rune actually *does* anything in the simulation is a
 * separate question — Data Dragon ships no numbers for runes at all — so each
 * one is badged with whether it is modelled, and the panel says so plainly.
 */

import { imageUrls } from '../data/ddragon';
import type { DDragonRune, DDragonRuneTree } from '../data/types';
import { SHARD_DEFINITIONS, getRuneDefinition, isRuneModelled } from '../model/runes';
import { Panel } from './components/Panel';
import type { LoadoutState } from '../state/build';

interface Props {
  trees: DDragonRuneTree[];
  loadout: LoadoutState;
  offline: boolean;
  onChange: (patch: Partial<LoadoutState>) => void;
}

/** Stat shard rows. Data Dragon does not describe these, so they are fixed. */
/**
 * The shard icons Riot ships, under the same image root as the rune icons.
 *
 * Names in three rows of buttons filled the panel with text for a choice that
 * is made by symbol in the client; these are the symbols people already know.
 */
const SHARD_ICONS: Record<number, string> = {
  5008: 'StatModsAdaptiveForceIcon',
  5005: 'StatModsAttackSpeedIcon',
  5007: 'StatModsCDRScalingIcon',
  5010: 'StatModsMovementSpeedIcon',
  5001: 'StatModsHealthScalingIcon',
  5011: 'StatModsHealthPlusIcon',
  5013: 'StatModsTenacityIcon',
};

const shardIcon = (id: number): string =>
  imageUrls.rune(`perk-images/StatMods/${SHARD_ICONS[id] ?? 'StatModsAdaptiveForceIcon'}.png`);

const SHARD_ROWS: { label: string; ids: number[] }[] = [
  { label: 'Offense', ids: [5008, 5005, 5007] },
  { label: 'Flex', ids: [5008, 5010, 5001] },
  { label: 'Defense', ids: [5011, 5013, 5001] },
];

export function RunePanel({ trees, loadout, offline, onChange }: Props) {
  const primary = trees.find((tree) => tree.id === loadout.primaryTreeId) ?? null;
  const secondary = trees.find((tree) => tree.id === loadout.secondaryTreeId) ?? null;



  if (offline || trees.length === 0) {
    return (
      <Panel title="Runes">
        <p className="empty-note">
          Data Dragon is unreachable — the rune trees cannot be loaded.
        </p>
      </Panel>
    );
  }

  function selectPrimaryTree(treeId: number): void {
    onChange({
      primaryTreeId: treeId,
      keystoneId: null,
      primaryRuneIds: [null, null, null],
      ...(loadout.secondaryTreeId === treeId ? { secondaryTreeId: null, secondaryRuneIds: [null, null] } : {}),
    });
  }

  function selectSecondaryTree(treeId: number): void {
    onChange({ secondaryTreeId: treeId, secondaryRuneIds: [null, null] });
  }

  function pickPrimary(rowIndex: number, runeId: number): void {
    const next = [...loadout.primaryRuneIds];
    next[rowIndex] = next[rowIndex] === runeId ? null : runeId;
    onChange({ primaryRuneIds: next });
  }

  /**
   * The secondary tree allows two runes from two *different* rows, so picking a
   * rune from a row that is already represented replaces that pick.
   */
  function pickSecondary(rowIndex: number, runeId: number, rowsById: Map<number, number>): void {
    const current = [...loadout.secondaryRuneIds];
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
    const next = [...loadout.shardIds];
    next[rowIndex] = next[rowIndex] === shardId ? null : shardId;
    onChange({ shardIds: next });
  }

  const secondaryRowById = new Map<number, number>();
  secondary?.slots.slice(1).forEach((slot, rowIndex) => {
    slot.runes.forEach((rune) => secondaryRowById.set(rune.id, rowIndex));
  });

  return (
    <Panel
      title="Runes"
      actions={
        <div className="rune-header-actions">
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
            Reset
          </button>
        </div>
      }
    >
      <div className="field">
        <span className="field-label">Primary path</span>
        <div className="rune-tree-row">
          {trees.map((tree) => (
            <button
              key={tree.id}
              className={`rune-tree${loadout.primaryTreeId === tree.id ? ' selected' : ''}`}
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
            label="Keystone"
            runes={primary.slots[0]?.runes ?? []}
            isSelected={(rune) => loadout.keystoneId === rune.id}
            onPick={(rune) =>
              onChange({ keystoneId: loadout.keystoneId === rune.id ? null : rune.id })
            }
            large
          />
          {primary.slots.slice(1).map((slot, rowIndex) => (
            <RuneRow
              key={rowIndex}
              label={`Row ${rowIndex + 1}`}
              runes={slot.runes}
              isSelected={(rune) => loadout.primaryRuneIds[rowIndex] === rune.id}
              onPick={(rune) => pickPrimary(rowIndex, rune.id)}
            />
          ))}
        </div>
      )}

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Secondary path</span>
        <div className="rune-tree-row">
          {trees
            .filter((tree) => tree.id !== loadout.primaryTreeId)
            .map((tree) => (
              <button
                key={tree.id}
                className={`rune-tree${loadout.secondaryTreeId === tree.id ? ' selected' : ''}`}
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
              label={`Row ${rowIndex + 1}`}
              runes={slot.runes}
              isSelected={(rune) => loadout.secondaryRuneIds.includes(rune.id)}
              onPick={(rune) => pickSecondary(rowIndex, rune.id, secondaryRowById)}
            />
          ))}
          <p className="field-hint">Two runes from two different rows.</p>
        </div>
      )}

      <hr className="divider" />

      <div className="field">
        <span className="field-label">Stat shards</span>
        <div className="rune-rows">
          {SHARD_ROWS.map((row, rowIndex) => (
            <div className="rune-row" key={row.label}>
              <div className="rune-row-items">
                {row.ids.map((shardId, columnIndex) => {
                  const definition = SHARD_DEFINITIONS.find((entry) => entry.id === shardId);
                  return (
                    <button
                      key={`${shardId}-${columnIndex}`}
                      className={`shard${loadout.shardIds[rowIndex] === shardId ? ' selected' : ''}`}
                      onClick={() => pickShard(rowIndex, shardId)}
                      title={`${definition?.name ?? shardId}${definition?.note ? `
${definition.note}` : ''}`}
                      aria-label={definition?.name ?? String(shardId)}
                    >
                      <img src={shardIcon(shardId)} alt="" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
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
    <div className="rune-row" aria-label={label}>
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
                definition ? `\n\nSimulation: ${definition.note}` : '\n\nNot modelled.'
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
