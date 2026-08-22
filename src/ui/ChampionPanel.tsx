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
import { AbilityStrip, type AbilityTile } from './AbilityStrip';

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
  readiness?: Record<string, AbilityTile['readiness']>;
  onLevelChange: (level: number) => void;
  /** Points spent, available, and the ones the level does not cover. */
  points: { spent: number; available: number; held: { slot: AbilitySlot; rank: number }[] };
  onSkillUp: (slot: AbilitySlot) => void;
  onSkillDown: (slot: AbilitySlot) => void;
  onSkillClear: (slot: AbilitySlot) => void;
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
  points,
  onSkillUp,
  onSkillDown,
  onSkillClear,
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
            <span className="field-label">
              Champion level {level}
              {/*
                * The budget, next to the thing that sets it. One point per level,
                * so this line is the whole rule — and when points are held back it
                * says how many, because the hollow pips alone do not add up.
                */}
              <span className="skill-points mono">
                {points.spent}/{points.available} pts
                {points.held.length > 0 && (
                  <span className="skill-held"> · {points.held.length} held back</span>
                )}
              </span>
            </span>
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
          held: points.held.filter((entry) => entry.slot === ability.slot).length,
          readiness: readiness?.[ability.slot],
        }))}
        points={{ spent: points.spent, available: points.available }}
        onSkillUp={onSkillUp}
        onSkillDown={onSkillDown}
        onSkillClear={onSkillClear}
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
