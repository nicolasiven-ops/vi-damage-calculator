/**
 * The crit family: critical-strike modifiers and the Zeal / Energized line.
 *
 * Sourcing rule for this file. Every number below is Riot's own, taken from one
 * of two places: the resolved `<stats>` and passive text in Data Dragon's
 * `item.json` for patch 16.16.1, or the `mDataValues` and `mItemCalculations`
 * blocks of CommunityDragon's `items.cdtb.bin.json`, which is the game's own
 * item bin and therefore the same data the client renders its tooltips from.
 * Riot ships several of these passives with the number stripped out of the
 * tooltip — Stormrazor's reads "applies <magicDamage> bonus magic damage" with
 * nothing between the tags — and the bin is where the value actually lives.
 * Where a number exists in neither, the wiki is quoted verbatim in a comment and
 * marked as wiki-sourced.
 *
 * Vi is melee. Every effect with split melee/ranged values therefore uses the
 * melee value, and the comment says which one that is.
 *
 * Three item ids in circulation for this family are stale, and looking them up
 * rather than trusting them is why the entries below are keyed the way they are:
 * Yun Tal Wildarrows is **3032** (6673 is Immortal Shieldbow), Stormrazor is
 * **3097** (3095 is a shell Riot renamed "Deprecated item" and disabled on every
 * map), and 6675 is **Navori Flickerblade**, the item that replaced Navori
 * Quickblades.
 *
 * What this family contains that is deliberately *not* here, each for a reason
 * that is part of the answer rather than an omission:
 *
 *  - **Infinity Edge (3031)** has no passive at all this patch. Its whole text
 *    is a `<stats>` block — 75 attack damage, 25% critical strike chance, 30%
 *    critical strike damage — and `parseItemDescription` in `items.ts` maps
 *    "Critical Strike Damage" onto `critDamage` already. An entry here would
 *    grant that 30% a second time. The bin has no data values for 3031 at all.
 *  - **Opportunity (6701)** is off the shelf. Data Dragon 16.16.1 ships it with
 *    `"inStore": false` and `"gold": {"purchasable": false}`, and its bin entry
 *    has no `mItemDataAvailability` block at all — the same signature as the
 *    removed Prowler's Claw (6693), while every live item in this family carries
 *    `"mItemDataAvailability":{"mInStore":true}`. `scripts/gen-items.mjs` filters
 *    on exactly those Data Dragon flags, which is why 6701 is absent from
 *    `test/fixtures/srItems.ts` too. Its Preparation lethality (bin
 *    `BonusLethalityCalc` = a flat 11, `RangedLethalityMultiplier` 0.455) was
 *    modelled here until this review; a passive on an item nobody can buy is the
 *    same mistake this file already refuses to make for 3095, so it is gone. The
 *    live counterpart is the Arena-only **226701**, which is *not* a clone —
 *    `LethalityProcAmount` 20, `RangedLethalityMultiplier` 1, `CombatTimer` 3 —
 *    and it is modelled below under its own id.
 *  - **Navori Flickerblade (6675)**: "Attacks reduce Basic Ability cooldowns by
 *    15% of their remaining cooldown" (Data Dragon, verbatim — Riot resolves this
 *    line in full, and the bin's `CDRAmount` is 0.15 to match). `SimContext` has
 *    no way to touch a remaining cooldown — it offers damage, shred, shields,
 *    stats, amplification and crowd control — and ability haste is not the same
 *    mechanic (it scales a cooldown's length, not its remainder), so nothing here
 *    can stand in for it.
 *  - **Profane Hydra (6698)**: Cleave is "Attacks deal physical damage to nearby
 *    enemies" (Data Dragon, verbatim) with a `CleaveRadius` of 350 in the bin —
 *    the target's neighbours, not the target, so it adds nothing against a single
 *    target. That is the same reason Titanic Hydra is modelled by its on-hit
 *    alone. The active would matter: "Deal physical damage around you" (Data
 *    Dragon, verbatim), which the bin prices at 80% of an attack-damage stat
 *    (`SlashDamageBase`, and `SlashDamageMax` is the same 0.8, so there is no
 *    low-health scaling this patch) on a 10 s `Cooldown` in a 450 `ActiveRadius`
 *    centred on the caster. But the engine answers an `item` combo step with
 *    "Item actives are not modelled yet — step skipped", and `ItemRuntime` has no
 *    activation hook.
 *  - **Runaan's Hurricane (3085)**: the bolts (the bin's `BoltDamage`, 0.65 of
 *    an attack-damage stat) fly at two *additional* enemies near the target and
 *    never at the target itself.
 *  - **Phantom Dancer (3046)** buys attack speed, crit chance and ghosting.
 *    Spectral Waltz is "Become Ghosted" and nothing else, and the bin has no
 *    `mDataValues` and no `mItemCalculations` for 3046 at all.
 *  - **Youmuu's Ghostblade (3142)** buys movement speed and ghosting. The only
 *    stat value in its bin is `LethalityAmount` 18, which Data Dragon already
 *    ships as the "18 Lethality" stat line that `parseItemDescription` reads —
 *    declaring it here would double it. Everything else on 3142 is a speed, a
 *    radius or a duration (`OOCMSndv` 20, `BaseOOCMS` 20, `DurationNDV` 6,
 *    `Cooldown` 45, `CombatTimer` 3, and the `MeleeItemCalcValueB` 20 /
 *    `RangedItemCalcValueB` 15 pair the `OOCMS` calculation reads).
 *  - **Hexoptics C44 (2523)**: both passives need positions the simulation does
 *    not have. Magnification is "Deal up to 10% increased damage with Attacks,
 *    based on how far away the enemy is (max damage at 500 range)" (Data Dragon,
 *    verbatim; bin `MaxDamageAmp` 0.1 at `MaxRange` 500) — an amplifier keyed on
 *    the distance to the target, and `SimContext` exposes no position and no
 *    distance, so there is no defensible single value between 0% and 10% to pick.
 *    Arcane Aim's 100 `ExtraRange` pays out after a takedown (bin
 *    `TakedownWindow` 3, `Duration` 8), which is where the simulation stops.
 *
 * Last reviewed against patch 16.16 (Data Dragon 16.16.1, item bin of
 * 2026-08-16).
 *
 * `AmplifiableHit` is deliberately not imported: nothing in this family scales
 * another source's damage, so an import of it would not compile under
 * `noUnusedLocals`.
 */

