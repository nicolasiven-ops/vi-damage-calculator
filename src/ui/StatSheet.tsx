/**
 * The stat sheet, as the game shows it — plus what the game cannot show you.
 *
 * The default page is the eight stats the in-game HUD keeps on screen; the tabs
 * above it are the pages you get when you expand that panel. The point of the
 * split is that a sidebar wide enough for thirty rows does not exist, and a
 * sheet that shows everything at once shows nothing in particular.
 *
 * Two things make it more than a build sheet:
 *
 *  - It reads the focused moment, not the build. Hover or click a combo step and
 *    these are the numbers the damage was actually computed from — after the
 *    shred landed, while the attack speed buff was still up.
 *  - Every row that moved says how far it moved, left of the value. That is the
 *    question a stat block gets asked mid-combo: not "what is my attack speed"
 *    but "what did that step do to it".
 *
 * All four pages are always rendered, stacked in one grid cell with the inactive
 * ones hidden. That is what makes the panel as tall as its tallest page and keeps
 * it there: clicking through the tabs moves nothing below it.
 */

import { useState } from 'react';
import type { ChampionStats } from '../model/stats';

/** Values the simulation owns rather than the build: shred, damage taken. */
export interface LiveStats {
  currentHealth?: number;
  /** Armour after shred, before anyone's penetration. */
  armor?: number;
  magicResist?: number;
  shield?: number;
}

/** The moment to compare against, so each row can show what changed. */
export interface StatComparison {
  stats: ChampionStats;
  live?: LiveStats;
}

interface Props {
  stats: ChampionStats;
  live?: LiveStats;
  previous?: StatComparison | null;
}

type PageId = 'overview' | 'offense' | 'defense' | 'utility';

const PAGES: { id: PageId; label: string; title: string }[] = [
  { id: 'overview', label: 'Overview', title: 'The stats the HUD keeps on screen' },
  { id: 'offense', label: 'Offense', title: 'Damage, penetration, sustain from damage' },
  { id: 'defense', label: 'Defense', title: 'Health, resistances, regeneration' },
  { id: 'utility', label: 'Utility', title: 'Movement, mana, range' },
];

/*
 * Unknown is not zero.
 *
 * A typed target has a health pool and two resistances and no champion behind
 * it, so its attack damage is not 0 — it is unanswerable. Those fields arrive as
 * NaN and print as a dash, which keeps both sides of the app on one sheet with
 * one set of tabs instead of a second hand-built copy that drifts.
 */
const known = (value: number): boolean => Number.isFinite(value);
const int = (value: number): string =>
  known(value) ? Math.round(value).toLocaleString('en-US') : '—';
const dec =
  (digits: number) =>
  (value: number): string =>
    known(value) ? value.toFixed(digits) : '—';
const pct = (value: number): string => (known(value) ? `${Math.round(value * 100)}%` : '—');
/**
 * Whole numbers stay whole.
 *
 * Resistances are integers in the client, but shred puts a fraction on them —
 * "71" and "72.4" both need to be printable by one formatter, and "71.0" is a
 * decimal place claiming a precision the number does not have.
 */
const flex = (value: number): string => {
  if (!known(value)) return '—';
  return Math.abs(value - Math.round(value)) < 0.05 ? int(value) : value.toFixed(1);
};

/**
 * A stat block for something that is not a champion: everything unknown, then
 * the few fields the caller actually knows.
 */
export function unknownStats(overrides: Partial<ChampionStats>): ChampionStats {
  const n = Number.NaN;
  return {
    level: n,
    baseAttackDamage: n,
    bonusAttackDamage: n,
    totalAttackDamage: n,
    abilityPower: n,
    baseHealth: n,
    bonusHealth: n,
    maxHealth: n,
    baseMana: n,
    bonusMana: n,
    maxMana: n,
    armor: n,
    magicResist: n,
    baseAttackSpeed: n,
    attackSpeedRatio: n,
    bonusAttackSpeed: n,
    totalAttackSpeed: n,
    critChance: n,
    critMultiplier: n,
    abilityHaste: n,
    basicAbilityHaste: n,
    lethality: n,
    flatArmorPen: n,
    armorPenPercent: n,
    magicPenFlat: n,
    magicPenPercent: n,
    lifesteal: n,
    omnivamp: n,
    physicalVamp: n,
    moveSpeed: n,
    attackRange: n,
    healShieldPower: n,
    healthRegen: n,
    manaRegen: n,
    tenacity: n,
    ...overrides,
  };
}

