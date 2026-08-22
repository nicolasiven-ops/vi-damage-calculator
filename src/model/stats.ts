/**
 * Canonical stat model.
 *
 * Everything downstream (items, runes, abilities, the simulation) speaks this
 * vocabulary. Data Dragon's own stat keys are translated into it once, in
 * `items.ts`, and never leak past that boundary.
 *
 * Two conventions worth knowing:
 *  - Percentages are stored as fractions. +35% attack speed is `0.35`.
 *  - `StatBlock` holds *bonus* stats only (what gear gives you). Base stats
 *    come from the champion and are combined in `resolveChampionStats`.
 */

import type { DDragonChampionStats } from '../data/types';

export interface StatBlock {
  hp: number;
  mana: number;
  armor: number;
  magicResist: number;
  attackDamage: number;
  abilityPower: number;
  /** Bonus attack speed as a fraction: 0.35 === +35%. */
  attackSpeed: number;
  /**
   * Bonus attack speed that ignores the 2.5 cap.
   *
   * Almost nothing does this. Hail of Blades says so in its own rules text —
   * "Allows you to temporarily exceed the Attack Speed limit" — and a rune that
   * advertises exactly that would be misrepresented by silently clamping it.
   */
  attackSpeedOverCap: number;
  /** 0..1 */
  critChance: number;
  /** Additional crit damage beyond the 175% base, as a fraction. */
  critDamage: number;
  abilityHaste: number;
  /**
   * Haste that only shortens basic abilities — Q, W and E, never the ultimate.
   *
   * Riot scopes haste in both directions and says so in the text: Spear of
   * Shojin grants "25 Basic Ability Haste", Legend: Haste grants basic haste per
   * stack, and Ultimate Hunter grants haste to the ultimate alone. Folding those
   * into one number would shorten Vi's 90-second ultimate with an item that
   * cannot touch it.
   */
  basicAbilityHaste: number;
  lethality: number;
  /** 0..1 */
  armorPenPercent: number;
  magicPenFlat: number;
  /** 0..1 */
  magicPenPercent: number;
  lifesteal: number;
  omnivamp: number;
  physicalVamp: number;
  moveSpeedFlat: number;
  moveSpeedPercent: number;
  tenacity: number;
  healShieldPower: number;
  healthRegen: number;
  manaRegen: number;
}

export const STAT_KEYS = [
  'hp',
  'mana',
  'armor',
  'magicResist',
  'attackDamage',
  'abilityPower',
  'attackSpeed',
  'attackSpeedOverCap',
  'critChance',
  'critDamage',
  'abilityHaste',
  'basicAbilityHaste',
  'lethality',
  'armorPenPercent',
  'magicPenFlat',
  'magicPenPercent',
  'lifesteal',
  'omnivamp',
  'physicalVamp',
  'moveSpeedFlat',
  'moveSpeedPercent',
  'tenacity',
  'healShieldPower',
  'healthRegen',
  'manaRegen',
] as const satisfies readonly (keyof StatBlock)[];

/** Human-readable labels, used by the stat sheet and item tooltips. */
export const STAT_LABELS: Record<keyof StatBlock, string> = {
  hp: 'Health',
  mana: 'Mana',
  armor: 'Armor',
  magicResist: 'Magic Resistance',
  attackDamage: 'Attack Damage',
  abilityPower: 'Ability Power',
  attackSpeed: 'Attack Speed',
  attackSpeedOverCap: 'Attack Speed Over Cap',
  critChance: 'Critical Strike Chance',
  critDamage: 'Critical Strike Damage',
  abilityHaste: 'Ability Haste',
  basicAbilityHaste: 'Basic Ability Haste',
  lethality: 'Lethality',
  armorPenPercent: 'Armor Penetration',
  magicPenFlat: 'Magic Penetration',
  magicPenPercent: 'Magic Penetration',
  lifesteal: 'Life Steal',
  omnivamp: 'Omnivamp',
  physicalVamp: 'Physical Vamp',
  moveSpeedFlat: 'Movement Speed',
  moveSpeedPercent: 'Movement Speed',
  tenacity: 'Tenacity',
  healShieldPower: 'Heal & Shield Power',
  healthRegen: 'Health Regeneration',
  manaRegen: 'Mana Regeneration',
};

/** Stats rendered as percentages in the UI. */
export const PERCENT_STATS = new Set<keyof StatBlock>([
  'attackSpeed',
  'attackSpeedOverCap',
  'critChance',
  'critDamage',
  'armorPenPercent',
  'magicPenPercent',
  'lifesteal',
  'omnivamp',
  'physicalVamp',
  'moveSpeedPercent',
  'tenacity',
  'healShieldPower',
]);

