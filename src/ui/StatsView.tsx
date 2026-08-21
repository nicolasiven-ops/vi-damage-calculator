/**
 * The stat block at one moment of the combo.
 *
 * A build sheet can tell you what your items add up to. What it cannot tell you
 * is what the numbers were 2 seconds in — after Denting Blows shredded the
 * target's armour, while the attack speed buff was still up, before it expired.
 * Those are the numbers the damage was actually computed from, and this is where
 * they are readable.
 *
 * Click a step in the timeline and this shows the state that step left behind,
 * with every change from the step before it marked. With nothing selected it
 * shows where the combo ended, next to where it started.
 */

import type { ComboAnalysis } from '../engine/analysis';
import type { ComboStep, StatSnapshot } from '../engine/types';
import type { AbilityMeta } from '../model/champions/types';

interface Props {
  analysis: ComboAnalysis;
  combo: ComboStep[];
  abilities: AbilityMeta[];
  /** The step whose state to show; the end of the combo when nothing is pinned. */
  pinnedStepUid?: string | null;
}

/** A row of the table: how to read one number out of a snapshot. */
interface StatRow {
  label: string;
  /** Undefined hides the row — a stat nobody in this build has. */
  read: (snapshot: StatSnapshot) => number | null;
  format?: (value: number) => string;
  /** Rows that are only interesting when they are not zero. */
  hideWhenZero?: boolean;
}

const int = (value: number): string => Math.round(value).toLocaleString('en-US');
const one = (value: number): string => value.toFixed(1);
const three = (value: number): string => value.toFixed(3);
const percent = (value: number): string => `${Math.round(value * 100)}%`;

const ATTACKER_ROWS: StatRow[] = [
  { label: 'Attack damage', read: (s) => s.attacker.totalAttackDamage, format: int },
  { label: '— base', read: (s) => s.attacker.baseAttackDamage, format: int },
  { label: '— bonus', read: (s) => s.attacker.bonusAttackDamage, format: int, hideWhenZero: true },
  { label: 'Attack speed', read: (s) => s.attacker.totalAttackSpeed, format: three },
  { label: 'Ability power', read: (s) => s.attacker.abilityPower, format: int, hideWhenZero: true },
  { label: 'Ability haste', read: (s) => s.attacker.abilityHaste, format: int, hideWhenZero: true },
  {
    label: 'Crit chance',
    read: (s) => s.attacker.critChance,
    format: percent,
    hideWhenZero: true,
  },
  {
    label: 'Armor penetration',
    read: (s) => s.attacker.armorPenPercent,
    format: percent,
    hideWhenZero: true,
  },
  { label: 'Lethality', read: (s) => s.attacker.flatArmorPen, format: int, hideWhenZero: true },
  {
    label: 'Magic penetration',
    read: (s) => s.attacker.magicPenPercent,
    format: percent,
    hideWhenZero: true,
  },
  { label: 'Health', read: (s) => s.attacker.maxHealth, format: int },
  { label: 'Armor', read: (s) => s.attacker.armor, format: int },
  { label: 'Magic resistance', read: (s) => s.attacker.magicResist, format: int },
];

const TARGET_ROWS: StatRow[] = [
  { label: 'Health now', read: (s) => s.target.currentHealth, format: int },
  { label: 'Maximum health', read: (s) => s.target.maxHealth, format: int },
  { label: 'Armor', read: (s) => s.target.baseArmor, format: int },
  { label: 'Armor as it is met', read: (s) => s.target.effectiveArmor, format: one },
  { label: 'Magic resistance', read: (s) => s.target.baseMagicResist, format: int },
  { label: 'MR as it is met', read: (s) => s.target.effectiveMagicResist, format: one },
];

const COMBO_ROWS: StatRow[] = [
  { label: 'Damage dealt so far', read: (s) => s.damageDone, format: int },
  { label: 'Shield gained', read: (s) => s.shieldGained, format: int, hideWhenZero: true },
  { label: 'Healing done', read: (s) => s.healingDone, format: int, hideWhenZero: true },
];