export function StatSheet({ stats, live, previous }: Props) {
  const [page, setPage] = useState<PageId>('overview');
  const now = { stats, live: live ?? {} };

  return (
    <div className="stat-pages">
      <div className="stat-tabs" role="tablist" aria-label="Stat pages">
        {PAGES.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={page === entry.id}
            className={`stat-tab${page === entry.id ? ' active' : ''}`}
            onClick={() => setPage(entry.id)}
            title={entry.title}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="stat-stack">
        {PAGES.map((entry) => (
          <div
            className="stat-sheet"
            key={entry.id}
            role="tabpanel"
            aria-hidden={page !== entry.id}
            data-active={page === entry.id}
          >
            {buildRows(entry.id, now, previous ?? null).map((row) => (
              <div className={`stat-row${row.delta ? ' is-changed' : ''}`} key={row.label}>
                <span className="stat-label">{row.label}</span>
                {row.delta && (
                  <span className={`stat-delta mono ${row.delta.direction}`}>
                    {row.delta.direction === 'up' ? '▲' : '▼'} {row.delta.text}
                  </span>
                )}
                <span className="stat-value mono">{row.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/*
       * No list of what is ticking. Every buff and shred worth reading is
       * already in the numbers above and on the timeline below, so the list
       * restated them in a third place and grew the panel to do it.
       */}
    </div>
  );
}

interface Row {
  label: string;
  value: string;
  delta?: { direction: 'up' | 'down'; text: string };
}

type Reading = { stats: ChampionStats; live: LiveStats };
type Pick = (reading: Reading) => number;

function buildRows(page: PageId, now: Reading, previous: StatComparison | null): Row[] {
  const before: Reading | null = previous
    ? { stats: previous.stats, live: previous.live ?? {} }
    : null;

  /**
   * One row, with its change worked out from the same reader.
   *
   * Deriving the arrow from the row's own accessor is what keeps the two
   * honest: there is no way to show a delta for a different number than the one
   * printed next to it.
   */
  function row(
    label: string,
    pick: Pick,
    format: (value: number) => string = int,
    display?: (value: number) => string,
  ): Row {
    const value = pick(now);
    const past = before ? pick(before) : Number.NaN;
    const moved = known(value) && known(past) && Math.abs(value - past) > 0.0005;
    return {
      label,
      value: (display ?? format)(value),
      delta: moved
        ? { direction: value > past ? 'up' : 'down', text: format(Math.abs(value - past)) }
        : undefined,
    };
  }

  const { stats, live } = now;
  const three = dec(3);
  const one = dec(1);

  // Shred is the target's business, so the sheet shows the shredded value and
  // names both the number it came down from and the number the attacker meets.
  const armorPick: Pick = (r) => r.live.armor ?? r.stats.armor;
  const mrPick: Pick = (r) => r.live.magicResist ?? r.stats.magicResist;

  const attackDamage = row('Attack Damage', (r) => r.stats.totalAttackDamage);
  const abilityPower = row('Ability Power', (r) => r.stats.abilityPower);
  // No footnote about shred or penetration: the value is what the target has
  // right now, the arrow says it moved, and the timeline says what moved it.
  const armor = row('Armor', armorPick, flex);
  const magicResist = row('Magic Resistance', mrPick, flex);
  const attackSpeed = row('Attack Speed', (r) => r.stats.totalAttackSpeed, three);
  const abilityHaste = row('Ability Haste', (r) => r.stats.abilityHaste);
  /*
   * Both halves in the value, in the order they are bought: how often, then how
   * hard. A multiplier on its own line read as a footnote to the chance, when it
   * is the other half of the same stat.
   */
  const crit = row('Critical Strike', (r) => r.stats.critChance, pct, (value) =>
    known(stats.critMultiplier) ? `${pct(value)} / ×${stats.critMultiplier.toFixed(2)}` : pct(value),
  );
  const moveSpeed = row('Move Speed', (r) => r.stats.moveSpeed);
  const health = row('Health', (r) => r.live.currentHealth ?? r.stats.maxHealth, int, (value) =>
    live.currentHealth !== undefined ? `${int(value)} / ${int(stats.maxHealth)}` : int(value),
  );

  switch (page) {
    case 'overview':
      return [
        attackDamage,
        abilityPower,
        armor,
        magicResist,
        attackSpeed,
        abilityHaste,
        crit,
        moveSpeed,
      ];

    /*
     * Offense does not repeat Overview.
     *
     * Attack damage, ability power, attack speed, crit and haste are on the page
     * that is open by default; a tab that shows them again for the sake of
     * looking complete is a tab you never need to open.
     */
    case 'offense':
      return [
        // Flat then percent, in one value: 18 lethality and a Last Whisper is
        // "18 / 35%", which is how penetration is read and bought.
        row(
          'Armor Penetration',
          (r) => r.stats.lethality,
          int,
          (value) => `${int(value)} / ${pct(stats.armorPenPercent)}`,
        ),
        row(
          'Magic Penetration',
          (r) => r.stats.magicPenFlat,
          int,
          (value) => `${int(value)} / ${pct(stats.magicPenPercent)}`,
        ),
        row('Life Steal', (r) => r.stats.lifesteal, pct),
        row('Omnivamp', (r) => r.stats.omnivamp, pct),
        row('Physical Vamp', (r) => r.stats.physicalVamp, pct),
      ];

    case 'defense':
      return [
        health,
        row('Health Regeneration', (r) => r.stats.healthRegen, one),
        // Next to health regeneration, where it is read: the two answer the same
        // question about two different pools.
        row('Resource Regeneration', (r) => r.stats.manaRegen, one),
        row('Tenacity', (r) => r.stats.tenacity, pct),
        ...(live.shield !== undefined ? [row('Shield', (r) => r.live.shield ?? 0, int)] : []),
      ];

    case 'utility':
      return [
        row('Mana', (r) => r.stats.maxMana),
        // Its own row rather than folded into Ability Haste: it does not touch
        // the ultimate, and a single number would say it does.
        row('Basic Ability Haste', (r) => r.stats.basicAbilityHaste),
        row('Heal & Shield Power', (r) => r.stats.healShieldPower, pct),
        row('Attack Range', (r) => r.stats.attackRange),
      ];
  }
}
