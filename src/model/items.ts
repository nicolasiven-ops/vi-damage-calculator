/**
 * Data Dragon items → canonical stats.
 *
 * Riot's machine-readable `stats` object has not kept up with the game: Ability
 * Haste, Lethality, Armor Penetration, Crit Damage, Omnivamp, Heal & Shield
 * Power and Tenacity simply do not appear in it. The complete list only exists
 * in the `<stats>` block of the item's HTML description.
 *
 * So we parse the description as the primary source and use the legacy `stats`
 * object to fill whatever the parser did not find. Every item records which
 * fields came from where, so the UI can flag anything it could not read.
 */

import type { DDragonItem } from '../data/types';
import { addStats, emptyStats, type StatBlock } from './stats';

export type ItemClass =
  | 'starter'
  | 'boots'
  | 'basic'
  | 'epic'
  | 'legendary'
  | 'consumable'
  | 'trinket'
  | 'other';

export const ITEM_CLASS_LABELS: Record<ItemClass, string> = {
  starter: 'Starter',
  boots: 'Boots',
  basic: 'Basic',
  epic: 'Epic',
  legendary: 'Legendary',
  consumable: 'Consumable',
  trinket: 'Trinket',
  other: 'Other',
};

export interface ResolvedItem {
  id: string;
  name: string;
  raw: DDragonItem;
  stats: StatBlock;
  gold: number;
  itemClass: ItemClass;
  tags: string[];
  /** Stat lines the description parser could not map to a known stat. */
  unparsedStatLines: string[];
  /** Plain-text version of the item's passives/actives, for tooltips. */
  descriptionText: string;
  imageFile: string;
}

/* ------------------------------------------------------- description parsing */

/** English stat labels as they appear in Data Dragon's `<stats>` block. */
const LABEL_TO_STAT: Record<string, keyof StatBlock> = {
  'attack damage': 'attackDamage',
  'ability power': 'abilityPower',
  health: 'hp',
  mana: 'mana',
  armor: 'armor',
  'magic resist': 'magicResist',
  'magic resistance': 'magicResist',
  'attack speed': 'attackSpeed',
  'ability haste': 'abilityHaste',
  'critical strike chance': 'critChance',
  'critical strike damage': 'critDamage',
  'crit damage': 'critDamage',
  lethality: 'lethality',
  'armor penetration': 'armorPenPercent',
  'magic penetration': 'magicPenFlat',
  'life steal': 'lifesteal',
  lifesteal: 'lifesteal',
  omnivamp: 'omnivamp',
  'physical vamp': 'physicalVamp',
  'heal and shield power': 'healShieldPower',
  'heal & shield power': 'healShieldPower',
  'move speed': 'moveSpeedFlat',
  'movement speed': 'moveSpeedFlat',
  tenacity: 'tenacity',
  'health regen': 'healthRegen',
  'base health regen': 'healthRegen',
  'mana regen': 'manaRegen',
  'base mana regen': 'manaRegen',
};