export function emptyStats(): StatBlock {
  return {
    hp: 0,
    mana: 0,
    armor: 0,
    magicResist: 0,
    attackDamage: 0,
    abilityPower: 0,
    attackSpeed: 0,
    attackSpeedOverCap: 0,
    critChance: 0,
    critDamage: 0,
    abilityHaste: 0,
    basicAbilityHaste: 0,
    lethality: 0,
    armorPenPercent: 0,
    magicPenFlat: 0,
    magicPenPercent: 0,
    lifesteal: 0,
    omnivamp: 0,
    physicalVamp: 0,
    moveSpeedFlat: 0,
    moveSpeedPercent: 0,
    tenacity: 0,
    healShieldPower: 0,
    healthRegen: 0,
    manaRegen: 0,
  };
}

export function addStats(target: StatBlock, source: Partial<StatBlock>): StatBlock {
  for (const key of STAT_KEYS) {
    const value = source[key];
    if (typeof value === 'number') target[key] += value;
  }
  return target;
}

/**
 * Stats that combine multiplicatively rather than by addition.
 *
 * Two sources of 35% and 30% armor penetration leave 0.65 × 0.70 = 45.5% of
 * the armor standing, i.e. 54.5% penetration — not 65%. Adding them would
 * overstate the damage of every penetration build, and the error grows with
 * each item.
 */
const MULTIPLICATIVE_STATS = new Set<keyof StatBlock>([
  'armorPenPercent',
  'magicPenPercent',
  'tenacity',
]);

export function sumStats(blocks: Partial<StatBlock>[]): StatBlock {
  const total = emptyStats();
  const remaining = new Map<keyof StatBlock, number>(
    [...MULTIPLICATIVE_STATS].map((key) => [key, 1]),
  );

  for (const block of blocks) {
    for (const key of STAT_KEYS) {
      const value = block[key];
      if (typeof value !== 'number' || value === 0) continue;
      if (MULTIPLICATIVE_STATS.has(key)) {
        remaining.set(key, (remaining.get(key) ?? 1) * (1 - clamp(value, 0, 1)));
      } else {
        total[key] += value;
      }
    }
  }

  for (const [key, product] of remaining) total[key] = 1 - product;
  return total;
}

/* ------------------------------------------------------------ level scaling */

/**
 * Riot's per-level growth curve. A stat with growth `g` at level `n` is
 * `base + g * (n - 1) * (0.7025 + 0.0175 * (n - 1))` — front-loaded slightly
 * less than linear early, slightly more late.
 */
export function growthMultiplier(level: number): number {
  const n = clamp(level, 1, 18) - 1;
  return n * (0.7025 + 0.0175 * n);
}

export function statAtLevel(base: number, perLevel: number, level: number): number {
  return base + perLevel * growthMultiplier(level);
}

/**
 * Data Dragon's base stats with the growth it stopped shipping put back.
 *
 * `attackdamageperlevel` is zero for every champion in Data Dragon as of 16.16.1 —
 * summary file and per-champion file alike — so a level 11 Vi came out with the
 * attack damage of a level 1 Vi: 63 where the game says 94, and every total that
 * reads attack damage was short by the difference.
 *
 * Riot does ship the number, in the champion's own character record
 * (`damagePerLevelModifiable`), which is the same file this app already reads its
 * ability formulas out of. So the fix is not a maintained constant but a better
 * source, and it is applied here — once, on the way in — so that everything
 * downstream keeps reading one stat block.
 *
 * The published value only fills a gap: a non-zero Data Dragon value is left
 * alone, because the day Riot starts shipping it again is not the day this app
 * should start ignoring it.
 */
export function withPublishedGrowth(
  stats: DDragonChampionStats,
  attackDamagePerLevel: number | null,
): DDragonChampionStats {
  if (stats.attackdamageperlevel > 0 || attackDamagePerLevel === null) return stats;
  return { ...stats, attackdamageperlevel: attackDamagePerLevel };
}

/** Riot's hard cap on total attack speed. */
export const ATTACK_SPEED_CAP = 2.5;

/** Base critical strike damage multiplier. */
export const BASE_CRIT_MULTIPLIER = 1.75;

