/**
 * The target: the other half of every number this app produces.
 *
 * Two modes, because there are two honest ways to describe what you are hitting:
 *
 *  - **Champion** — pick one, pick a level, and the resistances come from Riot's
 *    base stats and growth curve. This is the mode to trust: base armour and
 *    magic resistance grow non-linearly, and guessing them is where hand-rolled
 *    damage maths usually goes wrong. The values are read-only here, because
 *    they are derived; editing one would make the champion label a lie.
 *  - **Custom** — type the numbers, or start from a preset. This is the mode for
 *    "what if they had 200 armour", and for minions and monsters.
 *
 * Switching from champion to custom hands the derived numbers over as a starting
 * point, so the switch never costs you your place.
 *
 * The layout mirrors the attacker's panel on purpose: same head, same ability
 * list, same stat sheet. Comparing two things is easier when they are shaped
 * alike, and the target's abilities are shown for orientation — the simulation
 * models damage *to* the target, never the target acting.
 */

import { useMemo } from 'react';
import { imageUrls } from '../data/ddragon';
import type { DDragonChampionDetail, DDragonChampionSummary } from '../data/types';
import type { TargetConfig } from '../engine/types';
import type { TargetMode } from '../state/build';
import { resolveChampionStats, emptyStats } from '../model/stats';
import { Panel } from './components/Panel';
import { SelectMenu, type SelectOption } from './components/SelectMenu';

interface Props {
  target: TargetConfig;
  mode: TargetMode;
  championId: string;
  champions: Record<string, DDragonChampionSummary>;
  /** Full detail for the selected champion, when it has loaded. */
  profile: DDragonChampionDetail | null;
  version: string;
  onChange: (target: TargetConfig) => void;
  onModeChange: (mode: TargetMode) => void;
  onChampionChange: (championId: string) => void;
}

const PRESETS: { id: string; name: string; target: Partial<TargetConfig> }[] = [
  {
    id: 'squishy',
    name: 'Squishy (ADC)',
    target: { name: 'Squishy', maxHealth: 1900, armor: 65, magicResist: 40, unitType: 'champion' },
  },
  {
    id: 'bruiser',
    name: 'Bruiser',
    target: { name: 'Bruiser', maxHealth: 2700, armor: 130, magicResist: 70, unitType: 'champion' },
  },
  {
    id: 'tank',
    name: 'Tank',
    target: { name: 'Tank', maxHealth: 3600, armor: 220, magicResist: 130, unitType: 'champion' },
  },
  {
    id: 'dragon',
    name: 'Dragon',
    target: { name: 'Dragon', maxHealth: 4500, armor: 60, magicResist: 40, unitType: 'monster' },
  },
  {
    id: 'baron',
    name: 'Baron Nashor',
    target: {
      name: 'Baron Nashor',
      maxHealth: 12000,
      armor: 120,
      magicResist: 70,
      unitType: 'monster',
    },
  },
  {
    id: 'minion',
    name: 'Minion',
    target: { name: 'Minion', maxHealth: 900, armor: 30, magicResist: 20, unitType: 'minion' },
  },
];

/** The five slots a champion's abilities occupy, in the order the client shows. */
const ABILITY_SLOTS = ['P', 'Q', 'W', 'E', 'R'] as const;

