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
import { imageUrls } from '../data/ddragon';

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
 * Riot's own icon per stat, by file name on the official wiki.
 *
 * These are the icons the client draws in the panel this sheet copies, which is
 * the whole point: the two can be read side by side without translating a legend.
 * The client keeps them in a sprite atlas with no published coordinates, so the
 * wiki's file copies under `Category:Champion stat assets` are the only
 * addressable form — see `imageUrls.statIcon`.
 *
 * The files are the "colored" variants, which is what the in-game panel uses; the
 * plain ones are for prose. Sizes vary between 32 and 72 pixels square and are
 * drawn at 15, so every one of them has pixels to spare.
 */
const ICONS = {
  ad: 'Attack_damage_colored_icon.png',
  ap: 'Ability_power_colored_icon.png',
  armor: 'Armor_colored_icon.png',
  mr: 'Magic_resistance_colored_icon.png',
  attackSpeed: 'Attack_speed_colored_icon.png',
  haste: 'Ability_haste_colored_icon.png',
  crit: 'Critical_strike_chance_colored_icon.png',
  moveSpeed: 'Movement_speed_colored_icon.png',
  regen: 'Health_regeneration_colored_icon.png',
  heal: 'Heal_and_shield_power_colored_icon.png',
  armorPen: 'Armor_penetration_colored_icon.png',
  magicPen: 'Magic_penetration_colored_icon.png',
  lifeSteal: 'Life_steal_colored_icon.png',
  omnivamp: 'Omnivamp_colored_icon.png',
  range: 'Range_colored_icon.png',
  tenacity: 'Tenacity_colored_icon.png',
} as const;

/** Which icon a row wears. Rows without one get none — that is the Extra page. */
interface HudLook {
  icon: keyof typeof ICONS;
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
                      <img
                        className="hud-icon"
                        src={imageUrls.statIcon(ICONS[row.look.icon])}
                        alt=""
                        aria-hidden="true"
                      />
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
      look: { icon: 'ad' },
      title: known(stats.baseAttackDamage)
        ? `Attack Damage · ${int(stats.baseAttackDamage)} base + ${int(stats.bonusAttackDamage)} bonus`
        : 'Attack Damage',
    },
  );
  const abilityPower = row('Ability Power', (r) => r.stats.abilityPower, int, undefined, {
    look: { icon: 'ap' },
  });
  // No footnote about shred or penetration: the value is what the target has
  // right now, the arrow says it moved, and the timeline says what moved it.
  const armor = row('Armor', armorPick, flex, undefined, {
    look: { icon: 'armor' },
  });
  const magicResist = row('Magic Resistance', mrPick, flex, undefined, {
    look: { icon: 'mr' },
  });
  const attackSpeed = row('Attack Speed', (r) => r.stats.totalAttackSpeed, three, undefined, {
    look: { icon: 'attackSpeed' },
  });
  const abilityHaste = row('Ability Haste', (r) => r.stats.abilityHaste, int, undefined, {
    look: { icon: 'haste' },
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
    { look: { icon: 'crit' } },
  );
  const moveSpeed = row('Move Speed', (r) => r.stats.moveSpeed, int, undefined, {
    look: { icon: 'moveSpeed' },
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
            look: { icon: 'regen' },
            title: 'Health and resource regeneration, per 5 seconds',
          },
        ),
        row('Heal & Shield Power', (r) => r.stats.healShieldPower, pct, undefined, {
          look: { icon: 'heal' },
        }),
        row(
          'Armor Penetration',
          (r) => r.stats.lethality,
          int,
          (value) => `${int(value)} | ${pct(stats.armorPenPercent)}`,
          {
            look: { icon: 'armorPen' },
            title: 'Lethality and percentage armor penetration',
          },
        ),
        row(
          'Magic Penetration',
          (r) => r.stats.magicPenFlat,
          int,
          (value) => `${int(value)} | ${pct(stats.magicPenPercent)}`,
          {
            look: { icon: 'magicPen' },
            title: 'Flat and percentage magic penetration',
          },
        ),
        row('Life Steal', (r) => r.stats.lifesteal, pct, undefined, {
          look: { icon: 'lifeSteal' },
        }),
        row('Omnivamp', (r) => r.stats.omnivamp, pct, undefined, {
          look: { icon: 'omnivamp' },
        }),
        row('Attack Range', (r) => r.stats.attackRange, int, undefined, {
          look: { icon: 'range' },
        }),
        row('Tenacity', (r) => r.stats.tenacity, pct, undefined, {
          look: { icon: 'tenacity' },
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