/** Stats that arrive as a percentage and must be stored as a fraction. */
const FRACTION_STATS = new Set<keyof StatBlock>([
  'attackSpeed',
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

/** Percent variants of stats that also exist in a flat form. */
const PERCENT_VARIANT: Partial<Record<keyof StatBlock, keyof StatBlock>> = {
  moveSpeedFlat: 'moveSpeedPercent',
  magicPenFlat: 'magicPenPercent',
  healthRegen: 'healthRegen',
  manaRegen: 'manaRegen',
};

export function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

interface ParsedDescription {
  stats: StatBlock;
  found: Set<keyof StatBlock>;
  unparsed: string[];
}

export function parseItemDescription(description: string): ParsedDescription {
  const stats = emptyStats();
  const found = new Set<keyof StatBlock>();
  const unparsed: string[] = [];

  const block = /<stats>([\s\S]*?)<\/stats>/i.exec(description);
  if (!block?.[1]) return { stats, found, unparsed };

  const lines = block[1]
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Typical shape: `<attention>45</attention> Attack Damage`
    const valueMatch = /<attention>\s*\+?\s*([\d.]+)\s*(%?)\s*<\/attention>/i.exec(line);
    if (!valueMatch?.[1]) {
      const text = stripTags(line);
      if (text) unparsed.push(text);
      continue;
    }

    const numeric = Number.parseFloat(valueMatch[1]);
    if (!Number.isFinite(numeric)) continue;
    const isPercent = valueMatch[2] === '%';

    const label = stripTags(line.replace(valueMatch[0], '')).replace(/^\+/, '').trim().toLowerCase();
    const baseKey = LABEL_TO_STAT[label];

    if (!baseKey) {
      const text = stripTags(line);
      if (text) unparsed.push(text);
      continue;
    }

    // Some labels ("Move Speed", "Magic Penetration") exist in both a flat and
    // a percentage form and are only told apart by the % sign.
    let key = baseKey;
    if (isPercent && PERCENT_VARIANT[baseKey]) key = PERCENT_VARIANT[baseKey]!;

    const value = FRACTION_STATS.has(key) ? numeric / 100 : numeric;
    stats[key] += value;
    found.add(key);
  }

  return { stats, found, unparsed };
}

/* ------------------------------------------------------- legacy stats object */

const LEGACY_KEY_TO_STAT: Record<string, keyof StatBlock> = {
  FlatHPPoolMod: 'hp',
  FlatMPPoolMod: 'mana',
  FlatArmorMod: 'armor',
  FlatSpellBlockMod: 'magicResist',
  FlatPhysicalDamageMod: 'attackDamage',
  FlatMagicDamageMod: 'abilityPower',
  PercentAttackSpeedMod: 'attackSpeed',
  FlatCritChanceMod: 'critChance',
  PercentLifeStealMod: 'lifesteal',
  FlatMovementSpeedMod: 'moveSpeedFlat',
  PercentMovementSpeedMod: 'moveSpeedPercent',
  FlatHPRegenMod: 'healthRegen',
  FlatManaRegenMod: 'manaRegen',
};

/*
 * No conversion happens here, and that is deliberate.
 *
 * There used to be a set of "keys already expressed as fractions" and a ternary
 * that chose between two identical expressions — code claiming a distinction it
 * did not make. The distinction is genuinely unnecessary: every percentage key
 * in the map above (`PercentAttackSpeedMod`, `PercentLifeStealMod`,
 * `PercentMovementSpeedMod`, `FlatCritChanceMod`) is a fraction in Data Dragon
 * already, and every other key is a flat value. Both go in as they come out.
 *
 * If Riot ever adds a legacy percentage key that ships whole percent, this is
 * where the division belongs — and then the branch will do something.
 */
function legacyStats(raw: DDragonItem, alreadyFound: Set<keyof StatBlock>): StatBlock {
  const stats = emptyStats();
  for (const [rawKey, rawValue] of Object.entries(raw.stats ?? {})) {
    const key = LEGACY_KEY_TO_STAT[rawKey];
    if (!key || alreadyFound.has(key)) continue;
    if (typeof rawValue !== 'number' || rawValue === 0) continue;
    stats[key] += rawValue;
  }
  return stats;
}

/* --------------------------------------------------------------- classifying */

function classifyItem(raw: DDragonItem): ItemClass {
  const tags = raw.tags ?? [];
  if (tags.includes('Trinket')) return 'trinket';
  if (tags.includes('Consumable')) return 'consumable';
  if (tags.includes('Boots')) return 'boots';

  const total = raw.gold?.total ?? 0;
  const buildsInto = (raw.into ?? []).length > 0;

  if (!buildsInto) {
    if (total >= 1600) return 'legendary';
    if (total <= 500) return 'starter';
    return 'other';
  }
  if (total <= 500) return 'basic';
  return 'epic';
}

/* ------------------------------------------------------------------ resolving */

export function resolveItem(id: string, raw: DDragonItem): ResolvedItem {
  const parsed = parseItemDescription(raw.description ?? '');
  const stats = emptyStats();
  addStats(stats, parsed.stats);
  addStats(stats, legacyStats(raw, parsed.found));

  const mainText = /<mainText>([\s\S]*?)<\/mainText>/i.exec(raw.description ?? '');
  const withoutStats = (mainText?.[1] ?? raw.description ?? '').replace(
    /<stats>[\s\S]*?<\/stats>/i,
    '',
  );

  return {
    id,
    name: raw.name,
    raw,
    stats,
    gold: raw.gold?.total ?? 0,
    itemClass: classifyItem(raw),
    tags: raw.tags ?? [],
    unparsedStatLines: parsed.unparsed,
    descriptionText: stripTags(withoutStats),
    imageFile: raw.image?.full ?? '',
  };
}

/**
 * Items a player can actually buy on Summoner's Rift, resolved and sorted.
 * Ornn's upgrades, arena-only items and dead entries are filtered out.
 */
export function resolvePurchasableItems(items: Record<string, DDragonItem>): ResolvedItem[] {
  const resolved: ResolvedItem[] = [];
  for (const [id, raw] of Object.entries(items)) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.maps && raw.maps['11'] === false) continue;
    if (raw.inStore === false) continue;
    if (raw.gold?.purchasable === false) continue;
    if (raw.requiredAlly) continue; // Ornn masterwork upgrades
    if (/^\s*$/.test(raw.name ?? '')) continue;
    resolved.push(resolveItem(id, raw));
  }
  resolved.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return resolved;
}

/** True when the item grants nothing this calculator can use. */
export function hasNoUsefulStats(item: ResolvedItem): boolean {
  return Object.values(item.stats).every((value) => value === 0);
}
