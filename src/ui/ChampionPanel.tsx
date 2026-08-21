/**
 * Champion setup: level, ability ranks, and the resulting stat sheet.
 *
 * The stat sheet separates base from bonus everywhere, because Vi's ratios do
 * too — the ultimate scales off bonus AD while Q scales off total AD, and a
 * single blended "AD" number would hide the difference that decides builds.
 */

import { imageUrls } from '../data/ddragon';
import type { DDragonChampionDetail } from '../data/types';
import type { AbilitySlot } from '../engine/types';
import type { AbilityMeta } from '../model/champions/types';
import type { ChampionStats } from '../model/stats';
import { Panel } from './components/Panel';
import { StatSheet, type LiveStats, type StatComparison } from './StatSheet';
import { AbilityStrip } from './AbilityStrip';

interface Props {
  detail: DDragonChampionDetail | null;
  version: string;
  championName: string;
  level: number;
  ranks: Record<AbilitySlot, number>;
  abilities: AbilityMeta[];
  stats: ChampionStats;
  /** Simulation-owned values for the focused moment (shield, current health). */
  live?: LiveStats;
  /** The moment the sheet's arrows are measured against. */
  previous?: StatComparison | null;
  /** Cooldowns and charges at the focused moment, keyed by slot. */
  readiness?: Record<
    string,
    { readyIn: number; cooldown: number; charges?: { available: number; max: number } }
  >;
  onLevelChange: (level: number) => void;
  onRankChange: (slot: AbilitySlot, rank: number) => void;
}

export function ChampionPanel({
  detail,
  version,
  championName,
  level,
  ranks,
  abilities,
  stats,
  live,
  previous,
  readiness,
  onLevelChange,
  onRankChange,
}: Props) {
  return (
    // The level belongs to its slider, not to a badge in the far corner that
    // repeats it.
    <Panel title={championName}>
      <div className="champion-head">
        {detail && (
          <img
            className="champion-portrait"
            src={imageUrls.champion(version, detail.image.full)}
            alt={detail.name}
          />
        )}
        <div className="champion-head-body">
          <span className="champion-title">{detail?.title ?? 'the Piltover Enforcer'}</span>
          <label className="field">
            <span className="field-label">Champion level {level}</span>
            <input
              type="range"
              min={1}
              max={18}
              value={level}
              onChange={(event) => onLevelChange(Number(event.target.value))}
            />
          </label>
        </div>
      </div>

      <AbilityStrip
        tiles={abilities.map((ability) => ({
          slot: ability.slot,
          name: ability.name,
          icon: spellIcon(detail, ability, version),
          maxRank: ability.maxRank,
          rank: ranks[ability.slot] ?? 0,
          readiness: readiness?.[ability.slot],
        }))}
        onRankChange={(slot, rank) => onRankChange(slot as AbilitySlot, rank)}
      />

      <hr className="divider" />

      <StatSheet stats={stats} live={live} previous={previous} />
    </Panel>
  );
}

function spellIcon(
  detail: DDragonChampionDetail | null,
  ability: AbilityMeta,
  version: string,
): string | null {
  if (!detail) return null;
  if (!ability.ddragonId) {
    return detail.passive?.image?.full
      ? imageUrls.passive(version, detail.passive.image.full)
      : null;
  }
  const spell = detail.spells?.find((entry) => entry.id === ability.ddragonId);
  return spell ? imageUrls.spell(version, spell.image.full) : null;
}
