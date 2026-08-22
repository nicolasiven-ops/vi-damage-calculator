/**
 * Items whose stat line is a function of the build they are in.
 *
 * Sterak's Gage grants attack damage equal to half your base attack damage.
 * Manamune grants it per point of mana. Rabadon's multiplies the ability power
 * you already have. None of these are procs and none of them fit a fixed stat
 * block, so before `ItemEffect.derivedStats` existed they were unmodellable in
 * the most annoying way possible: the number was known and there was nowhere to
 * put it.
 *
 * Every figure comes from the item's own bin (`Items/<id>` in CommunityDragon's
 * `items.cdtb.bin.json`, patch 16.16.1), because Data Dragon leaves the values out
 * of the passive text. Riot's `mStatFormula` says which pool a formula reads:
 * 1 is the base value, 2 is the bonus. That distinction is the whole difference
 * between Sterak's (half of *base* attack damage) and Overlord's (2.5 % of
 * *bonus* health), and getting it backwards would be a plausible-looking lie.
 */

import type { ItemEffect, ItemStatContext } from '../itemEffects';
import type { StatBlock } from '../stats';

export const DERIVED_CONSTANTS = {
  /** Sterak's Gage — The Claws that Catch. Items/3053 ADtoAD, mStatFormula 1. */
  steraks: { id: '3053', baseAdRatio: 0.5 },
  /** Manamune — Awe. Items/3004 BonusADFromMana. */
  manamune: { id: '3004', manaToAd: 0.02 },
  /** Archangel's Staff — Awe. Items/3003 APFromMana. */
  archangels: { id: '3003', manaToAp: 0.01 },
  /** Winter's Approach — Awe. Items/3119 BonusHPFromMana, mStatFormula 2. */
  wintersApproach: { id: '3119', bonusManaToHealth: 0.15 },
  /** Endless Hunger — Famine. Items/2517, melee coefficient on bonus AD. */
  endlessHunger: { id: '2517', flatHaste: 5, bonusAdToHaste: 0.13 },
  /** Swiftmarch — Noxian Fervor. Items/3170 MSAdaptiveRatio. */
  swiftmarch: { id: '3170', moveSpeedToAdaptive: 0.05 },
  /** Rabadon's Deathcap — Magical Opus. Items/3089 APAmp. */
  rabadons: { id: '3089', abilityPowerAmp: 0.3 },
  /** Overlord's Bloodmail — Tyranny. Items/2501 HPToADPercentage, formula 2. */
  overlords: { id: '2501', bonusHealthToAd: 0.025 },
  /**
   * One point of Adaptive Force in attack damage.
   *
   * Riot's conversion is 0.6 attack damage or 1 ability power; the same
   * assumption the description parser makes, and for the same reason — this
   * calculator models a champion whose kit is entirely physical.
   */
  adaptiveToAttackDamage: 0.6,
} as const;

function derived(
  id: string,
  name: string,
  note: string,
  stats: (ctx: ItemStatContext) => Partial<StatBlock>,
): ItemEffect {
  return { id, name, modelled: true, note, derivedStats: stats };
}

export const DERIVED_ITEMS: ItemEffect[] = [
  derived(
    DERIVED_CONSTANTS.steraks.id,
    "Sterak's Gage",
    'The Claws that Catch: bonus attack damage equal to 50% of base attack damage. Lifeline is a shield below 30% health, which needs the attacker\'s own health.',
    ({ baseline }) => ({
      attackDamage: baseline.baseAttackDamage * DERIVED_CONSTANTS.steraks.baseAdRatio,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.manamune.id,
    'Manamune',
    'Awe: bonus attack damage equal to 2% of maximum mana. Manaflow charges toward the Muramana transformation, which is its own item.',
    ({ baseline }) => ({
      attackDamage: baseline.maxMana * DERIVED_CONSTANTS.manamune.manaToAd,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.archangels.id,
    "Archangel's Staff",
    "Awe: ability power equal to 1% of bonus mana. Riot's text says bonus rather than total, which is the smaller of the two and the one quoted here.",
    ({ baseline }) => ({
      abilityPower: baseline.bonusMana * DERIVED_CONSTANTS.archangels.manaToAp,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.wintersApproach.id,
    "Winter's Approach",
    'Awe: health equal to 15% of bonus mana. It changes no damage number for an attacker, but the health is real and other items read it.',
    ({ baseline }) => ({
      hp: baseline.bonusMana * DERIVED_CONSTANTS.wintersApproach.bonusManaToHealth,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.endlessHunger.id,
    'Endless Hunger',
    'Famine: 5 ability haste plus 13% of bonus attack damage (the melee value). Feast grants omnivamp on a takedown, which a single-target combo never reaches.',
    ({ baseline }) => ({
      abilityHaste:
        DERIVED_CONSTANTS.endlessHunger.flatHaste +
        baseline.bonusAttackDamage * DERIVED_CONSTANTS.endlessHunger.bonusAdToHaste,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.swiftmarch.id,
    'Swiftmarch',
    'Noxian Fervor: 5% of movement speed as Adaptive Force, counted as attack damage at Riot\'s 0.6 conversion.',
    ({ baseline }) => ({
      attackDamage:
        baseline.moveSpeed *
        DERIVED_CONSTANTS.swiftmarch.moveSpeedToAdaptive *
        DERIVED_CONSTANTS.adaptiveToAttackDamage,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.rabadons.id,
    "Rabadon's Deathcap",
    'Magical Opus: 30% more ability power. Read off the build resolved before it, so it does not compound with an ability power another item derives in the same pass.',
    ({ baseline }) => ({
      abilityPower: baseline.abilityPower * DERIVED_CONSTANTS.rabadons.abilityPowerAmp,
    }),
  ),

  derived(
    DERIVED_CONSTANTS.overlords.id,
    "Overlord's Bloodmail",
    'Tyranny: bonus attack damage equal to 2.5% of bonus health. Retribution ramps to +12% attack damage below 70% health, which needs the attacker\'s own current health.',
    ({ baseline }) => ({
      attackDamage: baseline.bonusHealth * DERIVED_CONSTANTS.overlords.bonusHealthToAd,
    }),
  ),
];
