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

type PageId = 'stats' | 'advanced' | 'extra';

/**
 * The client's own two pages, and one for what it has no page for.
 *
 * Stats is the block the HUD keeps on screen. Advanced is the block that appears
 * above it when the panel is expanded — same two columns, same paired values, same
 * order, so both can be read against the client without translating. Extra holds
 * what neither block shows.
 */
const PAGES: { id: PageId; label: string; title: string }[] = [
  { id: 'stats', label: 'Stats', title: 'The block the HUD keeps on screen' },
  { id: 'advanced', label: 'Advanced', title: 'The block above it when you expand the panel' },
  { id: 'extra', label: 'Extra', title: 'What the client has no display for' },
];

/** The pages drawn as the game draws them: two columns of icon and number. */
const HUD_PAGES = new Set<PageId>(['stats', 'advanced']);

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

/**
 * One glyph per HUD stat, in the game's own vocabulary.
 *
 * Drawn rather than fetched: Riot publishes no HUD stat icons through any mirror,
 * and eight inline paths theme themselves and cannot fail to load. Each is a
 * 16×16 view box so they line up whatever the row height is.
 */
const ICONS: Record<string, JSX.Element> = {
  // A sword, point up.
  ad: (
    <path d="M8 1.5 10 4v6.5H6V4L8 1.5Zm-2.4 10.5h4.8l-1.2 2.5H6.8l-1.2-2.5Z" />
  ),
  // A staff with a head on it.
  ap: (
    <path d="M11 2a2.2 2.2 0 1 1-1.7 3.6l-5 8.2-1.5-.9 5-8.2A2.2 2.2 0 0 1 11 2Z" />
  ),
  // A shield.
  armor: <path d="M8 1.5 13.5 3v5.2c0 3-2.3 5.4-5.5 6.3-3.2-.9-5.5-3.3-5.5-6.3V3L8 1.5Z" />,
  // A shield with a ring, the way magic resistance is drawn.
  mr: (
    <path d="M8 1.5 13.5 3v5.2c0 3-2.3 5.4-5.5 6.3-3.2-.9-5.5-3.3-5.5-6.3V3L8 1.5Zm0 3.2a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm0 1.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
  ),
  // A clock hand sweeping: how often, not how hard.
  attackSpeed: (
    <path d="M8 1.6a6.4 6.4 0 1 0 6.3 7.5l-1.7-.3A4.7 4.7 0 1 1 8 3.3v2.3l3.4-2.6L8 .4v1.2Zm.8 3.1v3.6l2.8 1.7.8-1.3-2.2-1.3V4.7H8.8Z" />
  ),
  // An hourglass: what haste shortens.
  haste: (
    <path d="M4 1.6h8v1.2l-2.8 3.2 2.8 3.2v1.2H4V9.2l2.8-3.2L4 2.8V1.6Zm0 11.2h8v1.6H4v-1.6Z" />
  ),
  // A four-pointed spark.
  crit: <path d="M8 .8 9.4 6 14 8l-4.6 2L8 15.2 6.6 10 2 8l4.6-2L8 .8Z" />,
  // A boot.
  moveSpeed: (
    <path d="M3 3.2h3.2l.6 3.4 4.4 1.9c1.2.5 1.9 1.6 1.9 2.9v1.4H3V3.2Z" />
  ),
  // A drop, for the two regenerations.
  regen: <path d="M8 1.2c2.6 3.2 4.4 5.6 4.4 7.8a4.4 4.4 0 0 1-8.8 0c0-2.2 1.8-4.6 4.4-7.8Z" />,
  // A cross, the way healing is marked everywhere.
  heal: <path d="M6.4 2h3.2v4.4H14v3.2H9.6V14H6.4V9.6H2V6.4h4.4V2Z" />,
  // A shield with a bite out of it: armour that has been got through.
  armorPen: (
    <path d="M8 1.5 13.5 3v5.2c0 3-2.3 5.4-5.5 6.3-3.2-.9-5.5-3.3-5.5-6.3V3L8 1.5Zm2.9 3.1L5.2 10.3l1.7 1.7 5.7-5.7-1.7-1.7Z" />
  ),
  // The same idea through a ring, which is how magic resistance is drawn.
  magicPen: (
    <path d="M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6Zm0 2a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8Zm3.1 1 1.4 1.4-6.2 6.2-1.4-1.4 6.2-6.2Z" />
  ),
  // A blade over a drop: damage that comes back as health.
  lifeSteal: (
    <path d="M9.8 1.4 11.6 3 5.2 9.4 3.4 7.6l6.4-6.2Zm1.4 6.6c1.6 2 2.6 3.4 2.6 4.4a2.6 2.6 0 0 1-5.2 0c0-1 1-2.4 2.6-4.4Z" />
  ),
  // A drop with a ring: every kind of damage, not just the blade.
  omnivamp: (
    <path d="M8 1.4c2.4 3 4 5.2 4 7.2a4 4 0 0 1-8 0c0-2 1.6-4.2 4-7.2Zm0 3.6c-1.3 1.7-2.2 3-2.2 3.6a2.2 2.2 0 0 0 4.4 0c0-.6-.9-1.9-2.2-3.6Z" />
  ),
  // An arrow leaving the frame: how far the hand reaches.
  range: <path d="M14 2v5.2h-2V5.4l-6.6 6.6H7.2v2H2V8.8h2v1.8L10.6 4H8.8V2H14Z" />,
  // A knot: what tenacity holds together.
  tenacity: (
    <path d="M8 1.6a3.6 3.6 0 0 0-3.6 3.6v1.2H3.2V14h9.6V6.4h-1.2V5.2A3.6 3.6 0 0 0 8 1.6Zm0 1.8c1 0 1.8.8 1.8 1.8v1.2H6.2V5.2c0-1 .8-1.8 1.8-1.8Z" />
  ),
};