import type { ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';

/**
 * Yun Tal's two Riot values, pulled out so the stack ceiling can be derived from
 * them instead of copied from a third place. `CritPerStackMelee` is 0.4 and
 * `CritMax` is 25 in the bin, both as whole percent; this codebase stores every
 * percentage as a fraction.
 */
const YUN_TAL_CRIT_PER_ATTACK_MELEE = 0.004;
const YUN_TAL_CRIT_CAP = 0.25;

/**
 * Every number this module acts on, in one place.
 *
 * The tests do *not* read these constants in place of Riot's numbers: a test
 * that compares the runtime's output against the same constant the runtime read
 * proves the plumbing and nothing about the value. `items.crit.test.ts` restates
 * every literal below with its source and then asserts the behaviour against the
 * literal, so a constant edited here fails a test instead of quietly changing an
 * answer.
 */
export const CRIT_CONSTANTS = {
  /**
   * The shared Energized mechanic, used by Rapid Firecannon, Statikk Shiv and
   * Stormrazor.
   *
   * Riot's own text says only "Moving and Attacking generates an Energized
   * Attack" and stops there. The stack ceiling and the rates are in neither Data
   * Dragon nor the item bin, because they belong to the buff script rather than
   * to the item, so all three are wiki-sourced. The wiki's passive line reads,
   * verbatim, "Unique – Energized: Moving and basic attacking generates Energize
   * stacks, up to 100", and its notes state that each basic attack generates 6
   * stacks and that movement generates 1 stack per 24 units travelled.
   *
   * `perDistanceUnit` is recorded but never read: the simulation has no notion of
   * position, so no movement can be counted. It is here because it is the reason
   * the charge assumption below is what it is.
   */
  energize: {
    max: 100,
    perBasicAttack: 6,
    perDistanceUnit: 1 / 24,
  },
  /** Riot's `BonusDamage` data value on item 3094, and its resolved tooltip. */
  rapidFirecannon: { bonusDamage: 40 },
  /** Riot's `mItemCalculations.TotalProcDamage` on item 3097. */
  stormrazor: { bonusDamage: 100 },
  /**
   * Riot's `ChainDamage`, `NonChampChainDamage` and `BonusEnergizedStacks`
   * data values on item 3087.
   */
  statikkShiv: { championDamage: 60, nonChampionDamage: 90, bonusStacksPerAttack: 9 },
  /** Riot's `ExecuteThreshold` data value on item 6676. */
  theCollector: { executeThreshold: 0.05 },
  /**
   * Riot's data values on item 2512 Fiendhunter Bolts: `NumberOfAttacks` 3,
   * `Duration` 8, `Cooldown` 45, `BonusAS` 0.5, `CritModifier` 0.8,
   * `BonusTrueDamage` 0.15, `UltimateHaste` 30.
   *
   * The last two are recorded and not applied; `note` on the entry says so and
   * the reasons are with the entry.
   */
  fiendhunterBolts: {
    attacks: 3,
    durationSeconds: 8,
    cooldownSeconds: 45,
    bonusAttackSpeed: 0.5,
    critModifier: 0.8,
    bonusTrueDamage: 0.15,
    ultimateAbilityHaste: 30,
  },
  /**
   * Riot's data values on item 3032: `CritPerStackMelee` 0.4 (percent per stack,
   * melee — `StackRangedMultiplier` halves it for ranged), `CritMax` 25,
   * `ASMod` 0.3, `ASDuration` 6, `Cooldown` 30, `AACDR` 1, `CritCDR` 2.
   *
   * `maxStacksMelee` is arithmetic, not a fourth source: 25 / 0.4 is 62.5, so
   * the 63rd stack is the last one that changes anything. The wiki's "stacking up
   * to (Melee 63 / Ranged 125) times (capped at 25% critical strike chance)" is
   * that same division, which is why it is quoted as a cross-check rather than
   * used as the number.
   */
  yunTal: {
    critPerAttackMelee: YUN_TAL_CRIT_PER_ATTACK_MELEE,
    critCap: YUN_TAL_CRIT_CAP,
    maxStacksMelee: Math.ceil(YUN_TAL_CRIT_CAP / YUN_TAL_CRIT_PER_ATTACK_MELEE),
    flurryAttackSpeed: 0.3,
    flurryDurationSeconds: 6,
    flurryCooldownSeconds: 30,
    flurryCooldownPerAttackSeconds: 1,
  },
  /**
   * The Arena Opportunity, item 226701, which is a different item from the
   * retired Rift 6701 rather than a clone of it.
   *
   * `preparationLethality` is 20. Riot leaves the amount out of the tooltip and
   * routes `mItemCalculations.BonusLethalityCalc` through a data value whose name
   * CommunityDragon cannot un-hash (`{620cd6b5}`). It can only be this item's own
   * `LethalityProcAmount` 20: a `NamedDataValueCalculationPart` reads a data
   * value of the same item, that hash appears nowhere else in the whole bin, and
   * every other name on 226701 is already accounted for — `LethalityAmount` 15 is
   * the Data Dragon stat line, `SpeedBaseline`/`SpeedKill`/`MSDuration` are
   * Extraction, `CombatTimer` 3 and `DamageWindowDuration` 3 are Preparation's
   * two timers, and `RangedLethalityMultiplier` is 1. That is an inference, and
   * it is the only number in this file that is one.
   */
  opportunityArena: {
    preparationLethality: 20,
    outOfCombatSeconds: 3,
    heldAfterDamageSeconds: 3,
  },
} as const;

/**
 * How a permanent buff is spelled with a hook that wants a duration.
 *
 * `applyTemporaryStats` is the only way an item can change Vi's stats mid-run,
 * and it takes seconds. The engine stops simulating at 120 s, so a buff applied
 * for that long cannot expire inside a run, which is exactly what "permanently"
 * needs to mean here. The engine's own `MAX_SIMULATED_SECONDS` is private to
 * `simulate.ts`, so the number is restated rather than imported; if the horizon
 * ever grows, this becomes a buff that expires late in a very long combo rather
 * than something that breaks.
 */
const SIMULATION_HORIZON_SECONDS = 120;

/* ---------------------------------------------------------------- energized */

interface EnergizedSpec {
  id: string;
  name: string;
  /** Riot's name for the passive that spends the charge. */
  passive: string;
  /** Energize stacks one basic attack generates for this item. */
  stacksPerAttack: number;
  /** The bonus damage of the Energized attack, which may depend on the target. */
  damage(ctx: SimContext): number;
  /** What the number was made of, for the timeline. */
  notes(ctx: SimContext): string[];
  note: string;
}

/**
 * An Energized item: a charge counter, and one empowered attack when it fills.
 *
 * The charge assumption, stated once for all three items. Energize is fed by
 * movement and by attacking, and the simulation models neither position nor
 * movement — it only knows about attacks. Two consequences:
 *
 *  - The counter starts *full*. 100 stacks is 2,400 units of travel at 1 stack
 *    per 24 units, which is less than the walk from a lane's turret to the
 *    river; anyone who arrives at a fight on foot arrives Energized. Starting
 *    empty would model a player teleported into range, and would silently
 *    delete the proc from every burst combo. This also matches how Voltaic
 *    Cyclosword is already modelled in `itemEffects.ts`, where the Firmament
 *    hit is counted once per combo.
 *  - After the proc, only attacks recharge it, at `stacksPerAttack` each. The
 *    re-proc this produces is therefore the slowest one possible: a player who
 *    moves at all between attacks gets the second Energized attack sooner, so
 *    the modelled damage is a floor rather than an estimate.
 *
 * This is *not* a general convention that every pre-fight accumulation starts
 * full, and Yun Tal's Practice Makes Lethal below is the deliberate exception,
 * so the two entries are read together rather than as a contradiction. What
 * separates them is whether the fight itself can produce the state: an Energize
 * charge is spent and re-earned inside the combo — the counter refills in 17
 * attacks, so the model has to take a position on where it starts and any answer
 * is visible in the same run — while Yun Tal's stacks are earned over a whole
 * game before the fight and never inside it, and the simulation has no input for
 * how much of that game has happened. Where a state can be recovered in-combo it
 * is assumed to be there; where it can only be inherited from a game the model
 * cannot see, it is counted from zero and the entry's `note` says which way that
 * errs. Both directions are floors, which is the property that matters: neither
 * entry can report damage a player will not get.
 *
 * Whether Riot credits the consuming attack with its own stacks before or after
 * it spends them is not stated in either source, so the attack that spends the
 * charge is not credited. At 6 stacks per attack the choice moves the next proc
 * by a single attack.
 */
function energized(spec: EnergizedSpec): ItemEffect {
  return {
    id: spec.id,
    name: spec.name,
    modelled: true,
    note: spec.note,
    createRuntime(): ItemRuntime {
      // Annotated, because `CRIT_CONSTANTS` is `as const` and would otherwise
      // narrow the counter to the literal type of its own starting value.
      let stacks: number = CRIT_CONSTANTS.energize.max;
      return {
        onBasicAttack(ctx): ItemAttackRider | null {
          if (stacks < CRIT_CONSTANTS.energize.max) {
            stacks = Math.min(CRIT_CONSTANTS.energize.max, stacks + spec.stacksPerAttack);
            return null;
          }
          stacks = 0;
          return {
            amount: spec.damage(ctx),
            type: 'magic',
            label: `${spec.name} · ${spec.passive}`,
            notes: spec.notes(ctx),
          };
        },
      };
    },
  };
}

const RAPID_FIRECANNON = energized({
  id: '3094',
  name: 'Rapid Firecannon',
  passive: 'Sharpshooter',
  stacksPerAttack: CRIT_CONSTANTS.energize.perBasicAttack,
  damage: () => CRIT_CONSTANTS.rapidFirecannon.bonusDamage,
  notes: () => [`${CRIT_CONSTANTS.rapidFirecannon.bonusDamage} flat magic damage`],
  /*
   * "Your Energized Attack deals 40 bonus magic damage and gains 35% bonus
   * Attack Range" — Riot's own resolved text, with `BonusDamage` 40 in the bin
   * to match. The bonus range is real and does nothing here: the simulation has
   * no notion of distance, so nothing can be out of range in the first place.
   */
  note: 'Sharpshooter: the Energized attack deals 40 bonus magic damage. The bonus attack range has no effect in a model without positions.',
});

const STORMRAZOR = energized({
  id: '3097',
  name: 'Stormrazor',
  passive: 'Bolt',
  stacksPerAttack: CRIT_CONSTANTS.energize.perBasicAttack,
  damage: () => CRIT_CONSTANTS.stormrazor.bonusDamage,
  notes: () => [`${CRIT_CONSTANTS.stormrazor.bonusDamage} flat magic damage`],
  /*
   * Riot's tooltip for 3097 has the number stripped out — "applies
   * <magicDamage> bonus magic damage</magicDamage>" — so the 100 comes from the
   * item bin's `mItemCalculations.TotalProcDamage`.
   *
   * The 45% movement speed for 1.5 s (`BuffStrength`, `BuffDuration`) is not
   * modelled: movement changes no damage number here.
   */
  note: 'Bolt: the Energized attack deals 100 bonus magic damage. The movement speed it grants changes no damage in this model.',
});

const STATIKK_SHIV = energized({
  id: '3087',
  name: 'Statikk Shiv',
  passive: 'Electrospark',
  /*
   * Electroshock is the reason Statikk Shiv re-procs so much faster than the
   * other two: Riot's `BonusEnergizedStacks` is 9, which on top of the 6 an
   * attack generates anyway makes 15 per attack, so the counter refills in 7
   * attacks instead of 17.
   */
  stacksPerAttack:
    CRIT_CONSTANTS.energize.perBasicAttack + CRIT_CONSTANTS.statikkShiv.bonusStacksPerAttack,
  /*
   * The chain lightning bounces to further targets, and only the bounces are
   * off-target — the attack's own target takes the first link. Riot's
   * `ChainDamage` (60) and `NonChampChainDamage` (90) are the numbers; the
   * bounces are worth nothing in a single-target model, so only the first link
   * is counted.
   */
  damage: (ctx) =>
    ctx.target.unitType === 'champion'
      ? CRIT_CONSTANTS.statikkShiv.championDamage
      : CRIT_CONSTANTS.statikkShiv.nonChampionDamage,
  notes: (ctx) => [
    ctx.target.unitType === 'champion'
      ? `${CRIT_CONSTANTS.statikkShiv.championDamage} against a champion`
      : `${CRIT_CONSTANTS.statikkShiv.nonChampionDamage} against a non-champion`,
    'the chain bounces are worth nothing against a single target',
  ],
  note: "Electrospark: the Energized attack deals 60 bonus magic damage (90 to non-champions) to the target. Electroshock's 9 extra stacks per attack are counted, so it re-charges in 7 attacks rather than 17.",
});

/* ------------------------------------------------------------------ execute */

/**
 * The Collector.
 *
 * "Your damage executes champions that are below 5% Health" — Riot's resolved
 * text, with `ExecuteThreshold` 0.05 in the item bin to match. Modelled as what
 * it is: once a hit leaves a champion under the line, the rest of its health is
 * taken as true damage, which is the only damage type that describes a kill
 * that ignores what the target is wearing.
 *
 * A factory rather than one object, because the execute deals damage and damage
 * carries the id it was bought under. Arena's 226676 is the same passive
 * (`ExecuteThreshold` 0.05 in its own bin entry) but it is a different purchase,
 * and a spread copy of a runtime that hardcoded `item:6676` would have reported
 * the Arena item's execute under the Rift item's id in the timeline and the
 * damage inspector — the one place in the engine where item damage is not keyed
 * by the id it was bought under. `simulate.ts` builds every basic-attack rider
 * as `item:${id}` from the equipped id; this does the same.
 *
 * Two things this cannot see, both because of how the engine routes procs.
 * `onHitLanded` is not called for damage whose source is an item or a rune, so
 * an execute cannot be triggered by another item's proc — only by an attack, an
 * ability or a summoner. And the engine still applies the target's flat and
 * percent damage reduction to true damage, so on a target that has any, the
 * execute lands short of the kill; that is reported as a warning rather than
 * papered over by inflating the number, because inventing damage to force the
 * arithmetic to agree is the one thing a calculator must not do.
 *
 * The lethality is a stat line Data Dragon already lists (10 on 6676, 12 on
 * 226676), so it is not repeated here — `stats` on an `ItemEffect` is added on
 * top of the parsed stat block, and declaring it would double it.
 */
function theCollector(id: string): ItemEffect {
  return {
    id,
    name: 'The Collector',
    modelled: true,
    note: 'Death: your damage executes a champion left below 5% health, taking the remainder as true damage.',
    createRuntime(): ItemRuntime {
      let warned = false;
      return {
        onHitLanded(ctx, hit) {
          if (ctx.target.unitType !== 'champion') return;
          if (hit.mitigated <= 0) return;
          const remaining = ctx.targetCurrentHealth;
          // Nothing to execute: either still healthy, or already dead.
          if (remaining <= 0) return;
          if (hit.targetHealthPercentAfter >= CRIT_CONSTANTS.theCollector.executeThreshold) return;

          const shielded =
            ctx.target.percentDamageReduction > 0 || ctx.target.flatDamageReduction > 0;
          if (shielded && !warned) {
            warned = true;
            ctx.warn(
              "The Collector's execute is dealt as true damage, which this target's damage reduction still applies to — in game the execute is a kill regardless.",
            );
          }

          ctx.dealDamage({
            sourceId: `item:${id}`,
            sourceLabel: 'The Collector · Death',
            sourceKind: 'item',
            type: 'true',
            amount: remaining,
            notes: [
              `executed below ${(CRIT_CONSTANTS.theCollector.executeThreshold * 100).toFixed(0)}% health`,
              `${remaining.toFixed(0)} health remained`,
            ],
          });
        },
      };
    },
  };
}

/* --------------------------------------------------------------- crit stacks */

/**
 * Yun Tal Wildarrows.
 *
 * Two passives, both modelled, both keyed off the basic attack.
 *
 * Practice Makes Lethal is a permanent stack: 0.4% critical strike chance per
 * attack for a melee champion (Riot's `CritPerStackMelee`;
 * `StackRangedMultiplier` halves it for ranged, which does not apply to Vi), up
 * to the 25% `CritMax`. Riot's own text is "On-Attack, gain Critical Strike
 * Chance permanently up to 25%" (Data Dragon, verbatim), and "permanently" means
 * across the game, not across the combo.
 *
 * The simulation has no game before the combo and no input for one, so the
 * counter starts at zero and what a run shows is the stacking that happens
 * *inside* the combo. That is a floor and it is a wide one: a player who has held
 * this 3,000 g item for the 63 attacks the cap needs walks into the fight with
 * the full 25% critical strike chance, and this entry gives that build a few
 * tenths of a percent inside a burst. The `note` says so, because the number the
 * app shows is a lower bound rather than an estimate. The alternative — seeding
 * the counter full, the way the Energized items above start charged — would
 * invent a build state for the freshly bought item and report crit chance a
 * player does not have; the Energized comment above says why the two cases are
 * decided differently. Data Dragon agrees the item ships with none of it: it
 * lists 3032's critical strike chance as "0%".
 *
 * The stack is granted on-attack and spent on the attacks after it: this hook
 * runs once the attack's own damage has already resolved, so an attack never
 * inflates its own critical strike chance.
 *
 * Flurry is an attack-speed window with a long cooldown, and this one Riot does
 * resolve in full: "On-Attacking an enemy champion, gain 30% Attack Speed for 6
 * seconds (30 second cooldown). Attacks reduce this cooldown by 1 second,
 * increased to 2 seconds for Critical Strikes" (Data Dragon, verbatim; `ASMod`
 * 0.3, `ASDuration` 6, `Cooldown` 30, `AACDR` 1 and `CritCDR` 2 in the bin say
 * the same). Only the 1-second rate is applied, because
 * `HitInfo` does not report whether a hit critically struck and this codebase
 * folds crit into a multiplier rather than rolling it, so there is no crit to
 * detect. The consequence is bounded and worth naming: it can only ever delay a
 * *second* Flurry, which needs more than twenty attacks in one combo to come up
 * at all.
 *
 * Both buffs are labelled by their passive rather than by the item. The engine
 * keys a temporary buff on the text before the first " · ", so two buffs from
 * one item sharing the item's name as a prefix would overwrite each other —
 * Flurry's attack speed would have replaced the crit stacks outright.
 */
const YUN_TAL_WILDARROWS: ItemEffect = {
  id: '3032',
  name: 'Yun Tal Wildarrows',
  modelled: true,
  note: 'Practice Makes Lethal: +0.4% critical strike chance per attack (melee), to 25%. Counted from zero at the start of the combo, so this is a floor: an item already stacked from earlier in the game is understated by up to 25% critical strike chance. Flurry: +30% attack speed for 6 s on attacking a champion, 30 s cooldown, 1 s off per attack.',
  createRuntime(): ItemRuntime {
    const yunTal = CRIT_CONSTANTS.yunTal;
    let stacks = 0;
    let flurryReadyAt = 0;

    return {
      onBasicAttack(ctx): ItemAttackRider | null {
        /* Flurry first: it is granted when the attack is launched, and the
         * engine reads Vi's attack speed again after this hook to set the next
         * attack timer, so a buff applied here shortens the wait it should. */
        if (ctx.target.unitType === 'champion') {
          if (ctx.time >= flurryReadyAt) {
            flurryReadyAt = ctx.time + yunTal.flurryCooldownSeconds;
            ctx.applyTemporaryStats({
              stats: { attackSpeed: yunTal.flurryAttackSpeed },
              durationSeconds: yunTal.flurryDurationSeconds,
              label: `Flurry · +${(yunTal.flurryAttackSpeed * 100).toFixed(0)}% attack speed`,
            });
          } else {
            flurryReadyAt -= yunTal.flurryCooldownPerAttackSeconds;
          }
        }

        if (stacks < yunTal.maxStacksMelee) {
          stacks += 1;
          const critChance = Math.min(yunTal.critCap, stacks * yunTal.critPerAttackMelee);
          ctx.applyTemporaryStats({
            stats: { critChance },
            durationSeconds: SIMULATION_HORIZON_SECONDS,
            label: `Practice Makes Lethal · ${stacks}/${yunTal.maxStacksMelee} · +${(critChance * 100).toFixed(1)}% crit`,
          });
        }

        // Neither passive adds damage of its own; both work through the stats.
        return null;
      },
    };
  },
};

/* ------------------------------------------------------- ultimate-triggered */

/**
 * The buff identity Fiendhunter Bolts applies its window under.
 *
 * The engine keys a temporary buff — and looks it up in `clearTemporaryStats` —
 * on the text before the first " · ", so the constant is the prefix alone and
 * the attack count and the multiplier are appended for the timeline to read.
 */
const OPENING_BARRAGE = 'Opening Barrage';

/**
 * Fiendhunter Bolts.
 *
 * "After casting your Ultimate, your next 3 basic attacks gain 50% Attack Speed
 * and Critically Strike for 80% of your normal Critical Strike damage for 8
 * seconds. If an attack would already Critically Strike, instead it deals 15%
 * bonus true damage" (Data Dragon, verbatim). The bin's `NumberOfAttacks` 3,
 * `BonusAS` 0.5, `CritModifier` 0.8, `Duration` 8, `BonusTrueDamage` 0.15 and
 * `Cooldown` 45 say the same; Data Dragon does not print the cooldown, so 45 s is
 * the bin's.
 *
 * The window is driven from `onAbilityCast`, which is the one hook that runs
 * *before* the attacks it is supposed to empower — `simulate.ts` calls it on
 * every item runtime with the `AbilitySlot`, so `slot === 'R'` is exactly Riot's
 * "after casting your Ultimate".
 *
 * How a guaranteed critical strike is spelled in a model that never rolls one.
 * This codebase folds crit into an expected-value multiplier: `critMultiplierFor`
 * returns `1 + chance × (multiplier − 1)`. So the buff does two things at once —
 * it adds 1 to `critChance`, which saturates `resolveChampionStats`' 0..1 clamp
 * whatever the build already had, and it bends `critDamage` so that the resulting
 * multiplier is `CritModifier` × the one the build would otherwise have.
 *
 * That the 80% scales the *whole* critical strike multiplier rather than only its
 * bonus half is the wiki's reading, and its own arithmetic is what settles it:
 * "empowered to critically strike for (60% + 24%) bonus damage / 80% total
 * critical damage" (wiki, verbatim, Fiendhunter Bolts) — 0.8 × (200% base + 30%
 * from Infinity Edge) is 184% total, which is the 60% + 24% bonus damage it
 * quotes. Hence `−(1 − CritModifier) × critMultiplier` as the `critDamage` delta:
 * a multiplier of M becomes 0.8 × M. The base multiplier is read from
 * `ctx.stats` rather than restated, so this stays right whatever the engine holds
 * base critical strike damage to be, and it is read *before* the buff is applied
 * so the item never re-scales its own reduction. Two assumptions that follow: the
 * multiplier is snapshotted at the cast rather than tracked for the 8 s (nothing
 * in a combo changes critical strike damage mid-window), and the 45 s cooldown is
 * longer than the 8 s window, so a second cast can never overlap the first.
 *
 * Two parts of the item are named rather than approximated:
 *
 *  - "If an attack would already Critically Strike, instead it deals 15% bonus
 *    true damage" cannot be expressed. "Would already critically strike" is a
 *    yes/no about one roll, and this codebase has no roll — a build with 60% crit
 *    chance is 60% of the way into both branches at once, and there is no hook
 *    that would tell an `ItemAttackRider` what its own attack's pre-mitigation
 *    damage was to take 15% of. So a build that already crits is understated
 *    here, and `warn` says so at the cast rather than in a comment nobody reads.
 *  - `UltimateHaste` 30 ("Gain 30 Ultimate Ability Haste") has no `StatBlock`
 *    field. `StatBlock` carries `abilityHaste` and `basicAbilityHaste`, and
 *    `basicAbilityHaste` is explicitly the haste that must *not* touch the
 *    ultimate; folding ultimate haste into `abilityHaste` would shorten Vi's Q,
 *    W and E as well, which is a bigger error than leaving it out.
 *
 * The Arena variant 222512 is deliberately not cloned: its bin re-tunes the item
 * (`Cooldown` 20, `BonusTrueDamage` 0.10, `CritModifier` 0.75), so it is a
 * different item wearing the same name.
 */
const FIENDHUNTER_BOLTS: ItemEffect = {
  id: '2512',
  name: 'Fiendhunter Bolts',
  modelled: true,
  note: 'Opening Barrage: after the ultimate, the next 3 attacks within 8 s gain +50% attack speed and critically strike for 80% of normal critical strike damage (45 s cooldown). The share of attacks that would have crit anyway is paid the way Riot pays it — full crit plus 15% bonus true damage — weighted by the crit chance at the cast, because crits here are expected values rather than rolls. The 30 ultimate ability haste has no stat to hold it.',
  createRuntime(): ItemRuntime {
    const bolts = CRIT_CONSTANTS.fiendhunterBolts;
    let readyAt = 0;
    let attacksLeft = 0;
    let windowEndsAt = -Infinity;
    /*
     * The crit chance the build had *before* the buff set it to 1. It is the
     * share of attacks that would have crit anyway, which is the share Riot pays
     * differently — see the correction in `onBasicAttack`.
     */
    let critChanceAtCast = 0;

    return {
      onAbilityCast(ctx, slot) {
        if (slot !== 'R') return;
        if (ctx.time < readyAt) return;

        // Read before the buff lands: after it, both are the buffed values.
        const normalMultiplier = ctx.stats.critMultiplier;
        const alreadyCrits = ctx.stats.critChance;

        readyAt = ctx.time + bolts.cooldownSeconds;
        attacksLeft = bolts.attacks;
        windowEndsAt = ctx.time + bolts.durationSeconds;

        const empowered = bolts.critModifier * normalMultiplier;
        ctx.applyTemporaryStats({
          stats: {
            attackSpeed: bolts.bonusAttackSpeed,
            critChance: 1,
            critDamage: -(1 - bolts.critModifier) * normalMultiplier,
          },
          durationSeconds: bolts.durationSeconds,
          label: `${OPENING_BARRAGE} · ${bolts.attacks} attacks · ×${empowered.toFixed(2)} guaranteed crit`,
        });

        critChanceAtCast = Math.min(1, Math.max(0, alreadyCrits));
      },

      onBasicAttack(ctx): ItemAttackRider | null {
        if (attacksLeft <= 0) return null;
        // The window can lapse with attacks unspent; the buff has expired on its
        // own duration by then, so there is nothing left to clear.
        if (ctx.time > windowEndsAt) {
          attacksLeft = 0;
          return null;
        }
        attacksLeft -= 1;
        // Ends on the third attack rather than on the timer — the same shape
        // Hail of Blades uses in `runes.ts`. This hook runs after the attack's
        // own damage has resolved, so the attack that spends the last charge
        // still had the buff.
        if (attacksLeft === 0) ctx.clearTemporaryStats(OPENING_BARRAGE);

        /*
         * The share that would have crit anyway, paid the way Riot pays it.
         *
         * The buff above makes every attack in the window crit at 80 % of normal
         * critical damage. For an attack that would *already* have crit, the game
         * does something else: it crits in full and adds 15 % bonus true damage.
         * An earlier version of this file called that unmodellable because it
         * "needs a crit roll" — it does not. Crits here are expected values, so
         * the fix is a weight, not a roll: `critChanceAtCast` is exactly the share
         * of the attack that took the other branch.
         *
         * Two corrections follow, both scaled by that share: the missing 20 % of
         * the critical damage, and the true damage. The true part is its own
         * instance because it ignores armour, and folding it into a physical
         * rider would let the target's armour eat it.
         */
        if (critChanceAtCast <= 0) return null;

        const attack = ctx.stats.totalAttackDamage;
        // The unbuffed multiplier, recovered from the buff's own arithmetic.
        const normalMultiplier = ctx.stats.critMultiplier / bolts.critModifier;

        const trueShare = critChanceAtCast * bolts.bonusTrueDamage * attack * normalMultiplier;
        if (trueShare > 0) {
          ctx.dealDamage({
            sourceId: 'item:2512',
            sourceLabel: 'Fiendhunter Bolts · bonus true damage',
            sourceKind: 'item',
            type: 'true',
            amount: trueShare,
            notes: [
              `${(bolts.bonusTrueDamage * 100).toFixed(0)}% of the ${(critChanceAtCast * 100).toFixed(0)}% of attacks that already crit`,
            ],
          });
        }

        const missingCrit =
          critChanceAtCast * attack * (normalMultiplier - bolts.critModifier * normalMultiplier);
        if (missingCrit <= 0) return null;
        return {
          amount: missingCrit,
          type: 'physical',
          label: 'Fiendhunter Bolts · full crit on the share that already crit',
          notes: [
            `the ${(critChanceAtCast * 100).toFixed(0)}% that would have crit anyway crits in full, not at ${(bolts.critModifier * 100).toFixed(0)}%`,
          ],
        };
      },
    };
  },
};

/* -------------------------------------------------------------- penetration */

/**
 * Opportunity, Arena's 226701.
 *
 * The Rift 6701 is gone (see the header); this is the live item, and it is not
 * the same one. "After being out of combat with Champions for 8 seconds gain
 * Lethality. This Lethality lasts for 3 seconds after dealing damage to
 * champions" is Data Dragon's shared text, but 226701's own bin says the Arena
 * timer is `CombatTimer` 3, not 8, and its Preparation is worth 20 lethality (see
 * `CRIT_CONSTANTS.opportunityArena`, which is also the one inferred number in
 * this file).
 *
 * It is declared as a stat rather than driven from a hook, and that is a
 * modelling decision with a bound worth stating rather than burying:
 *
 *  - A combo is a fight that has been walked into. Preparation is charged when it
 *    starts — 3 seconds out of combat is the normal state of a champion about to
 *    engage — so the lethality is present for the first hit, which is exactly the
 *    hit a hook could not reach: `onBasicAttack` and `onHitLanded` both run after
 *    their instance's damage has been computed, so a buff applied from either
 *    would arrive one hit late, and for Vi that missing hit is usually the
 *    charged Q.
 *  - It is then held for the whole combo. Every hit inside 3 seconds of the last
 *    one refreshes it, so for any burst — and for any sustained fight without a
 *    pause — this is exact. A combo that deliberately waits more than 3 seconds
 *    between two damage instances would drop Preparation in game and keeps it
 *    here, which overstates that combo by 20 lethality until Vi has been out of
 *    combat for 3 seconds and earned it back. That is the one place this entry is
 *    optimistic, and `note` says so where the app can read it.
 *
 * The 15 lethality of its stat line is not repeated here: Data Dragon lists it,
 * `parseItemDescription` reads it, and `stats` is added on top of what was
 * parsed. Extraction (200 decaying movement speed on a takedown) is not
 * modelled: it happens after the target is dead, which is where the simulation
 * stops.
 */
const OPPORTUNITY_ARENA: ItemEffect = {
  id: '226701',
  name: 'Opportunity',
  modelled: true,
  note: 'Preparation: +20 lethality, held for the whole combo. Exact while hits are less than 3 s apart, optimistic across a longer pause. Extraction only pays out after the kill.',
  stats: { lethality: CRIT_CONSTANTS.opportunityArena.preparationLethality },
};

/**
 * The Arena variants, and only the ones whose passives are genuinely identical.
 *
 * Riot re-tunes items for Arena, and the bin says which ones: 223032's and
 * 226676's data values match their Summoner's Rift originals value for value
 * (`CritPerStackMelee` 0.4, `CritMax` 25, `ASMod` 0.3, `Cooldown` 30;
 * `ExecuteThreshold` 0.05), differing only in stat lines that Data Dragon ships
 * and the description parser reads. The other Arena ids in this family are *not*
 * cloned, because they are different items wearing the same name: 223094's
 * `BonusDamage` is 200 rather than 40, 223087's chain damage moves into a
 * level-scaling calculation instead of sitting at a flat 60, and 222512's
 * `CritModifier` is 0.75 on a 20 s cooldown. 226701 is in the list on its own
 * terms rather than as a copy, because the Rift item it used to mirror is gone.
 */
export const CRIT_ITEMS: ItemEffect[] = [
  RAPID_FIRECANNON,
  STORMRAZOR,
  STATIKK_SHIV,
  theCollector('6676'),
  theCollector('226676'),
  YUN_TAL_WILDARROWS,
  { ...YUN_TAL_WILDARROWS, id: '223032' },
  FIENDHUNTER_BOLTS,
  OPPORTUNITY_ARENA,
];
