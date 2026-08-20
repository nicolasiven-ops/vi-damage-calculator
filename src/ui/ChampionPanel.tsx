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

interface Props {
  detail: DDragonChampionDetail | null;
  version: string;
  championName: string;
  level: number;
  ranks: Record<AbilitySlot, number>;
  abilities: AbilityMeta[];
  stats: ChampionStats;
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
  onLevelChange,
  onRankChange,
}: Props) {
  return (
    <Panel
      index="02"
      title={championName}
      actions={<span className="tag gold">Level {level}</span>}
    >
      <div className="champion-head">
        {detail && (
          <img
            className="champion-portrait"
            src={imageUrls.champion(version, detail.image.full)}
            alt={detail.name}
          />
        )}
        <div className="champion-head-body">
          <span className="champion-title">{detail?.title ?? 'Die Sheriffin von Piltover'}</span>
          <label className="field">
            <span className="field-label">Championlevel</span>
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
                  <span className="field-hint">Passiv</span>
                ) : (
                  <div className="rank-pips">
                    {Array.from({ length: ability.maxRank }, (_, index) => index + 1).map((rank) => (
                      <button
                        key={rank}
                        className={`rank-pip${ranks[ability.slot] >= rank ? ' filled' : ''}`}
                        onClick={() =>
                          onRankChange(ability.slot, ranks[ability.slot] === rank ? rank - 1 : rank)
                        }
                        aria-label={`${ability.name} Rang ${rank}`}
                        title={`Rang ${rank}`}
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

      <StatSheet stats={stats} />
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

export function StatSheet({ stats }: { stats: ChampionStats }) {
  const rows: { label: string; value: string; detail?: string }[] = [
    {
      label: 'Angriffsschaden',
      value: stats.totalAttackDamage.toFixed(0),
      detail: `${stats.baseAttackDamage.toFixed(0)} Basis + ${stats.bonusAttackDamage.toFixed(0)} Bonus`,
    },
    {
      label: 'Leben',
      value: stats.maxHealth.toFixed(0),
      detail: `${stats.baseHealth.toFixed(0)} Basis + ${stats.bonusHealth.toFixed(0)} Bonus`,
    },
    {
      label: 'Angriffstempo',
      value: stats.totalAttackSpeed.toFixed(3),
      detail: `+${(stats.bonusAttackSpeed * 100).toFixed(0)} % Bonus`,
    },
    { label: 'Fähigkeitstempo', value: stats.abilityHaste.toFixed(0) },
    {
      label: 'Rüstungsdurchdringung',
      value: `${(stats.armorPenPercent * 100).toFixed(0)} %`,
      detail: `${stats.lethality.toFixed(0)} Letalität`,
    },
    { label: 'Fähigkeitsstärke', value: stats.abilityPower.toFixed(0) },
    { label: 'Rüstung', value: stats.armor.toFixed(0) },
    { label: 'Magieresistenz', value: stats.magicResist.toFixed(0) },
    {
      label: 'Kritische Treffer',
      value: `${(stats.critChance * 100).toFixed(0)} %`,
      detail: `×${stats.critMultiplier.toFixed(2)} Schaden`,
    },
    { label: 'Mana', value: stats.maxMana.toFixed(0) },
  ];

  return (
    <div className="stat-sheet">
      {rows.map((row) => (
        <div className="stat-row" key={row.label}>
          <span className="stat-label">{row.label}</span>
          <span className="stat-value mono">{row.value}</span>
          {row.detail && <span className="stat-detail">{row.detail}</span>}
        </div>
      ))}
    </div>
  );
}
