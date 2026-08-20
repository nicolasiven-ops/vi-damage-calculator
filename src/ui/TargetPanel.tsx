/**
 * Target configuration.
 *
 * Values can be typed in directly, loaded from a preset, or derived from any
 * champion in Data Dragon at a chosen level — the last one matters because base
 * resistances scale non-linearly and guessing them by hand is where most
 * hand-rolled damage maths goes wrong.
 */

import { useMemo, useState } from 'react';
import type { DDragonChampionSummary } from '../data/types';
import type { TargetConfig } from '../engine/types';
import { resolveChampionStats, emptyStats } from '../model/stats';
import { Panel } from './components/Panel';

interface Props {
  target: TargetConfig;
  champions: Record<string, DDragonChampionSummary>;
  onChange: (target: TargetConfig) => void;
}

const PRESETS: { name: string; target: Partial<TargetConfig> }[] = [
  {
    name: 'Squishy (ADC)',
    target: { name: 'Squishy', maxHealth: 1900, armor: 65, magicResist: 40, unitType: 'champion' },
  },
  {
    name: 'Bruiser',
    target: { name: 'Bruiser', maxHealth: 2700, armor: 130, magicResist: 70, unitType: 'champion' },
  },
  {
    name: 'Tank',
    target: { name: 'Tank', maxHealth: 3600, armor: 220, magicResist: 130, unitType: 'champion' },
  },
  {
    name: 'Drache',
    target: { name: 'Drache', maxHealth: 4500, armor: 60, magicResist: 40, unitType: 'monster' },
  },
  {
    name: 'Baron',
    target: { name: 'Baron Nashor', maxHealth: 12000, armor: 120, magicResist: 70, unitType: 'monster' },
  },
  {
    name: 'Vasall',
    target: { name: 'Vasall', maxHealth: 900, armor: 30, magicResist: 20, unitType: 'minion' },
  },
];

export function TargetPanel({ target, champions, onChange }: Props) {
  const [sourceChampion, setSourceChampion] = useState('');

  const championList = useMemo(
    () => Object.values(champions).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [champions],
  );

  function patch(next: Partial<TargetConfig>): void {
    onChange({ ...target, ...next });
  }

  function applyChampion(championId: string, level: number): void {
    const champion = champions[championId];
    if (!champion) return;
    const stats = resolveChampionStats(champion.stats, level, emptyStats());
    patch({
      name: champion.name,
      level,
      maxHealth: Math.round(stats.maxHealth),
      armor: Math.round(stats.armor * 10) / 10,
      magicResist: Math.round(stats.magicResist * 10) / 10,
      unitType: 'champion',
    });
  }

  return (
    <Panel
      index="05"
      title="Ziel"
      actions={<span className="tag">{target.name}</span>}
    >
      <div className="preset-row">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            className="btn subtle"
            onClick={() => patch(preset.target)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {championList.length > 1 && (
        <div className="field">
          <span className="field-label">Aus Champion übernehmen</span>
          <div className="field-row">
            <select
              value={sourceChampion}
              onChange={(event) => {
                setSourceChampion(event.target.value);
                if (event.target.value) applyChampion(event.target.value, target.level);
              }}
            >
              <option value="">Champion wählen …</option>
              {championList.map((champion) => (
                <option key={champion.id} value={champion.id}>
                  {champion.name}
                </option>
              ))}
            </select>
            <label className="field">
              <span className="field-hint">Level {target.level}</span>
              <input
                type="range"
                min={1}
                max={18}
                value={target.level}
                onChange={(event) => {
                  const level = Number(event.target.value);
                  if (sourceChampion) applyChampion(sourceChampion, level);
                  else patch({ level });
                }}
              />
            </label>
          </div>
          <span className="field-hint">
            Übernimmt nur Basiswerte ohne Items — Rüstung und Leben danach frei anpassbar.
          </span>
        </div>
      )}

      <hr className="divider" />

      <div className="field-row">
        <label className="field">
          <span className="field-label">Maximales Leben</span>
          <input
            type="number"
            min={1}
            value={Math.round(target.maxHealth)}
            onChange={(event) => patch({ maxHealth: Math.max(1, Number(event.target.value)) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Aktuelles Leben</span>
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
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Rüstung</span>
          <input
            type="number"
            value={round1(target.armor)}
            onChange={(event) => patch({ armor: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Magieresistenz</span>
          <input
            type="number"
            value={round1(target.magicResist)}
            onChange={(event) => patch({ magicResist: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Schadensreduktion</span>
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
          <span className="field-hint">Exhaust, Wächter-Items, Randuins …</span>
        </label>
        <label className="field">
          <span className="field-label">Flache Reduktion</span>
          <input
            type="number"
            min={0}
            value={round1(target.flatDamageReduction)}
            onChange={(event) => patch({ flatDamageReduction: Math.max(0, Number(event.target.value)) })}
          />
          <span className="field-hint">Dorans Schild, Bein­platten …</span>
        </label>
      </div>

      <div className="field">
        <span className="field-label">Einheitentyp</span>
        <div className="segmented">
          {(['champion', 'minion', 'monster'] as const).map((type) => (
            <button
              key={type}
              aria-pressed={target.unitType === type}
              onClick={() => patch({ unitType: type })}
            >
              {type === 'champion' ? 'Champion' : type === 'minion' ? 'Vasall' : 'Monster'}
            </button>
          ))}
        </div>
        <span className="field-hint">
          Beeinflusst Obergrenzen wie die 300-Schadens-Kappe von Beulenschlägen.
        </span>
      </div>
    </Panel>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
