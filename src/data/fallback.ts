/**
 * Offline fallback bundle.
 *
 * Deliberately minimal. A damage calculator that shows *wrong* numbers is worse
 * than one that shows none, so this snapshot carries only champion base stats —
 * the values that change least often and that the engine cannot run without.
 *
 * It ships no items and no runes on purpose: those change nearly every patch,
 * and hand-maintained copies would silently rot. When Data Dragon is reachable
 * (the normal case in a browser — Riot sends permissive CORS headers) the app
 * uses the real, complete database instead and this file is never touched.
 */

import type { DDragonChampionSummary, PatchBundle } from './types';

/** Patch these base stats were last checked against. Shown in the UI banner. */
export const OFFLINE_SNAPSHOT_PATCH = '26.16';

const VI: DDragonChampionSummary = {
  id: 'Vi',
  key: '254',
  name: 'Vi',
  title: 'the Piltover Enforcer',
  tags: ['Fighter', 'Assassin'],
  image: { full: 'Vi.png', sprite: 'champion4.png', group: 'champion' },
  stats: {
    hp: 655,
    hpperlevel: 105,
    mp: 295,
    mpperlevel: 65,
    movespeed: 340,
    armor: 30,
    armorperlevel: 4.7,
    spellblock: 32,
    spellblockperlevel: 2.05,
    attackrange: 125,
    hpregen: 9,
    hpregenperlevel: 0.9,
    mpregen: 8,
    mpregenperlevel: 0.65,
    crit: 0,
    critperlevel: 0,
    attackdamage: 63,
    attackdamageperlevel: 3.5,
    attackspeedperlevel: 2,
    attackspeed: 0.644,
  },
};

export const OFFLINE_BUNDLE: PatchBundle = {
  version: OFFLINE_SNAPSHOT_PATCH,
  locale: 'en_US',
  offline: true,
  champions: { Vi: VI },
  items: {},
  runeTrees: [],
  summoners: {},
};