export function TargetPanel({
  target,
  mode,
  championId,
  champions,
  profile,
  version,
  onChange,
  onModeChange,
  onChampionChange,
}: Props) {
  const championList = useMemo(
    () => Object.values(champions).sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [champions],
  );

  const championOptions = useMemo<SelectOption[]>(
    () =>
      championList.map((champion) => ({
        id: champion.id,
        label: champion.name,
        detail: champion.title,
        iconUrl: version ? imageUrls.champion(version, champion.image.full) : undefined,
      })),
    [championList, version],
  );

  const presetOptions = useMemo<SelectOption[]>(
    () =>
      PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.name,
        detail: `${preset.target.maxHealth} HP · ${preset.target.armor} armor · ${preset.target.magicResist} MR`,
      })),
    [],
  );

  const selected = champions[championId] ?? null;

  function patch(next: Partial<TargetConfig>): void {
    onChange({ ...target, ...next });
  }

  /** Base stats of the selected champion at a level, without items. */
  function championStats(level: number) {
    if (!selected) return null;
    return resolveChampionStats(selected.stats, level, emptyStats());
  }

  function applyChampion(id: string, level: number): void {
    const champion = champions[id];
    if (!champion) return;
    const stats = resolveChampionStats(champion.stats, level, emptyStats());
    onChampionChange(id);
    patch({
      name: champion.name,
      level,
      maxHealth: Math.round(stats.maxHealth),
      armor: Math.round(stats.armor * 10) / 10,
      magicResist: Math.round(stats.magicResist * 10) / 10,
      unitType: 'champion',
    });
  }

  function applyPreset(id: string): void {
    const preset = PRESETS.find((entry) => entry.id === id);
    if (preset) patch(preset.target);
  }

  /**
   * Champion mode needs a champion. Picking the first one on switching is
   * friendlier than an empty panel that explains itself.
   */
  function switchMode(next: TargetMode): void {
    onModeChange(next);
    if (next === 'champion' && !champions[championId]) {
      const first = championList[0];
      if (first) applyChampion(first.id, target.level);
    }
  }

  const stats = mode === 'champion' ? championStats(target.level) : null;
  const currentPreset = PRESETS.find((preset) => preset.target.name === target.name);

  return (
    <Panel
      title={
        mode === 'champion' ? (
          <SelectMenu
            variant="title"
            value={championId}
            options={championOptions}
            onChange={(id) => applyChampion(id, target.level)}
            placeholder="Pick a champion"
            searchable
            searchPlaceholder="Search champions …"
            ariaLabel="Target champion"
          />
        ) : (
          <SelectMenu
            variant="title"
            value={currentPreset?.id ?? ''}
            options={presetOptions}
            onChange={applyPreset}
            placeholder={target.name || 'Custom target'}
            ariaLabel="Target preset"
          />
        )
      }
      actions={
        <button
          className="mode-toggle"
          onClick={() => switchMode(mode === 'champion' ? 'custom' : 'champion')}
          title={
            mode === 'champion'
              ? 'Switch to hand-typed values'
              : 'Switch to a champion’s base stats'
          }
        >
          {mode === 'champion' ? 'Champion' : 'Custom'}
        </button>
      }
    >
      {mode === 'champion' ? (
        <>
          <div className="champion-head">
            {profile && version && (
              <img
                className="champion-portrait"
                src={imageUrls.champion(version, profile.image.full)}
                alt={profile.name}
              />
            )}
            <div className="champion-head-body">
              <span className="champion-title">{profile?.title ?? selected?.title ?? ''}</span>
              <label className="field">
                <span className="field-label">Target level</span>
                <input
                  type="range"
                  min={1}
                  max={18}
                  value={target.level}
                  onChange={(event) => applyChampion(championId, Number(event.target.value))}
                />
              </label>
            </div>
          </div>

          <div className="ability-ranks">
            {ABILITY_SLOTS.map((slot) => {
              const ability = abilityOf(profile, slot, version);
              return (
                <div className="ability-rank" key={slot}>
                  <div className={`ability-badge slot-${slot.toLowerCase()}`}>
                    {ability?.icon ? <img src={ability.icon} alt="" /> : <span>{slot}</span>}
                    <span className="ability-key">{slot}</span>
                  </div>
                  <div className="ability-rank-body">
                    <span className="ability-name">{ability?.name ?? '—'}</span>
                    <span className="field-hint">{slot === 'P' ? 'Passive' : 'Not simulated'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <span className="field-hint">
            Abilities are listed for orientation. The simulation models damage dealt to this
            target, never the target acting.
          </span>

          <hr className="divider" />

          {stats && (
            <div className="stat-sheet">
              <StatRow
                label="Health"
                value={Math.round(stats.maxHealth).toLocaleString('en-US')}
                detail={`level ${target.level} base, no items`}
              />
              <StatRow label="Armor" value={round1(stats.armor).toString()} />
              <StatRow label="Magic Resistance" value={round1(stats.magicResist).toString()} />
              <StatRow
                label="Attack Damage"
                value={Math.round(stats.totalAttackDamage).toString()}
                detail="not used — the target does not fight back"
              />
            </div>
          )}

          <hr className="divider" />

          <Situational target={target} patch={patch} />

          <span className="field-hint">
            Health and resistances follow the champion and its level. To bend them, switch to
            Custom — the numbers come along.
          </span>
        </>
      ) : (
        <>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Maximum health</span>
              <input
                type="number"
                min={1}
                value={Math.round(target.maxHealth)}
                onChange={(event) => patch({ maxHealth: Math.max(1, Number(event.target.value)) })}
              />
            </label>
            <label className="field">
              <span className="field-label">Level</span>
              <input
                type="number"
                min={1}
                max={18}
                value={target.level}
                onChange={(event) => patch({ level: clamp(Number(event.target.value), 1, 18) })}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field-label">Armor</span>
              <input
                type="number"
                value={round1(target.armor)}
                onChange={(event) => patch({ armor: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">Magic resistance</span>
              <input
                type="number"
                value={round1(target.magicResist)}
                onChange={(event) => patch({ magicResist: Number(event.target.value) })}
              />
            </label>
          </div>

          <div className="field">
            <span className="field-label">Unit type</span>
            <div className="segmented">
              {(['champion', 'minion', 'monster'] as const).map((type) => (
                <button
                  key={type}
                  aria-pressed={target.unitType === type}
                  onClick={() => patch({ unitType: type })}
                >
                  {type === 'champion' ? 'Champion' : type === 'minion' ? 'Minion' : 'Monster'}
                </button>
              ))}
            </div>
            <span className="field-hint">
              Affects caps such as the 300 damage cap on Denting Blows.
            </span>
          </div>

          <hr className="divider" />

          <Situational target={target} patch={patch} />
        </>
      )}
    </Panel>
  );
}

/**
 * The parts that apply whichever mode you are in: how hurt the target already
 * is, and what is soaking damage on top of resistances.
 */
function Situational({
  target,
  patch,
}: {
  target: TargetConfig;
  patch: (next: Partial<TargetConfig>) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field-label">Current health</span>
        <div className="input-with-suffix">
          <input
            type="number"
            min={1}
            max={100}
            value={Math.round(target.currentHealthPercent * 100)}
            onChange={(event) =>
              patch({ currentHealthPercent: clamp(Number(event.target.value) / 100, 0.01, 1) })
            }
          />
          <span className="input-suffix">%</span>
        </div>
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Damage reduction</span>
          <div className="input-with-suffix">
            <input
              type="number"
              min={0}
              max={90}
              value={Math.round(target.percentDamageReduction * 100)}
              onChange={(event) =>
                patch({ percentDamageReduction: clamp(Number(event.target.value) / 100, 0, 0.9) })
              }
            />
            <span className="input-suffix">%</span>
          </div>
          <span className="field-hint">Exhaust, Randuin’s Omen …</span>
        </label>
        <label className="field">
          <span className="field-label">Flat reduction</span>
          <input
            type="number"
            min={0}
            value={round1(target.flatDamageReduction)}
            onChange={(event) =>
              patch({ flatDamageReduction: Math.max(0, Number(event.target.value)) })
            }
          />
          <span className="field-hint">Doran’s Shield, Bone Plating …</span>
        </label>
      </div>
    </>
  );
}

function StatRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

function abilityOf(
  profile: DDragonChampionDetail | null,
  slot: (typeof ABILITY_SLOTS)[number],
  version: string,
): { name: string; icon: string | null } | null {
  if (!profile) return null;
  if (slot === 'P') {
    const passive = profile.passive;
    return {
      name: passive?.name ?? 'Passive',
      icon: passive?.image?.full && version ? imageUrls.passive(version, passive.image.full) : null,
    };
  }
  const index = ABILITY_SLOTS.indexOf(slot) - 1;
  const spell = profile.spells?.[index];
  if (!spell) return null;
  return {
    name: spell.name,
    icon: version ? imageUrls.spell(version, spell.image.full) : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
