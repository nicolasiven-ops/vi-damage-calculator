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
 *    grant that 30% a second time.
 *  - **Navori Flickerblade (6675)**: "Basic attacks on-attack reduce the
 *    remaining cooldowns of your basic abilities by 15%" (wiki, verbatim;
 *    Riot's `CDRAmount` is 0.15). `SimContext` has no way to touch a remaining
 *    cooldown — it offers damage, shred, shields, stats, amplification and crowd
 *    control — and ability haste is not the same mechanic, so nothing here can
 *    stand in for it.
 *  - **Profane Hydra (6698)**: Cleave hits "other enemies in a 350 radius
 *    centered around the target" (wiki, verbatim), so it adds nothing against a
 *    single target — the same reason Titanic Hydra is modelled by its on-hit
 *    alone. Its active would matter — "Deal 80% AD physical damage to enemies in
 *    a 450 radius in front of you (10 second cooldown)" (wiki, verbatim; the
 *    bin's `SlashDamageBase` is 0.8 of an attack-damage stat, which agrees) —
 *    but the engine answers an `item` combo step with "Item actives are not
 *    modelled yet — step skipped", and `ItemRuntime` has no activation hook.
 *  - **Runaan's Hurricane (3085)**: the bolts (the bin's `BoltDamage`, 0.65 of
 *    an attack-damage stat) fly at two *additional* enemies near the target and
 *    never at the target itself.
 *  - **Phantom Dancer (3046)** and **Youmuu's Ghostblade (3142)** buy movement
 *    speed and ghosting. Neither changes a damage number, and neither has a
 *    single data value in the bin that is not a speed or a duration.
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
 * Every number this module acts on, in one place, so the tests can assert
 * against the same constant the code uses instead of restating it.
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
   * Riot's `mItemCalculations.BonusLethalityCalc` on item 6701: a flat 11, with
   * a `RangedLethalityMultiplier` of 0.455 that would take a ranged champion to
   * 5. Vi is melee, so 11 it is — which the wiki states as the melee value too.
   * `CombatTimer` is 8 and `DamageWindowDuration` is 3.
   */
  opportunity: {
    preparationLethalityMelee: 11,
    outOfCombatSeconds: 8,
    heldAfterDamageSeconds: 3,
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
 * Two things this cannot see, both because of how the engine routes procs.
 * `onHitLanded` is not called for damage whose source is an item or a rune, so
 * an execute cannot be triggered by another item's proc — only by an attack, an
 * ability or a summoner. And the engine still applies the target's flat and
 * percent damage reduction to true damage, so on a target that has any, the
 * execute lands short of the kill; that is reported as a warning rather than
 * papered over by inflating the number, because inventing damage to force the
 * arithmetic to agree is the one thing a calculator must not do.
 *
 * The 10 lethality is a stat line Data Dragon already lists, so it is not
 * repeated here — `stats` on an `ItemEffect` is added on top of the parsed stat
 * block, and declaring it would double it.
 */
const THE_COLLECTOR: ItemEffect = {
  id: '6676',
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
          sourceId: 'item:6676',
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

/* --------------------------------------------------------------- crit stacks */

/**
 * Yun Tal Wildarrows.
 *
 * Two passives, both modelled, both keyed off the basic attack.
 *
 * Practice Makes Lethal is a permanent stack: 0.4% critical strike chance per
 * attack for a melee champion (Riot's `CritPerStackMelee`;
 * `StackRangedMultiplier` halves it for ranged, which does not apply to Vi), up
 * to the 25% `CritMax`. "Permanent" means across the game, not across the combo,
 * and the simulation starts at zero because it has no game before it — so what
 * the combo shows is the stacking that happens *inside* the combo. That is the
 * same thing Data Dragon claims: it lists the item's critical strike chance as
 * "0%", because the item genuinely ships with none.
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
  note: 'Practice Makes Lethal: +0.4% critical strike chance per attack (melee), to 25%, counted from zero at the start of the combo. Flurry: +30% attack speed for 6 s on attacking a champion, 30 s cooldown, 1 s off per attack.',
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

/* -------------------------------------------------------------- penetration */

/**
 * Opportunity.
 *
 * Preparation is a stat, not a proc: "After being out of combat with Champions
 * for 8 seconds gain <scaleLethality>Lethality</scaleLethality>. This Lethality
 * lasts for 3 seconds after dealing damage to champions." Riot leaves the amount
 * out of the tooltip; `mItemCalculations.BonusLethalityCalc` on item 6701 is a
 * flat 11 with a ranged multiplier of 0.455, so 11 for Vi.
 *
 * It is declared as a stat rather than driven from a hook, and that is a
 * modelling decision with a bound worth stating rather than burying:
 *
 *  - A combo is a fight that has been walked into. Preparation is charged when it
 *    starts — 8 seconds out of combat is the normal state of a champion about to
 *    engage — so the lethality is present for the first hit, which is exactly the
 *    hit a hook could not reach: `onBasicAttack` and `onHitLanded` both run after
 *    their instance's damage has been computed, so a buff applied from either
 *    would arrive one hit late, and for Vi that missing hit is usually the
 *    charged Q.
 *  - It is then held for the whole combo. Every hit inside 3 seconds of the last
 *    one refreshes it, so for any burst — and for any sustained fight without a
 *    pause — this is exact. A combo that deliberately waits more than 3 seconds
 *    between two damage instances would drop Preparation in game and keeps it
 *    here, which overstates that combo by 11 lethality until Vi has been out of
 *    combat for 8 seconds and earned it back. That is the one place this entry is
 *    optimistic, and `note` says so where the app can read it.
 *
 * Extraction (200 decaying movement speed on a takedown) is not modelled: it
 * happens after the target is dead, which is where the simulation stops.
 */
const OPPORTUNITY: ItemEffect = {
  id: '6701',
  name: 'Opportunity',
  modelled: true,
  note: 'Preparation: +11 lethality (melee), held for the whole combo. Exact while hits are less than 3 s apart, optimistic across a longer pause. Extraction only pays out after the kill.',
  stats: { lethality: CRIT_CONSTANTS.opportunity.preparationLethalityMelee },
};

/**
 * The Arena variants, and only the two whose passives are genuinely identical.
 *
 * Riot re-tunes items for Arena, and the bin says which ones: 223032's and
 * 226676's data values match their Summoner's Rift originals value for value
 * (`CritPerStackMelee` 0.4, `CritMax` 25, `ASMod` 0.3, `Cooldown` 30;
 * `ExecuteThreshold` 0.05), differing only in stat lines that Data Dragon ships
 * and the description parser reads. The other Arena ids in this family are *not*
 * cloned, because they are different items wearing the same name: 223094's
 * `BonusDamage` is 200 rather than 40, and 223087's chain damage interpolates
 * from 80 to 160 with champion level instead of sitting at a flat 60.
 */
export const CRIT_ITEMS: ItemEffect[] = [
  RAPID_FIRECANNON,
  STORMRAZOR,
  STATIKK_SHIV,
  THE_COLLECTOR,
  YUN_TAL_WILDARROWS,
  { ...YUN_TAL_WILDARROWS, id: '223032' },
  { ...THE_COLLECTOR, id: '226676' },
  OPPORTUNITY,
];
