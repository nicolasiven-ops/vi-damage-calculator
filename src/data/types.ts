/**
 * Shapes returned by Riot's Data Dragon CDN.
 *
 * These are deliberately loose: Data Dragon changes shape between seasons and
 * ships plenty of fields we do not care about. Everything the app actually
 * relies on is narrowed in `ddragon.ts` before it reaches the model layer.
 */

export interface DDragonChampionStats {
  hp: number;
  hpperlevel: number;
  mp: number;
  mpperlevel: number;
  movespeed: number;
  armor: number;
  armorperlevel: number;
  spellblock: number;
  spellblockperlevel: number;
  attackrange: number;
  hpregen: number;
  hpregenperlevel: number;
  mpregen: number;
  mpregenperlevel: number;
  crit: number;
  critperlevel: number;
  attackdamage: number;
  attackdamageperlevel: number;
  attackspeedperlevel: number;
  attackspeed: number;
}

export interface DDragonImage {
  full: string;
  sprite: string;
  group: string;
}

export interface DDragonSpellVar {
  link: string;
  coeff: number | number[];
  key: string;
}

export interface DDragonSpell {
  id: string;
  name: string;
  description: string;
  tooltip: string;
  maxrank: number;
  cooldown: number[];
  cooldownBurn: string;
  cost: number[];
  costBurn: string;
  costType: string;
  maxammo: string;
  range: number[];
  rangeBurn: string;
  effect: (number[] | null)[];
  effectBurn: (string | null)[];
  vars: DDragonSpellVar[];
  image: DDragonImage;
}

export interface DDragonPassive {
  name: string;
  description: string;
  image: DDragonImage;
}

export interface DDragonChampionDetail {
  id: string;
  key: string;
  name: string;
  title: string;
  image: DDragonImage;
  tags: string[];
  partype: string;
  stats: DDragonChampionStats;
  spells: DDragonSpell[];
  passive: DDragonPassive;
}

export interface DDragonChampionSummary {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: DDragonImage;
  stats: DDragonChampionStats;
}

export interface DDragonItem {
  name: string;
  description: string;
  plaintext?: string;
  colloq?: string;
  from?: string[];
  into?: string[];
  gold: { base: number; total: number; sell: number; purchasable: boolean };
  tags: string[];
  maps: Record<string, boolean>;
  stats: Record<string, number>;
  depth?: number;
  requiredChampion?: string;
  requiredAlly?: string;
  inStore?: boolean;
  hideFromAll?: boolean;
  image: DDragonImage;
}

export interface DDragonRune {
  id: number;
  key: string;
  icon: string;
  name: string;
  shortDesc: string;
  longDesc: string;
}

export interface DDragonRuneSlot {
  runes: DDragonRune[];
}

export interface DDragonRuneTree {
  id: number;
  key: string;
  icon: string;
  name: string;
  slots: DDragonRuneSlot[];
}

/** Everything the app needs for one patch, after fetching + normalising. */
export interface PatchBundle {
  version: string;
  locale: string;
  /** True when this came from the bundled offline snapshot rather than the CDN. */
  offline: boolean;
  champions: Record<string, DDragonChampionSummary>;
  items: Record<string, DDragonItem>;
  runeTrees: DDragonRuneTree[];
}
