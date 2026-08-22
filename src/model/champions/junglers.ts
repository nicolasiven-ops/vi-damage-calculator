/**
 * The ten most-played Emerald+ junglers, declared.
 *
 * The list is LoLalytics' own pick rates for patch 16.16, Emerald+, ranked
 * solo/duo, read on 22 August 2026 against 21.5 million games: Graves 13.8%,
 * Lee Sin 13.4%, Nocturne 7.0%, Jarvan IV 6.4%, Sylas 6.4%, Wukong 6.1%, Talon
 * 5.3%, Shyvana 5.2%, Hecarim 4.9%, Briar 4.7%. It is a third party's number and
 * dated on purpose — a meta list is the one thing in this app that is *supposed*
 * to go stale. U.GG agrees on the two it and LoLalytics both grade (Wukong 6.0%,
 * Talon 5.4%), and its own ranking is not directly comparable, so treat the order
 * as approximate and the membership as sound.
 *
 * Every damage number below comes from Riot's own `mSpellCalculations` at run time
 * — see `declared.ts`. Nothing here is a hand-typed value, so nothing here can
 * rot into a plausible wrong answer.
 *
 * The damage **types** are the other half, and they are not in the bin in any form
 * this app reads. They are taken from Riot's own tooltip text, quoted per ability
 * in the comments, because two of them contradicted what I would have written from
 * memory: Briar's Chilling Scream is magic, and Shyvana's Emberstrike is three
 * different types in three different parts of one ability.
 *
 * What is missing is listed per champion. It is a long list, and it should be read
 * before any duel result is believed: an ability that is not here deals nothing,
 * which makes every one of these champions weaker than they are.
 */

import { declaredModule, type ChampionDeclaration } from './declared';
import type { ChampionModule } from './types';

/** No dash, no leap, no reposition — the model has no map for any of it. */
const NO_MOVEMENT = 'Dashes, leaps and repositioning do nothing here: there is no map to move on.';