function stepName(step: ComboStep | undefined, abilities: AbilityMeta[]): string {
  if (!step) return 'combo start';
  switch (step.action.kind) {
    case 'ability': {
      const slot = step.action.slot;
      return `${slot} · ${abilities.find((a) => a.slot === slot)?.name ?? slot}`;
    }
    case 'attack':
      return 'Basic attack';
    case 'wait':
      return `Wait ${step.action.seconds} s`;
    case 'summoner':
      return step.action.summonerId === 'SummonerDot' ? 'Ignite' : 'Smite';
    case 'item':
      return 'Item active';
  }
}

export function StatsView({ analysis, combo, abilities, pinnedStepUid }: Props) {
  const snapshots = analysis.snapshots;
  if (snapshots.length === 0) {
    return <p className="empty-note">No state to show — the combo has no steps yet.</p>;
  }

  /*
   * Which moment to show, and what to compare it against.
   *
   * A pinned step shows itself against the step before it, which is the
   * comparison that answers "what did this step change". With nothing pinned the
   * end of the combo is shown against its start, which answers the other useful
   * question: what did the whole thing do.
   */
  const pinnedIndex = pinnedStepUid
    ? snapshots.findIndex((entry) => entry.stepUid === pinnedStepUid)
    : -1;
  const currentIndex = pinnedIndex >= 0 ? pinnedIndex : snapshots.length - 1;
  const current = snapshots[currentIndex]!;
  const previous = pinnedIndex >= 0 ? snapshots[currentIndex - 1] : snapshots[0];

  const currentStep = combo.find((step) => step.uid === current.stepUid);
  const previousStep = previous ? combo.find((step) => step.uid === previous.stepUid) : undefined;

  const renderTable = (title: string, rows: StatRow[]) => (
    <div className="stats-block">
      <h3 className="stats-block-title">{title}</h3>
      <table className="stats-table">
        <tbody>
          {rows.map((row) => {
            const value = row.read(current);
            if (value === null) return null;
            const before = previous ? row.read(previous) : null;
            const format = row.format ?? int;
            const changed = before !== null && Math.abs(before - value) > 0.0005;
            if (row.hideWhenZero && !changed && Math.abs(value) < 0.0005) return null;

            return (
              <tr key={row.label} className={changed ? 'is-changed' : undefined}>
                <th>{row.label}</th>
                <td className="mono">{format(value)}</td>
                <td className="mono stats-delta">
                  {changed && before !== null ? (
                    <span className={value > before ? 'up' : 'down'}>
                      {value > before ? '▲' : '▼'} {format(Math.abs(value - before))}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stats-view">
      <div className="stats-head">
        <div>
          <span className="stats-head-label">Showing</span>
          <strong>
            {current.index < 0
              ? 'the state at combo start'
              : `after step ${current.index + 1} · ${stepName(currentStep, abilities)}`}
          </strong>
          <span className="stats-head-time mono">{current.time.toFixed(2)} s</span>
        </div>
        <div className="stats-head-compare">
          <span className="stats-head-label">Compared with</span>
          {previous
            ? previous.index < 0
              ? 'combo start'
              : `step ${previous.index + 1} · ${stepName(previousStep, abilities)}`
            : '—'}
        </div>
        {pinnedIndex < 0 && (
          <span className="field-hint">
            Click a step in the timeline to see the state at that moment.
          </span>
        )}
      </div>

      <div className="stats-grid">
        {renderTable('Vi', ATTACKER_ROWS)}
        {renderTable('Target', TARGET_ROWS)}
        <div className="stats-block">
          <h3 className="stats-block-title">Combo so far</h3>
          <table className="stats-table">
            <tbody>
              {COMBO_ROWS.map((row) => {
                const value = row.read(current);
                if (value === null) return null;
                if (row.hideWhenZero && Math.abs(value) < 0.0005) return null;
                const before = previous ? row.read(previous) : null;
                const changed = before !== null && Math.abs(before - value) > 0.0005;
                const format = row.format ?? int;
                return (
                  <tr key={row.label} className={changed ? 'is-changed' : undefined}>
                    <th>{row.label}</th>
                    <td className="mono">{format(value)}</td>
                    <td className="mono stats-delta">
                      {changed && before !== null ? (
                        <span className="up">+{format(value - before)}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="stats-block-title">In force right now</h3>
          {current.active.length === 0 ? (
            <p className="empty-note">Nothing timed is active at this moment.</p>
          ) : (
            <ul className="stats-active">
              {current.active.map((entry) => (
                <li key={`${entry.label}-${entry.detail}`}>
                  <strong>{entry.label}</strong>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