export interface ChampionStats {
  level: number;
  /** Base AD from the champion, before gear. */
  baseAttackDamage: number;
  bonusAttackDamage: number;
  totalAttackDamage: number;
  abilityPower: number;
  baseHealth: number;
  bonusHealth: number;
  maxHealth: number;
  baseMana: number;
  bonusMana: number;
  maxMana: number;
  armor: number;
  magicResist: number;
  /** Champion's base attack speed at level 1. */
  baseAttackSpeed: number;
  /**
   * Multiplier applied to bonus attack speed. Data Dragon does not ship this
   * field; for the overwhelming majority of champions (Vi included) it equals
   * base attack speed, which is the approximation used here.
   */
  attackSpeedRatio: number;
  /** Bonus AS from levels + gear, as a fraction. */
  bonusAttackSpeed: number;
  /** Attacks per second, capped. */
  totalAttackSpeed: number;
  critChance: number;
  critMultiplier: number;
  abilityHaste: number;
  /** Extra haste for Q, W and E only — see `StatBlock.basicAbilityHaste`. */
  basicAbilityHaste: number;
  lethality: number;
  /** Flat armor penetration derived from lethality (lethality is flat since 2018). */
  flatArmorPen: number;
  armorPenPercent: number;
  magicPenFlat: number;
  magicPenPercent: number;
  lifesteal: number;
  omnivamp: number;
  physicalVamp: number;
  moveSpeed: number;
  attackRange: number;
  healShieldPower: number;
  /** Per 5 seconds, the way the game displays it. */
  healthRegen: number;
  manaRegen: number;
  /**
   * Summed, not multiplied.
   *
   * The game stacks tenacity multiplicatively, so two 30% sources give 51%, not
   * 60%. Nothing here consumes the number — no crowd control is simulated — so
   * it is shown as the sum of what the build provides and labelled as such
   * rather than being quietly wrong in a formula.
   */
  tenacity: number;
}

export function resolveChampionStats(
  base: DDragonChampionStats,
  level: number,
  bonus: StatBlock,
): ChampionStats {
  const lvl = clamp(Math.round(level), 1, 18);

  const baseAttackDamage = statAtLevel(base.attackdamage, base.attackdamageperlevel, lvl);
  const baseHealth = statAtLevel(base.hp, base.hpperlevel, lvl);
  const baseMana = statAtLevel(base.mp, base.mpperlevel, lvl);

  // Attack speed growth is a percentage, not a flat value.
  const bonusAttackSpeedFromLevel = (base.attackspeedperlevel / 100) * growthMultiplier(lvl);
  const bonusAttackSpeed = bonusAttackSpeedFromLevel + bonus.attackSpeed;
  const attackSpeedRatio = base.attackspeed;

  return {
    level: lvl,
    baseAttackDamage,
    bonusAttackDamage: bonus.attackDamage,
    totalAttackDamage: baseAttackDamage + bonus.attackDamage,
    abilityPower: bonus.abilityPower,
    baseHealth,
    bonusHealth: bonus.hp,
    maxHealth: baseHealth + bonus.hp,
    baseMana,
    bonusMana: bonus.mana,
    maxMana: baseMana + bonus.mana,
    armor: statAtLevel(base.armor, base.armorperlevel, lvl) + bonus.armor,
    magicResist: statAtLevel(base.spellblock, base.spellblockperlevel, lvl) + bonus.magicResist,
    baseAttackSpeed: base.attackspeed,
    attackSpeedRatio,
    bonusAttackSpeed,
    // The cap applies to everything except the sources documented to break it,
    // which are added on top of the capped total.
    totalAttackSpeed:
      Math.min(ATTACK_SPEED_CAP, base.attackspeed + attackSpeedRatio * bonusAttackSpeed) +
      attackSpeedRatio * bonus.attackSpeedOverCap,
    critChance: clamp(statAtLevel(base.crit, base.critperlevel, lvl) / 100 + bonus.critChance, 0, 1),
    critMultiplier: BASE_CRIT_MULTIPLIER + bonus.critDamage,
    abilityHaste: bonus.abilityHaste,
    basicAbilityHaste: bonus.basicAbilityHaste,
    lethality: bonus.lethality,
    flatArmorPen: bonus.lethality,
    armorPenPercent: clamp(bonus.armorPenPercent, 0, 1),
    magicPenFlat: bonus.magicPenFlat,
    magicPenPercent: clamp(bonus.magicPenPercent, 0, 1),
    lifesteal: bonus.lifesteal,
    omnivamp: bonus.omnivamp,
    physicalVamp: bonus.physicalVamp,
    moveSpeed: (base.movespeed + bonus.moveSpeedFlat) * (1 + bonus.moveSpeedPercent),
    attackRange: base.attackrange,
    healShieldPower: bonus.healShieldPower,
    healthRegen: statAtLevel(base.hpregen, base.hpregenperlevel, lvl) + bonus.healthRegen,
    manaRegen: statAtLevel(base.mpregen, base.mpregenperlevel, lvl) + bonus.manaRegen,
    tenacity: bonus.tenacity,
  };
}

/** Ability haste → cooldown multiplier. 100 AH halves cooldowns. */
export function cooldownMultiplier(abilityHaste: number): number {
  return 100 / (100 + Math.max(0, abilityHaste));
}

/**
 * The haste that applies to one slot.
 *
 * Basic-ability haste is added for everything that is not the ultimate, which is
 * the whole reason it is a separate number. The passive takes the basic side too:
 * nothing grants haste to a passive, so the branch never matters, and treating
 * it as "not the ultimate" is the honest default.
 */
export function hasteFor(stats: ChampionStats, slot: string): number {
  return slot === 'R' ? stats.abilityHaste : stats.abilityHaste + stats.basicAbilityHaste;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
