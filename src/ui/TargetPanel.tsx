/**
 * The target: the other half of every number this app produces.
 *
 * Built like the attacker's panel on purpose — same head, same ability list,
 * same stat sheet. Two things being compared are easier to read when they are
 * shaped alike, and the comparison is the whole job here.
 *
 * Two modes, because there are two honest ways to say what you are hitting:
 *
 *  - **Champion** — pick one, pick a level, and health and resistances come from
 *    Riot's base stats and growth curve. Those values are read-only: they are
 *    derived, and editing one would make the champion in the heading a lie.
 *  - **Custom** — type them, or start from a preset. For "what if they had 200
 *    armour", and for minions and monsters.
 *
 * Each mode keeps its own state, so switching back and forth restores what that
 * mode last held rather than carrying the other one's numbers under the other
 * one's name.
 *
 * The situational settings — how hurt the target already is, what is soaking
 * damage on top of resistances — live in the Simulation panel. They describe the
 * moment being simulated rather than who the target is.
 */

import { useMemo } from 'react';
import { imageUrls } from '../data/ddragon';
import type { DDragonChampionDetail, DDragonChampionSummary } from '../data/types';
import type { TargetConfig } from '../engine/types';
import type { TargetMode, TargetState } from '../state/build';
import type { ChampionStats } from '../model/stats';
import { StatSheet, unknownStats, type LiveStats, type StatComparison } from './StatSheet';
import { Panel } from './components/Panel';
import { SelectMenu, type SelectOption } from './components/SelectMenu';

interface Props {
  state: TargetState;
  /**
   * The target champion resolved at its level, with its own items and runes.
   *
   * Computed one level up, next to the attacker: both sides go through the same
   * stat pipeline, so neither can drift from the other.
   */
  stats: ChampionStats | null;
  /** Health and armour as the simulation has them at the focused moment. */
  live?: LiveStats;
  focusLabel?: string | null;
  previous?: StatComparison | null;
  active?: { label: string; detail: string }[];
  champions: Record<string, DDragonChampionSummary>;
  /** Full detail for the selected champion, once it has loaded. */
  profile: DDragonChampionDetail | null;
  version: string;
  onChange: (next: Partial<TargetState>) => void;
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
  state,
  stats,
  live,
  focusLabel,
  previous,
  active,
  champions,
  profile,
  version,
  onChange,
}: Props) {
  const { target, targetMode: mode, targetChampionId, customPresetId } = state;

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

  const selected = champions[targetChampionId] ?? null;

  /** A target edit. In custom mode it is also what custom mode will remember. */
  function patchTarget(next: Partial<TargetConfig>): void {
    const updated = { ...target, ...next };
    onChange(mode === 'custom' ? { target: updated, customTarget: updated } : { target: updated });
  }

  /**
   * Picking a champion stores the pick, not its numbers.
   *
   * The numbers are derived from the pick, its level and its gear every render,
   * so there is nothing to keep in sync — and no way for a stored copy to
   * disagree with the champion whose name is in the heading.
   */
  function applyChampion(championId: string, level: number): void {
    const champion = champions[championId];
    if (!champion) return;
    onChange({
      targetChampionId: championId,
      target: { ...target, name: champion.name, level, unitType: 'champion' },
    });
  }

  function applyPreset(id: string): void {
    const preset = PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    const updated = { ...target, ...preset.target };
    onChange({ target: updated, customTarget: updated, customPresetId: id });
  }

  /** Each mode restores its own state, rather than inheriting the other's. */
  function switchMode(next: TargetMode): void {
    if (next === mode) return;
    if (next === 'custom') {
      onChange({ targetMode: 'custom', target: state.customTarget });
      return;
    }
    const championId = champions[targetChampionId] ? targetChampionId : championList[0]?.id ?? '';
    const champion = champions[championId];
    onChange({
      targetMode: 'champion',
      targetChampionId: championId,
      target: champion ? { ...target, name: champion.name, unitType: 'champion' } : target,
    });
  }

  return (
    <Panel
      title={
        mode === 'champion' ? (
          <SelectMenu
            variant="title"
            value={targetChampionId}
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
            value={customPresetId}
            options={presetOptions}
            onChange={applyPreset}
            placeholder={target.name || 'Custom'}
            ariaLabel="Target preset"
          />
        )
      }
      /* The button names where it takes you, not where you are. */
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
          {mode === 'champion' ? 'Custom' : 'Champion'}
        </button>
      }
    >
      <div className="champion-head">
        {mode === 'champion' && profile && version && (
          <img
            className="champion-portrait"
            src={imageUrls.champion(version, profile.image.full)}
            alt={profile.name}
          />
        )}
        <div className="champion-head-body">
          <span className="champion-title">
            {mode === 'champion'
              ? profile?.title ?? selected?.title ?? ''
              : 'Hand-typed target'}
          </span>
          <label className="field">
            <span className="field-label">Target level {target.level}</span>
            <input
              type="range"
              min={1}
              max={18}
              value={target.level}
              onChange={(event) => {
                const level = Number(event.target.value);
                if (mode === 'champion') applyChampion(targetChampionId, level);
                else patchTarget({ level });
              }}
            />
          </label>
        </div>
      </div>

      {mode === 'champion' ? (
        <>
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

          <hr className="divider" />

          {stats && (
            <StatSheet
              stats={stats}
              live={live}
              previous={previous}
              focusLabel={focusLabel}
              active={active}
            />
          )}

          <span className="field-hint">
            At level {target.level}, with the items and runes below. Of these, health and the two
            resistances are what the simulation uses: on a target, gear counts for its stats
            only — nothing it <em>does</em> is simulated, the target never acts.
          </span>
        </>
      ) : (
        /*
         * Custom mode keeps the champion panel's three sections so the two
         * columns stay in step: head, then what defines the target where the
         * abilities would be, then the same stat sheet showing the result.
         */
        <>
          <div className="target-definition">
            <label className="field">
              <span className="field-label">Maximum health</span>
              <input
                type="number"
                min={1}
                value={Math.round(target.maxHealth)}
                onChange={(event) =>
                  patchTarget({ maxHealth: Math.max(1, Number(event.target.value)) })
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Armor</span>
              <input
                type="number"
                value={round1(target.armor)}
                onChange={(event) => patchTarget({ armor: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">Magic resistance</span>
              <input
                type="number"
                value={round1(target.magicResist)}
                onChange={(event) => patchTarget({ magicResist: Number(event.target.value) })}
              />
            </label>
          </div>

          <hr className="divider" />

          {/*
           * The same sheet, the same tabs, the same rows — filled with what a
           * typed target actually has. The fields a champion would supply are
           * unknown rather than zero, so they print as dashes instead of
           * inventing numbers, and the two sidebars still line up row for row.
           */}
          <StatSheet
            stats={unknownStats({
              maxHealth: target.maxHealth,
              armor: target.armor,
              magicResist: target.magicResist,
            })}
            live={live}
            /*
             * The comparison has to be the same kind of thing as the current
             * moment, or the arrows would measure a champion's armour against a
             * typed number. Only the live values differ between the two moments,
             * which is exactly what a typed target can change mid-combo.
             */
            previous={
              previous
                ? {
                    stats: unknownStats({
                      maxHealth: target.maxHealth,
                      armor: target.armor,
                      magicResist: target.magicResist,
                    }),
                    live: previous.live,
                    label: previous.label,
                  }
                : null
            }
            focusLabel={focusLabel}
            active={active}
          />
        </>
      )}
    </Panel>
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
