/**
 * Synthetic Data Dragon fixtures.
 *
 * These reproduce the *shape* of Riot's payloads — including the quirks the
 * parser has to survive, such as stats living only in the description markup —
 * so the pipeline can be tested without network access.
 *
 * The numbers here are made up. They are not game data and must never be used
 * as such; they exist so a test can assert "the parser read 45 out of this
 * markup", not "Ionic Spark grants 45 AD".
 */

import type { DDragonChampionDetail, DDragonItem, DDragonSpell } from '../src/data/types';

export const FIXTURE_CHAMPION_STATS = {
  hp: 600,
  hpperlevel: 100,
  mp: 300,
  mpperlevel: 60,
  movespeed: 340,
  armor: 30,
  armorperlevel: 4,
  spellblock: 32,
  spellblockperlevel: 2,
  attackrange: 125,
  hpregen: 9,
  hpregenperlevel: 0.9,
  mpregen: 8,
  mpregenperlevel: 0.6,
  crit: 0,
  critperlevel: 0,
  attackdamage: 60,
  attackdamageperlevel: 3,
  attackspeedperlevel: 2,
  attackspeed: 0.65,
};

function spell(
  id: string,
  effect: (number[] | null)[],
  overrides: Partial<DDragonSpell> = {},
): DDragonSpell {
  return {
    id,
    name: id,
    description: '',
    tooltip: '',
    maxrank: 5,
    cooldown: [10, 9, 8, 7, 6],
    cooldownBurn: '10/9/8/7/6',
    cost: [50, 55, 60, 65, 70],
    costBurn: '50/55/60/65/70',
    costType: 'Mana',
    maxammo: '-1',
    range: [600, 600, 600, 600, 600],
    rangeBurn: '600',
    effect,
    effectBurn: effect.map((row) => (row ? row.join('/') : null)),
    vars: [],
    image: { full: `${id}.png`, sprite: 'spell0.png', group: 'spell' },
    ...overrides,
  };
}

export const FIXTURE_CHAMPION: DDragonChampionDetail = {
  id: 'Vi',
  key: '254',
  name: 'Vi',
  title: 'Testchampion',
  image: { full: 'Vi.png', sprite: 'champion4.png', group: 'champion' },
  tags: ['Fighter'],
  partype: 'Mana',
  stats: FIXTURE_CHAMPION_STATS,
  spells: [
    // effect[0] is always null in Data Dragon; effect[1] and [2] carry the
    // min/max charge damage for Vault Breaker.
    spell('ViQ', [null, [40, 60, 80, 100, 120], [100, 150, 200, 250, 300]], {
      name: 'Vault Breaker',
    }),
    spell('ViW', [null, [4, 5, 6, 7, 8]], { name: 'Denting Blows' }),
    /*
     * The damage numbers here are invented like every other fixture value, but
     * the charge fields are not: `maxammo: 2` with a 1 s cooldown is the shape
     * Riot actually ships for an ability with charges, and it is the shape the
     * simulation reads to tell a recharge timer from a cooldown. Leaving the
     * generic 10/9/8/7/6 here would have tested a gate that does not exist.
     */
    spell('ViE', [null, [10, 30, 50, 70, 90]], {
      name: 'Relentless Force',
      cooldown: [1, 1, 1, 1, 1],
      cooldownBurn: '1',
      maxammo: '2',
    }),
    /*
     * Real cooldowns, for the same reason as E's charge fields: an ultimate on
     * the generic 8 s fixture cooldown cannot exercise what a 90 s one does —
     * a combo that asks for it twice, and the point past which the simulation
     * stops pretending it will ever come up again.
     */
    spell('ViR', [null, [150, 325, 500]], {
      name: 'Cease and Desist',
      cooldown: [140, 115, 90],
      cooldownBurn: '140/115/90',
    }),
  ],
  passive: {
    name: 'Blast Shield',
    description: '',
    image: { full: 'Vi_P.png', sprite: 'passive0.png', group: 'passive' },
  },
};

export const FIXTURE_SPELLS_BY_ID = Object.fromEntries(
  FIXTURE_CHAMPION.spells.map((entry) => [entry.id, entry]),
);

/** A modern item: stats only in the description, empty legacy `stats` object. */
export const FIXTURE_MODERN_ITEM: DDragonItem = {
  name: 'Testklinge',
  description:
    '<mainText><stats><attention>45</attention> Attack Damage<br><attention>18</attention> Lethality<br>' +
    '<attention>20</attention> Ability Haste<br><attention>25%</attention> Critical Strike Chance<br>' +
    '<attention>5%</attention> Move Speed</stats><br><li><passive>Testpassiv:</passive> tut nichts.</li></mainText>',
  gold: { base: 1000, total: 3200, sell: 2240, purchasable: true },
  tags: ['Damage', 'ArmorPenetration'],
  maps: { '11': true },
  stats: {},
  image: { full: 'test.png', sprite: 'item0.png', group: 'item' },
};

/** A legacy item: stats only in the machine-readable object. */
export const FIXTURE_LEGACY_ITEM: DDragonItem = {
  name: 'Altes Schwert',
  description: '<mainText>Kein Statusblock.</mainText>',
  gold: { base: 400, total: 1300, sell: 910, purchasable: true },
  tags: ['Damage'],
  maps: { '11': true },
  stats: { FlatPhysicalDamageMod: 30, PercentAttackSpeedMod: 0.25, FlatHPPoolMod: 200 },
  image: { full: 'legacy.png', sprite: 'item0.png', group: 'item' },
};