/** Which glyph and which colour a row wears. Rows without one get neither. */
interface HudLook {
  icon: keyof typeof ICONS;
  tone: string;
}

export function StatSheet({ stats, live, previous }: Props) {
  const [page, setPage] = useState<PageId>('stats');
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
            className={`stat-sheet${HUD_PAGES.has(entry.id) ? ' is-hud' : ''}`}
            key={entry.id}
            role="tabpanel"
            aria-hidden={page !== entry.id}
            data-active={page === entry.id}
          >
            {HUD_PAGES.has(entry.id)
              ? /*
                 * The game's own box: two columns, a glyph where the label was.
                 * The eight stats here are the eight the HUD shows, in the HUD's
                 * order, so the app can be held up next to the client and read
                 * without translating.
                 */
                buildRows(entry.id, now, previous ?? null).map((row) => (
                  <div
                    className={`hud-stat${row.delta ? ' is-changed' : ''}`}
                    key={row.label}
                    title={row.title ?? row.label}
                  >
                    {row.look && (
                      <svg
                        className="hud-icon"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        style={{ fill: row.look.tone }}
                      >
                        {ICONS[row.look.icon]}
                      </svg>
                    )}
                    <span className="hud-value mono">{row.value}</span>
                    {row.delta && (
                      <span className={`hud-delta mono ${row.delta.direction}`}>
                        {row.delta.direction === 'up' ? '▲' : '▼'} {row.delta.text}
                      </span>
                    )}
                  </div>
                ))
              : buildRows(entry.id, now, previous ?? null).map((row) => (
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
  /** Set on the HUD page, where an icon stands in for the label. */
  look?: HudLook;
  /** What the icon cannot say: the name, and the split behind the number. */
  title?: string;
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
    extra?: { look?: HudLook; title?: string },
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
      ...(extra?.look ? { look: extra.look } : {}),
      ...(extra?.title ? { title: extra.title } : {}),
    };
  }

  const { stats, live } = now;
  const three = dec(3);
  const one = dec(1);

  // Shred is the target's business, so the sheet shows the shredded value and
  // names both the number it came down from and the number the attacker meets.
  const armorPick: Pick = (r) => r.live.armor ?? r.stats.armor;
  const mrPick: Pick = (r) => r.live.magicResist ?? r.stats.magicResist;

  /*
   * The tooltip carries the split the game shows when you hover the number —
   * "94 base + 120 bonus" — which is the form the two can be compared in. The
   * base half is the one that went wrong for a year: Data Dragon publishes no
   * attack-damage growth, so it sat at its level 1 value.
   */
  const attackDamage = row(
    'Attack Damage',
    (r) => r.stats.totalAttackDamage,
    int,
    undefined,
    {
      look: { icon: 'ad', tone: 'var(--ad-tone, #f0a659)' },
      title: known(stats.baseAttackDamage)
        ? `Attack Damage · ${int(stats.baseAttackDamage)} base + ${int(stats.bonusAttackDamage)} bonus`
        : 'Attack Damage',
    },
  );
  const abilityPower = row('Ability Power', (r) => r.stats.abilityPower, int, undefined, {
    look: { icon: 'ap', tone: 'var(--ap-tone, #8f7bf5)' },
  });
  // No footnote about shred or penetration: the value is what the target has
  // right now, the arrow says it moved, and the timeline says what moved it.
  const armor = row('Armor', armorPick, flex, undefined, {
    look: { icon: 'armor', tone: 'var(--armor-tone, #e0c060)' },
  });
  const magicResist = row('Magic Resistance', mrPick, flex, undefined, {
    look: { icon: 'mr', tone: 'var(--mr-tone, #5fd0c8)' },
  });
  const attackSpeed = row('Attack Speed', (r) => r.stats.totalAttackSpeed, three, undefined, {
    look: { icon: 'attackSpeed', tone: 'var(--as-tone, #d9e05f)' },
  });
  const abilityHaste = row('Ability Haste', (r) => r.stats.abilityHaste, int, undefined, {
    look: { icon: 'haste', tone: 'var(--haste-tone, #7fb6f5)' },
  });
  /*
   * Both halves in the value, in the order they are bought: how often, then how
   * hard. A multiplier on its own line read as a footnote to the chance, when it
   * is the other half of the same stat.
   */
  const crit = row(
    'Critical Strike',
    (r) => r.stats.critChance,
    pct,
    (value) =>
      // The client's own separator for a cell with two halves, as on Advanced.
      known(stats.critMultiplier)
        ? `${pct(value)} | ×${stats.critMultiplier.toFixed(2)}`
        : pct(value),
    { look: { icon: 'crit', tone: 'var(--crit-tone, #f06868)' } },
  );
  const moveSpeed = row('Move Speed', (r) => r.stats.moveSpeed, int, undefined, {
    look: { icon: 'moveSpeed', tone: 'var(--ms-tone, #b9c6d8)' },
  });
  /*
   * No health row, and no mana row either. Neither block in the client has one —
   * both live on the bars, and this app draws those bars right above the sheet.
   * A third copy of a number that is already on screen twice is what made the old
   * four pages feel like a list rather than a panel.
   */

  switch (page) {
    case 'stats':
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
     * Advanced, in the client's own order and with its own pairing.
     *
     * The game writes two numbers in one cell where a stat has a flat and a
     * percentage half — "0|0%" for penetration, "19|0" for the two regenerations —
     * and that is worth copying rather than splitting into rows: it is the same
     * eight cells, so the two panels line up next to each other.
     */
    case 'advanced':
      return [
        row(
          'Regeneration',
          (r) => r.stats.healthRegen,
          one,
          (value) => `${one(value)} | ${one(stats.manaRegen)}`,
          {
            look: { icon: 'regen', tone: 'var(--regen-tone, #6fd08a)' },
            title: 'Health and resource regeneration, per 5 seconds',
          },
        ),
        row('Heal & Shield Power', (r) => r.stats.healShieldPower, pct, undefined, {
          look: { icon: 'heal', tone: 'var(--heal-tone, #7fe0a8)' },
        }),
        row(
          'Armor Penetration',
          (r) => r.stats.lethality,
          int,
          (value) => `${int(value)} | ${pct(stats.armorPenPercent)}`,
          {
            look: { icon: 'armorPen', tone: 'var(--armorpen-tone, #e08a5f)' },
            title: 'Lethality and percentage armor penetration',
          },
        ),
        row(
          'Magic Penetration',
          (r) => r.stats.magicPenFlat,
          int,
          (value) => `${int(value)} | ${pct(stats.magicPenPercent)}`,
          {
            look: { icon: 'magicPen', tone: 'var(--magicpen-tone, #a98ff0)' },
            title: 'Flat and percentage magic penetration',
          },
        ),
        row('Life Steal', (r) => r.stats.lifesteal, pct, undefined, {
          look: { icon: 'lifeSteal', tone: 'var(--lifesteal-tone, #e06868)' },
        }),
        row('Omnivamp', (r) => r.stats.omnivamp, pct, undefined, {
          look: { icon: 'omnivamp', tone: 'var(--omnivamp-tone, #c05f8f)' },
        }),
        row('Attack Range', (r) => r.stats.attackRange, int, undefined, {
          look: { icon: 'range', tone: 'var(--range-tone, #9fd8e0)' },
        }),
        row('Tenacity', (r) => r.stats.tenacity, pct, undefined, {
          look: { icon: 'tenacity', tone: 'var(--tenacity-tone, #d0b070)' },
        }),
      ];

    /*
     * What the client has no cell for.
     *
     * Basic ability haste is its own stat because it does not touch the ultimate,
     * and the client has no display for it at all — it shows one haste number.
     * Physical vamp is folded into the client's omnivamp cell. Both are real and
     * both would otherwise be invisible, so they get names rather than glyphs.
     */
    case 'extra':
      return [
        row('Basic Ability Haste', (r) => r.stats.basicAbilityHaste),
        row('Physical Vamp', (r) => r.stats.physicalVamp, pct),
        ...(live.shield !== undefined ? [row('Shield', (r) => r.live.shield ?? 0, int)] : []),
      ];
  }
}