const DECLARATIONS: ChampionDeclaration[] = [
  {
    championId: 'Graves',
    displayName: 'Graves',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'GravesQLineSpell',
        name: 'End of the Line',
        maxRank: 5,
        spell: 'GravesQLineSpell',
        calc: 'TotalDamage',
        // "dealing {{ totaldamage }} physical damage"
        type: 'physical',
        notes: [
          'The powder round only. The detonation a second later — TotalDetonationDamage, most of the ability — is a second hit that needs the target to still be in the line, so it is not counted.',
        ],
      },
      {
        slot: 'W',
        ddragonId: 'GravesSmokeGrenade',
        name: 'Smoke Screen',
        maxRank: 5,
        spell: 'GravesSmokeGrenade',
        calc: 'ImpactDamage',
        // "The initial impact deals {{ impactdamage }} magic damage"
        type: 'magic',
        notes: ['The impact only. The smoke blinds and slows, neither of which is modelled.'],
      },
      {
        slot: 'R',
        ddragonId: 'GravesChargeShot',
        name: 'Collateral Damage',
        maxRank: 3,
        spell: 'GravesChargeShot',
        calc: 'Damage',
        // "deals {{ damage }} physical damage to the first enemy hit"
        type: 'physical',
        notes: ['The first enemy hit. The cone behind them takes FalloffDamage, which a duel never has a use for.'],
      },
    ],
    gaps: [
      'His attacks are a shotgun: two shells, close-range spread, and a reload. The engine gives him one ordinary attack, which understates him badly.',
      'Quickdraw (E) is his dash and his armour stacking — neither is here.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'LeeSin',
    displayName: 'Lee Sin',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'LeeSinQOne',
        name: 'Sonic Wave',
        maxRank: 5,
        spell: 'LeeSinQOne',
        calc: 'InitialDamage',
        // "dealing {{ initialdamage }} physical damage to the first enemy hit"
        type: 'physical',
        notes: ['The first half. Resonating Strike — the recast that dashes in for RecastDamage, and scales with the target missing health — is not counted.'],
      },
      {
        slot: 'E',
        ddragonId: 'LeeSinEOne',
        name: 'Tempest',
        maxRank: 5,
        spell: 'LeeSinEOne',
        calc: 'InitialDamage',
        // "deals {{ initialdamage }} magic damage"
        type: 'magic',
        notes: ['The shockwave. Cripple, the recast that slows, changes no number here.'],
      },
      {
        slot: 'R',
        ddragonId: 'LeeSinR',
        name: "Dragon's Rage",
        maxRank: 3,
        spell: 'LeeSinR',
        calc: 'Damage',
        // "Knocking Back an enemy champion and dealing {{ damage }} physical damage"
        type: 'physical',
        notes: ['The kick itself. What it knocks the target into is a map thing.'],
      },
    ],
    gaps: [
      'Safeguard (W) is a dash and a shield; only the shield could be modelled, and it is not.',
      'His whole kit is two-part: every ability has a recast, and none of the recasts are here. That is most of a Lee Sin combo.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'Nocturne',
    displayName: 'Nocturne',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'NocturneDuskbringer',
        name: 'Duskbringer',
        maxRank: 5,
        spell: 'NocturneDuskbringer',
        calc: 'TotalDamage',
        // "dealing {{ totaldamage }} physical damage and leaving a dusk trail"
        type: 'physical',
        notes: ['The blade. The trail gives him attack damage and move speed while he stands on it — not modelled.'],
      },
      {
        slot: 'E',
        ddragonId: 'NocturneUnspeakableHorror',
        name: 'Unspeakable Horror',
        maxRank: 5,
        spell: 'NocturneUnspeakableHorror',
        calc: 'TotalDamage',
        // "types: magic" in the tooltip
        type: 'magic',
        notes: ['Counted as one instance on cast. In game it is a tether that pays out over two seconds and fears if it completes.'],
      },
      {
        slot: 'R',
        ddragonId: 'NocturneParanoia',
        name: 'Paranoia',
        maxRank: 3,
        spell: 'NocturneParanoia',
        calc: 'Damage',
        // "launch himself at an enemy champion dealing {{ damage }} physical damage"
        type: 'physical',
        notes: ['The lunge. Darkening the map is the point of the ability and has no meaning in a duel.'],
      },
    ],
    gaps: [
      'Umbra Blades, his passive, is an area attack every few seconds that heals him. Not modelled.',
      'Shroud of Darkness (W) blocks an ability outright and doubles his attack speed when it lands. Not modelled — and against Vi it would eat a Q.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'JarvanIV',
    displayName: 'Jarvan IV',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'JarvanIVDragonStrike',
        name: 'Dragon Strike',
        maxRank: 5,
        spell: 'JarvanIVDragonStrike',
        calc: 'TotalDamage',
        type: 'physical',
        notes: ['Reduces the target armour as well, which is not applied here.'],
      },
      {
        slot: 'E',
        ddragonId: 'JarvanIVDemacianStandard',
        name: 'Demacian Standard',
        maxRank: 5,
        spell: 'JarvanIVDemacianStandard',
        calc: 'TotalDamage',
        type: 'magic',
        notes: ['The flag lands and hurts. The attack speed and armour it grants him are not modelled, and neither is the Q-flag knock-up.'],
      },
      {
        slot: 'R',
        ddragonId: 'JarvanIVCataclysm',
        name: 'Cataclysm',
        maxRank: 3,
        spell: 'JarvanIVCataclysm',
        calc: 'DamageCalc',
        type: 'physical',
        notes: ['The leap damage. The arena it builds is exactly the thing a model without a map cannot have.'],
      },
    ],
    gaps: [
      'Martial Cadence, his passive, hits for a share of the target current health on his first attack against them. Not modelled.',
      'Golden Aegis (W) is a shield and a slow. Not modelled.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'Sylas',
    displayName: 'Sylas',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'SylasQ',
        name: 'Chain Lash',
        maxRank: 5,
        spell: 'SylasQ',
        calc: 'Damage',
        type: 'magic',
        notes: ['The lash. ExplosionDamage — the second, larger hit after a delay — is not counted.'],
      },
      {
        slot: 'W',
        ddragonId: 'SylasW',
        name: 'Kingslayer',
        maxRank: 5,
        spell: 'SylasW',
        calc: 'MinDamage',
        type: 'magic',
        notes: ['The floor of it: the damage rises as the target health falls, and the healing it gives him is not modelled.'],
      },
      {
        slot: 'E',
        ddragonId: 'SylasE',
        name: 'Abduct',
        maxRank: 5,
        spell: 'SylasE',
        calc: 'Damage',
        type: 'magic',
        notes: ['The second half of a dash-and-pull, counted without either movement.'],
      },
    ],
    gaps: [
      'Hijack (R) steals the enemy ultimate and casts it. Against Vi that is Vi ultimate, and modelling it means modelling every ultimate in the game — so his R does nothing here, which is a large hole in exactly the champion whose whole identity it is.',
      'Petricite Burst, his passive, is an area hit after every ability. Not modelled.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'MonkeyKing',
    displayName: 'Wukong',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'MonkeyKingDoubleAttack',
        name: 'Crushing Blow',
        maxRank: 5,
        spell: 'MonkeyKingDoubleAttack',
        calc: 'TotalDamage',
        type: 'physical',
        notes: ['Reduces the target armour as well, which is not applied here.'],
      },
      {
        slot: 'E',
        ddragonId: 'MonkeyKingNimbus',
        name: 'Nimbus Strike',
        maxRank: 5,
        spell: 'MonkeyKingNimbus',
        calc: 'TotalDamage',
        type: 'magic',
        notes: ['The dash hit. The attack speed it grants afterwards is not modelled.'],
      },
      {
        slot: 'R',
        ddragonId: 'MonkeyKingSpinToWin',
        name: 'Cyclone',
        maxRank: 3,
        spell: 'MonkeyKingSpinToWin',
        calc: 'TotalDamageTT',
        // "take {{ totaldamagett }} plus {{ percenthpdamagett }} max Health physical damage over {{ spinduration }} seconds"
        type: 'physical',
        castSeconds: 0.5,
        notes: [
          'The whole spin, counted as one hit at the moment of the cast rather than spread over its four seconds — which makes it land earlier than it should.',
          'The max-health share of it is not included, and neither is the knock-up.',
        ],
      },
    ],
    gaps: [
      'Warrior Trickster (W) leaves a clone and makes him invisible. Nothing about it is modelled, and in a real duel it is often the reason he wins the trade.',
      'Stone Skin, his passive, gives him armour and health per nearby enemy. Not modelled.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'Talon',
    displayName: 'Talon',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'TalonQ',
        name: 'Noxian Diplomacy',
        maxRank: 5,
        spell: 'TalonQ',
        calc: 'CriticalDamage',
        /*
         * "If used in melee range, this Ability instead critically strikes for
         * {{ criticaldamage }} physical damage" — and in this model both sides are
         * always in melee range, because nobody moves. So the melee branch is the
         * honest one here, not the leap.
         */
        type: 'physical',
        notes: ['The melee branch, which is the only one a model without distance can be in.'],
      },
      {
        slot: 'W',
        ddragonId: 'TalonW',
        name: 'Rake',
        maxRank: 5,
        spell: 'TalonW',
        calc: 'TotalInitialDamage',
        type: 'physical',
        notes: ['The blades going out. TotalReturnDamage — them coming back, which is most of the ability — is not counted.'],
      },
      {
        slot: 'R',
        ddragonId: 'TalonR',
        name: 'Shadow Assault',
        maxRank: 3,
        spell: 'TalonR',
        calc: 'Damage',
        type: 'physical',
        notes: ['One pass of the blades. The ability sends them out and back, and hides him in between.'],
      },
    ],
    gaps: [
      'Blade Waltz, his passive, bleeds the target after three hits — a large share of his damage. Not modelled.',
      'Assassin Path (E) is pure movement.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'Shyvana',
    displayName: 'Shyvana',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'ShyvanaQ',
        name: 'Emberstrike',
        maxRank: 5,
        spell: 'ShyvanaQ',
        calc: 'Calc_Damage',
        /*
         * Three types in one ability, which is why the tooltip was worth reading:
         * "Active: … dealing {{ calc_damage }} physical damage", while the passive
         * on-hit is "max Health magic damage" and the dragon-form bite is "true
         * damage". Only the active is declared.
         */
        type: 'physical',
        notes: [
          'The active strike only. Her attacks also carry a max-health magic hit from this ability passive, which is not modelled.',
          'Dragon Form adds a third cast that bites for true damage. Not modelled.',
        ],
      },
      {
        slot: 'W',
        ddragonId: 'ShyvanaW',
        name: 'Inferno Aegis',
        maxRank: 5,
        spell: 'ShyvanaW',
        calc: 'Damage',
        type: 'magic',
        notes: ['Counted as one hit. In game it burns everything around her for the duration, and shields her.'],
      },
      {
        slot: 'E',
        ddragonId: 'ShyvanaE',
        name: 'Molten Burst',
        maxRank: 5,
        spell: 'ShyvanaE',
        calc: 'Damage',
        type: 'magic',
        notes: ['The fireball. The max-health share and the slow are not included.'],
      },
      {
        slot: 'R',
        ddragonId: 'ShyvanaR',
        name: "Dragon's Descent",
        maxRank: 3,
        spell: 'ShyvanaR',
        calc: 'Damage',
        type: 'magic',
        notes: ['The flight damage. What matters more is that it turns her into a dragon and changes her whole kit, which is not modelled at all.'],
      },
    ],
    gaps: [
      'Dragon Fury and Dragon Form: her ultimate rewrites her abilities. Everything above is the human form.',
      'Fury of the Dragonborn, her passive, gives her armour and magic resistance. Not modelled.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'Hecarim',
    displayName: 'Hecarim',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'HecarimRapidSlash',
        name: 'Rampage',
        maxRank: 5,
        spell: 'HecarimRapidSlash',
        calc: 'Damage',
        type: 'physical',
        notes: ['The base hit. Repeated casts ramp it up (RampageBonusDamagePerc), which is not applied.'],
      },
      {
        slot: 'W',
        ddragonId: 'HecarimW',
        name: 'Spirit of Dread',
        maxRank: 5,
        spell: 'HecarimW',
        calc: 'TotalDamage',
        type: 'magic',
        notes: ['Counted as one hit on cast. In game it is an aura for four seconds that also heals him from the damage dealt inside it.'],
      },
      {
        slot: 'E',
        ddragonId: 'HecarimRamp',
        name: 'Devastating Charge',
        maxRank: 5,
        spell: 'HecarimRamp',
        calc: 'MinDamage',
        /*
         * "deals between {{ mindamage }} and {{ maxdamage }} physical damage …
         * damage scales with distance travelled" — and nothing travels here, so the
         * minimum is the only end of that range this model can honestly claim.
         */
        type: 'physical',
        notes: ['The minimum, because the damage scales with distance travelled and nothing travels here.'],
      },
      {
        slot: 'R',
        ddragonId: 'HecarimUlt',
        name: 'Onslaught of Shadows',
        maxRank: 3,
        spell: 'HecarimUlt',
        calc: 'DamageDone',
        type: 'magic',
        notes: ['The charge damage. The fear it leaves behind is not modelled.'],
      },
    ],
    gaps: [
      'Warpath, his passive, turns his move speed into attack damage — so a Hecarim standing still is a weak Hecarim, and here he always stands still.',
      NO_MOVEMENT,
    ],
  },

  {
    championId: 'Briar',
    displayName: 'Briar',
    abilities: [
      {
        slot: 'Q',
        ddragonId: 'BriarQ',
        name: 'Head Rush',
        maxRank: 5,
        spell: 'BriarQ',
        calc: 'TotalDamage',
        type: 'physical',
        notes: ['The lunge hit. It also reduces armour and empowers her next attacks, neither of which is modelled.'],
      },
      {
        slot: 'E',
        ddragonId: 'BriarE',
        name: 'Chilling Scream',
        maxRank: 5,
        spell: 'BriarE',
        calc: 'Damage',
        // "deals … magic damage" — not physical, which is what I would have guessed.
        type: 'magic',
        notes: ['The scream. Charging it up and slamming the target into a wall (WallHitDamage) needs distance, so neither is counted.'],
      },
      {
        slot: 'R',
        ddragonId: 'BriarR',
        name: 'Certain Death',
        maxRank: 3,
        spell: 'BriarR',
        calc: 'Damage',
        type: 'magic',
        castSeconds: 0.5,
        notes: ['The landing. The fear, the resistances it strips and the chase are not modelled.'],
      },
    ],
    gaps: [
      'Blood Frenzy (W) is most of her damage: a self-taunt that makes her attack automatically, an area hit on every attack, and a recast that empowers one attack for a share of missing health. None of it fits a declaration, so none of it is here.',
      'Crimson Curse, her passive, bleeds everything she hits and heals her from it. Not modelled.',
      NO_MOVEMENT,
    ],
  },
];

/** The declared junglers, by Data Dragon champion id. */
export const JUNGLER_MODULES: Record<string, ChampionModule> = Object.fromEntries(
  DECLARATIONS.map((declaration) => [declaration.championId, declaredModule(declaration)]),
);

export { DECLARATIONS as JUNGLER_DECLARATIONS };
