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
  /** What moment the sheet shows, e.g. "after step 3". */
  focusLabel?: string | null;
  /** The moment the sheet's arrows are measured against. */
  previous?: StatComparison | null;
  /** Timed effects on this side of the fight, right now. */
  active?: { label: string; detail: string }[];
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
  focusLabel,
  previous,
  active,
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

      <div className="ability-ranks">
        {abilities.map((ability) => {
          const isPassive = ability.maxRank <= 1;
          const icon = spellIcon(detail, ability, version);
          return (
            <div className="ability-rank" key={ability.slot}>
              <div className={`ability-badge slot-${ability.slot.toLowerCase()}`}>
                {icon ? <img src={icon} alt="" /> : <span>{ability.slot}</span>}
                <span className="ability-key">{ability.slot}</span>
              </div>
              <div className="ability-rank-body">
                <span className="ability-name">{ability.name}</span>
                {isPassive ? (
                  <span className="field-hint">Passive</span>
                ) : (
                  <div className="rank-pips">
                    {Array.from({ length: ability.maxRank }, (_, index) => index + 1).map((rank) => (
                      <button
                        key={rank}
                        className={`rank-pip${ranks[ability.slot] >= rank ? ' filled' : ''}`}
                        onClick={() =>
                          onRankChange(ability.slot, ranks[ability.slot] === rank ? rank - 1 : rank)
                        }
                        aria-label={`${ability.name} rank ${rank}`}
                        title={`Rank ${rank}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <hr className="divider" />

      <StatSheet
        stats={stats}
        live={live}
        previous={previous}
        focusLabel={focusLabel}
        active={active}
      />
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
