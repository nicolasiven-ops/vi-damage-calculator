/**
 * Ability-power items and ability-proc items.
 *
 * Same contract as `../itemEffects`: an entry here is a passive that reaches a
 * damage number through the `SimContext` hooks, keyed by Data Dragon item id.
 * Items whose passive cannot reach one are deliberately absent rather than
 * approximated — an item with no entry still contributes its whole stat line,
 * and the analysis names it as unmodelled, which is a truthful answer. A
 * plausible-looking invented number would not be.
 *
 * Sourcing rules followed for every constant below:
 *  - Data Dragon `item.json` for patch 16.16.1 is the first source, but it ships
 *    these passives with the numbers stripped out ("deals bonus magic damage"),
 *    so it settles only the prose and the stat lines.
 *  - The numbers therefore come from Riot's own item bin — CommunityDragon's
 *    `game/items.cdtb.bin.json` (path `16.16`) — where every one of them is a
 *    named `ItemDataValue` or `GameCalculation` on the item itself. Each
 *    constant below names the bin key it was read from.
 *  - The wiki is quoted only where it is cited as such, and only for prose that
 *    tells us what Riot's own numbers mean or for a value Riot's data does not
 *    ship at all (the echo interval, the Cinderbloom formula).
 *
 * Vi is melee. Where an effect has separate melee and ranged values the melee
 * value is used and the comment says so.
 */

import type { AmplifiableHit, ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';
import type { HitInfo } from '../runes';
import { BASE_CRIT_MULTIPLIER } from '../stats';

/* ----------------------------------------------------- what counts as a spell */

/**
 * Whether a landed hit is the "ability damage" Riot's item text keys off.
 *
 * `HitInfo.isAbilityDamage` is the obvious answer and it is not a complete one.
 * `performAttack` in `../../engine/simulate` books an empowered basic attack as
 * `sourceKind: 'ability'` with the champion's slot attached, but it passes no
 * `isAbilityDamage`, so the flag defaults to false. Vi's Relentless Force is
 * exactly that case: her most common opener is an ability as far as the engine's
 * own attribution goes, and false as far as the flag goes.
 *
 * Riot's side of it, wiki-sourced (Vi/LoL, Relentless Force): the ability
 * "Applies spell damage to the primary target", and the V14.5 patch note that it
 * "now triggers spell effects upon dealing damage". So the game does proc
 * spell-damage items off the empowered attack, and reading the slot attribution
 * alongside the flag is what makes this model agree with it.
 *
 * Both conditions are checked rather than only the slot one, because a
 * scheduled or delayed ability tick can carry the flag without the engine
 * calling it an 'ability' source kind.
 */
function isSpellDamage(hit: HitInfo | AmplifiableHit): boolean {
  return hit.isAbilityDamage || hit.sourceKind === 'ability';
}

/* --------------------------------------------------------------- spellblades */

/*
 * Two of this family's items are the same passive with different numbers, so
 * they share one runtime. The physical spellblades (Sheen, Trinity Force) have
 * their own helper in `../itemEffects`; these two are the magic ones that also
 * scale with ability power, which is why they live here.
 */
interface SpellbladeNumbers {
  baseAdRatio: number;
  apRatio: number;
  windowSeconds: number;
  cooldownSeconds: number;
}

function spellbladeRuntime(numbers: SpellbladeNumbers, label: string): () => ItemRuntime {
  return () => {
    let armedUntil = -Infinity;
    let readyAt = 0;
    return {
      onAbilityCast(ctx) {
        // The cooldown gates arming, not swinging: an ability cast during it
        // leaves the spellblade unarmed rather than queueing a second charge.
        if (ctx.time < readyAt) return;
        armedUntil = ctx.time + numbers.windowSeconds;
      },
      onBasicAttack(ctx): ItemAttackRider | null {
        if (ctx.time > armedUntil) return null;
        armedUntil = -Infinity;
        // Both items' wiki text is explicit that the cooldown starts when the
        // empowered attack is spent, not when the ability was cast.
        readyAt = ctx.time + numbers.cooldownSeconds;
        const fromBaseAd = numbers.baseAdRatio * ctx.stats.baseAttackDamage;
        const fromAp = numbers.apRatio * ctx.stats.abilityPower;
        return {
          amount: fromBaseAd + fromAp,
          type: 'magic',
          label,
          notes: [
            `${(numbers.baseAdRatio * 100).toFixed(0)}% of ${ctx.stats.baseAttackDamage.toFixed(0)} base AD` +
              ` + ${(numbers.apRatio * 100).toFixed(0)}% of ${ctx.stats.abilityPower.toFixed(0)} AP`,
          ],
        };
      },
    };
  };
}

/* --------------------------------------------------------------- Lich Bane */

/*
 * Riot bin, `Items/3100`:
 *   mDataValues  SpellbladeADRatio = 0.75, LichBaneAPValue = 0.45,
 *                SpellBladeDuration = 10, SpellbladeCooldown = 1.5
 *   mItemCalculations.SpellbladeDamage
 *     = base attack damage (mStat 2 / mStatFormula 1) × SpellbladeADRatio
 *     + ability power × LichBaneAPValue
 *
 * `mStat 2 / mStatFormula 1` is confirmed as *base* attack damage by Sheen
 * (`Items/3057`), whose identical formula part with coefficient 1 is the 100%
 * base AD the calculator already models for it.
 *
 * The wiki's prose for the same passive, quoted verbatim and marked as
 * wiki-sourced, is what tells us the window and the cooldown apply the way they
 * are implemented below: "After using an ability, your next basic attack within
 * 10 seconds gains 50% bonus attack speed and deals 75% base AD (+ 45% AP)
 * bonus magic damage on-hit (1.5 second cooldown, starts after using the
 * empowered attack)."
 */
const LICH_BANE_NUMBERS: SpellbladeNumbers = {
  baseAdRatio: 0.75,
  apRatio: 0.45,
  windowSeconds: 10,
  cooldownSeconds: 1.5,
};

const LICH_BANE: ItemEffect = {
  id: '3100',
  name: 'Lich Bane',
  modelled: true,
  note:
    'Spellblade: after an ability, the next basic attack within 10 s deals 75% base AD (+45% AP) bonus magic damage. ' +
    '1.5 s cooldown, starting when the empowered attack is spent. ' +
    'The 50% bonus attack speed on that one attack is not modelled: an item runtime is first asked for its rider ' +
    'after the wind-up has already been paid, so there is no hook that could put the buff in place in time for the ' +
    'attack it belongs to.',
  createRuntime: spellbladeRuntime(LICH_BANE_NUMBERS, 'Lich Bane · Spellblade'),
};

/* ----------------------------------------------------------- Dusk and Dawn */

/*
 * Riot bin, `Items/2510`:
 *   mDataValues  SpellbladeCooldown = 1.5, Cooldown = 1.5
 *   mItemCalculations.SpellbladeDamage
 *     = base attack damage (mStat 2 / mStatFormula 1) × 0.75
 *     + ability power × 0.10
 *   mItemCalculations.SpellbladeHealing
 *     = ability power × 0.10 + bonus health (mStat 12 / mStatFormula 2) × 0.03
 *
 * Unlike Lich Bane the bin ships no `SpellBladeDuration` for this item, so the
 * 10 s window is wiki-sourced, from prose that also confirms both bin
 * coefficients: "After using an ability, your next basic attack within 10
 * seconds deals 75% base AD (+ 10% AP) bonus magic damage and heals you for 10%
 * AP (+ 3% bonus health) on-hit, and applies on-hit effects to the target again
 * after a 0.2-second delay (1.5 second cooldown, starts after using the
 * empowered attack)."
 *
 * Two halves of the passive are named and left out rather than approximated:
 *  - The heal. Nothing in an attacker-side damage simulation spends it, and
 *    `SimContext` offers no healing channel a rider could pay into.
 *  - The second application of on-hit effects. That is the damaging half, and it
 *    is unreachable: an `ItemRuntime` can produce its own rider but cannot ask
 *    the engine to run every *other* item's and rune's on-hit a second time, so
 *    a build with Nashor's Tooth or Guinsoo's is undercounted on the empowered
 *    attack. Faking it by doubling only this item's own rider would be a
 *    different, wrong number rather than a partial one.
 */
const DUSK_AND_DAWN_NUMBERS: SpellbladeNumbers = {
  baseAdRatio: 0.75,
  apRatio: 0.1,
  windowSeconds: 10,
  cooldownSeconds: 1.5,
};

const DUSK_AND_DAWN: ItemEffect = {
  id: '2510',
  name: 'Dusk and Dawn',
  modelled: true,
  note:
    'Spellblade: after an ability, the next basic attack within 10 s deals 75% base AD (+10% AP) bonus magic ' +
    'damage. 1.5 s cooldown, starting when the empowered attack is spent. Two parts are not modelled: the heal ' +
    '(10% AP + 3% bonus health — the context has no healing channel), and the second application of on-hit ' +
    'effects 0.2 s later, which no item hook can trigger on other items — so a build with other on-hit damage is ' +
    'undercounted on that one attack.',
  createRuntime: spellbladeRuntime(DUSK_AND_DAWN_NUMBERS, 'Dusk and Dawn · Spellblade'),
};

/* -------------------------------------------------------------- Shadowflame */

/*
 * Riot bin, `Items/4645`:
 *   mDataValues  HealthThreshold = 0.4, SpellItemDamageAmp = 0.2,
 *                DamageOverTimeAmp = 0.2
 *
 * Data Dragon's resolved text for 16.16.1 agrees and is unambiguous about which
 * damage types it covers: "Magic and true damage Critically Strike enemies
 * below 40% Health, dealing 20% increased damage."
 *
 * `DamageOverTimeAmp` is the same 20% for damage over time, so one amplifier
 * covers both cases and no separate branch is needed.
 *
 * Two rules that decide the number are not in Riot's data at all and are
 * therefore wiki-sourced, quoted verbatim:
 *
 *  - What it does not amplify: "Cinderbloom affects the damage dealt by all
 *    sources except summoner spells." The engine deals Ignite and the Smites as
 *    `sourceKind: 'summoner'`, which is the gate below. (The wiki also excludes
 *    structures; `TargetConfig.unitType` has no structure, so there is nothing
 *    to gate on.)
 *  - That the 20% is *not* fixed: "increased damage = base damage + ((base
 *    damage × 0.2) × (product of all critical damage modifiers))", and the
 *    worked example, "If the user has a critical damage modifier such as
 *    Infinity Edge, the damage amplifier is increased to 26%… 126 = 100 +
 *    ((100 × 0.2) × (1 + 0.3))". A build carrying Critical Strike Damage
 *    therefore gets more than 20%, which an earlier version of this file denied.
 *
 * `stats.critMultiplier` is `BASE_CRIT_MULTIPLIER + bonus.critDamage`, so the
 * product of the critical-damage modifiers is what sits on top of the base
 * multiplier: 1 + (critMultiplier − BASE_CRIT_MULTIPLIER), which is 1.3 for
 * Infinity Edge's +30% and matches the wiki's example exactly.
 *
 * The wiki's other clause — "If the damage dealt already critically strikes,
 * Cinderbloom will stack multiplicatively with the critical strike damage
 * multiplier" — needs nothing here: the engine applies the crit factor to the
 * raw amount before multiplying by the amplifier factor.
 */
const SHADOWFLAME_HEALTH_THRESHOLD = 0.4;
const SHADOWFLAME_DAMAGE_AMP = 0.2;

function cinderbloomAmp(ctx: SimContext, hit: AmplifiableHit): number {
  if (hit.sourceKind === 'summoner') return 0;
  if (hit.type !== 'magic' && hit.type !== 'true') return 0;
  // "below 40% Health" is strict, so a target sitting exactly on the threshold
  // does not qualify.
  if (ctx.targetCurrentHealth >= ctx.targetMaxHealth * SHADOWFLAME_HEALTH_THRESHOLD) return 0;
  /*
   * Clamped at zero because a negative critical-damage modifier — nothing in
   * this patch's items, but the stat block accepts one by hand — would turn an
   * amplifier into a reduction Riot's formula never produces.
   */
  const critDamageModifiers = Math.max(0, 1 + (ctx.stats.critMultiplier - BASE_CRIT_MULTIPLIER));
  return SHADOWFLAME_DAMAGE_AMP * critDamageModifiers;
}

const SHADOWFLAME: ItemEffect = {
  id: '4645',
  name: 'Shadowflame',
  modelled: true,
  note:
    'Cinderbloom: magic and true damage deals 20% more against a target below 40% of its maximum health — more ' +
    'than 20% if the build carries Critical Strike Damage, because Riot multiplies the 20% by the product of all ' +
    'critical-damage modifiers. Summoner spells are excluded. Riot says "enemies" rather than "champions", so ' +
    'minions and monsters count too. The 15 magic penetration is a stat line Data Dragon already ships.',
  amplify: cinderbloomAmp,
};

/* -------------------------------------------------------------- Luden's Echo */

/*
 * Riot bin, `Items/6655`:
 *   mDataValues  BaseDamage = 75, APRatio = 0.05, MaxCharges = 6,
 *                RepeatDamageReduction = 0.2, Cooldown = 12
 *   mItemCalculations.Damage          = BaseDamage + ability power × APRatio
 *   mItemCalculations.SingleTargetMax = Damage × 2
 *
 * Against a lone target Data Dragon says the echoes with no second target "fire
 * on the primary target, dealing 20% damage" — which is `RepeatDamageReduction`
 * — so one full echo plus five at 20% is 1 + 5 × 0.2 = 2 echoes' worth. Riot
 * ships that product as `SingleTargetMax`, and this implementation's six
 * instances still add up to it exactly; the multiplier is data, not algebra
 * invented here.
 *
 * The five repeats are *not* dealt with the first one. Wiki-sourced, because
 * Riot's bin ships no interval for it: "Echo's remaining charges against the
 * primary target deal their additional damage in 0.25-second intervals. This
 * means it takes 0.25 / 0.5 / 0.75 / 1 / 1.25 (based on remaining charges)
 * seconds for the damage of all the charges to be dealt." Scheduling them
 * matters rather than being cosmetic: the engine stops counting damage at the
 * kill, so a lump sum at the moment of the ability hit would credit this item
 * with damage that in game arrives up to 1.25 s later — after the target may
 * already be dead, and after anything else in the combo could have killed it.
 *
 * Data Dragon 16.16.1 still calls item 6655 "Luden's Echo"; the name used here
 * is Riot's current one rather than any of the item's earlier names.
 */
const LUDENS_ECHO_BASE_DAMAGE = 75;
const LUDENS_ECHO_AP_RATIO = 0.05;
const LUDENS_ECHO_MAX_CHARGES = 6;
const LUDENS_ECHO_REPEAT_FRACTION = 0.2;
const LUDENS_ECHO_REPEAT_INTERVAL_SECONDS = 0.25;
const LUDENS_COOLDOWN_SECONDS = 12;

function ludensRuntime(): ItemRuntime {
  let readyAt = 0;
  return {
    onHitLanded(ctx, hit) {
      // "Damaging Abilities" — see `isSpellDamage`: the flag alone would miss
      // Vi's Relentless Force, which the game does proc this item off.
      if (!isSpellDamage(hit) || hit.mitigated <= 0) return;
      if (ctx.time < readyAt) return;
      readyAt = ctx.time + LUDENS_COOLDOWN_SECONDS;

      const perEcho = LUDENS_ECHO_BASE_DAMAGE + LUDENS_ECHO_AP_RATIO * ctx.stats.abilityPower;
      const repeat = perEcho * LUDENS_ECHO_REPEAT_FRACTION;
      const formula =
        `${LUDENS_ECHO_BASE_DAMAGE} + ` +
        `${(LUDENS_ECHO_AP_RATIO * 100).toFixed(0)}% of ${ctx.stats.abilityPower.toFixed(0)} AP`;

      ctx.dealDamage({
        sourceId: 'item:6655',
        sourceLabel: `Luden's Echo · Echo (1/${LUDENS_ECHO_MAX_CHARGES})`,
        sourceKind: 'item',
        type: 'magic',
        amount: perEcho,
        notes: [formula, 'the first echo, on the hit itself'],
      });

      for (let charge = 2; charge <= LUDENS_ECHO_MAX_CHARGES; charge += 1) {
        ctx.scheduleDamage({
          afterSeconds: (charge - 1) * LUDENS_ECHO_REPEAT_INTERVAL_SECONDS,
          sourceId: 'item:6655',
          sourceLabel: `Luden's Echo · Echo (${charge}/${LUDENS_ECHO_MAX_CHARGES})`,
          sourceKind: 'item',
          type: 'magic',
          amount: repeat,
          notes: [
            `${(LUDENS_ECHO_REPEAT_FRACTION * 100).toFixed(0)}% of (${formula})`,
            `redirected onto the primary target, ` +
              `${((charge - 1) * LUDENS_ECHO_REPEAT_INTERVAL_SECONDS).toFixed(2)} s after the hit`,
          ],
        });
      }
    },
  };
}

const LUDENS_ECHO: ItemEffect = {
  id: '6655',
  name: "Luden's Echo",
  modelled: true,
  note:
    'Echo: a damaging ability fires six echoes of 75 (+5% AP) magic damage each. Against a single target that is ' +
    'one full echo on the hit plus five at 20% arriving every 0.25 s, so the last lands 1.25 s later — together ' +
    'Riot\'s own "SingleTargetMax" of twice one echo. 12 s cooldown. Vi\'s Relentless Force counts as a damaging ' +
    'ability, as it does in game.',
  createRuntime: ludensRuntime,
};

/* --------------------------------------------------------------- Malignance */

/*
 * Riot bin, `Items/3118`:
 *   mDataValues  BaseDamage = 60, APRatio = 0.05, GroundDuration = 3,
 *                UltimateHaste = 20
 *   mItemCalculations.GroundBurnDamagePerTickTooltipOnly
 *     = BaseDamage + ability power × APRatio
 *   mItemCalculations.{8e8f7a34}
 *     = 0.25 × (BaseDamage + ability power × APRatio)
 *   mItemCalculations.MagicResistanceShred = 10
 *
 * The bin alone does not say which of those two is the tick: Riot's own key name
 * reads `PerTick` on the *unmultiplied* one, and nothing in either name or
 * structure identifies the 0.25 multiplier as a quarter-second rate rather than
 * a quarter of something else. What settles it is the wiki, quoted verbatim and
 * marked wiki-sourced the same way the Hatefog cooldown below is: Hatefog
 * applies "a Curse" that deals "15 (+ 1.25% AP) magic damage every 0.25
 * seconds" for "180 (+ 15% AP) total magic damage over the duration", lasting 3
 * seconds. So the 60 (+5% AP) figure is per second, twelve quarter-second ticks
 * of 15 (+1.25% AP) make it up, and 12 × (15 + 1.25% AP) = 180 (+15% AP) is
 * what the loop below produces.
 *
 * The true tick rate is modelled rather than one lump per second because the
 * ticks are what decide whether the burn finishes before the target dies, and
 * the calculator stops counting damage at the kill.
 *
 * Two parts of this item are named here and left out rather than approximated:
 *  - The −10 magic resist. `SimContext` exposes `applyArmorShred` and nothing
 *    equivalent for magic resist, and the mitigation step reads the target's
 *    magic resist with `flatReduction: 0` hard-wired, so there is no honest way
 *    to apply it. Faking it as +10 flat magic penetration would diverge from a
 *    real −10 shred the moment any percent magic penetration is in the build.
 *  - Scorn's 20 ultimate ability haste (Data Dragon: "Gain 20 Ultimate Ability
 *    Haste"). `StatBlock` has `abilityHaste` and `basicAbilityHaste`
 *    (everything that is not the ultimate) but no ultimate-only channel. It
 *    could be faked as +20 haste and −20 basic haste, which would even produce
 *    the right cooldowns, but it would put a negative stat in front of the
 *    reader in the stat sheet, so it is reported as missing instead.
 *
 * Wiki-sourced, for a rule Riot's bin does not ship as a data value on this
 * item: the Curse has a "3 second cooldown per target, starts on zone
 * creation". Nothing is implemented for it — Vi's ultimate is on a 90 s
 * cooldown, so a 3 s gate cannot be reached twice inside one combo — and it is
 * recorded here so the omission is a decision rather than an oversight.
 */
const MALIGNANCE_BURN_SECONDS = 3;
const MALIGNANCE_TICK_SECONDS = 0.25;
const MALIGNANCE_DAMAGE_PER_SECOND = 60;
const MALIGNANCE_AP_RATIO_PER_SECOND = 0.05;
const MALIGNANCE_TICKS = Math.round(MALIGNANCE_BURN_SECONDS / MALIGNANCE_TICK_SECONDS);

function malignanceRuntime(): ItemRuntime {
  return {
    onHitLanded(ctx, hit) {
      /*
       * "Damaging a champion with your Ultimate."
       *
       * `HitInfo` carries no ability slot, so the ultimate has to be recognised
       * by its `sourceId`. Every champion module in this project uses the slot
       * letter as the source id of an ability's damage — Vi's Cease and Desist
       * deals its damage as `sourceId: 'R', slot: 'R'` — so that is the
       * identifier available here, and the spell-damage check is required
       * alongside it so nothing else that happens to be called R could trigger
       * the burn.
       */
      if (hit.sourceId !== 'R' || !isSpellDamage(hit) || hit.mitigated <= 0) return;
      if (ctx.target.unitType !== 'champion') return;

      const perSecond =
        MALIGNANCE_DAMAGE_PER_SECOND + MALIGNANCE_AP_RATIO_PER_SECOND * ctx.stats.abilityPower;
      const perTick = perSecond * MALIGNANCE_TICK_SECONDS;

      ctx.addEvent({
        kind: 'info',
        label: 'Malignance · Hatefog',
        detail:
          `${(perSecond * MALIGNANCE_BURN_SECONDS).toFixed(0)} magic damage over ` +
          `${MALIGNANCE_BURN_SECONDS} s · magic resist reduction not modelled`,
      });

      for (let tick = 1; tick <= MALIGNANCE_TICKS; tick += 1) {
        ctx.scheduleDamage({
          afterSeconds: tick * MALIGNANCE_TICK_SECONDS,
          sourceId: 'item:3118',
          sourceLabel: `Malignance · Hatefog (tick ${tick}/${MALIGNANCE_TICKS})`,
          sourceKind: 'item',
          type: 'magic',
          amount: perTick,
        });
      }
    },
  };
}

const MALIGNANCE: ItemEffect = {
  id: '3118',
  name: 'Malignance',
  modelled: true,
  note:
    'Hatefog: ultimate damage to a champion burns the ground for 3 s, dealing 60 (+5% AP) magic damage per second ' +
    'in twelve quarter-second ticks of 15 (+1.25% AP). The −10 magic resist is not modelled (the context can shred ' +
    "armor only, so the ticks meet the target's full magic resist), and Scorn's 20 ultimate ability haste is not " +
    'modelled (the stat block has no ultimate-only haste).',
  createRuntime: malignanceRuntime,
};

/* --------------------------------------------------------------- Stormsurge */

/*
 * Riot bin, `Items/4646`:
 *   mDataValues  BaseDamage = 125, APRatio = 0.1, DamageThreshold = 0.25,
 *                WindowDuration = 2.5, DelayDuration = 2, Cooldown = 30,
 *                RangedProcDamageMod = 1
 *   mItemCalculations.MeleeItemCalcValue  = BaseDamage + ability power × APRatio
 *   mItemCalculations.RangedItemCalcValue = MeleeItemCalcValue × RangedProcDamageMod
 *   mItemCalculations.SquallDamage        = BaseDamage + ability power × APRatio
 *
 * The melee value is the one used, as it is for every melee/ranged split in this
 * project — though here the two are equal, because Riot's own ranged modifier is
 * 1 in this patch.
 */
const STORMSURGE_BASE_DAMAGE = 125;
const STORMSURGE_AP_RATIO = 0.1;
const STORMSURGE_HEALTH_THRESHOLD = 0.25;
const STORMSURGE_WINDOW_SECONDS = 2.5;
const STORMSURGE_DELAY_SECONDS = 2;
const STORMSURGE_COOLDOWN_SECONDS = 30;

function stormsurgeRuntime(): ItemRuntime {
  let windowStartedAt = -Infinity;
  let accumulated = 0;
  let readyAt = 0;
  return {
    onHitLanded(ctx, hit) {
      if (hit.mitigated <= 0) return;
      // Squall is a champion-only debuff, so nothing accrues against anything
      // else and the counter is left alone rather than filled up in vain.
      if (ctx.target.unitType !== 'champion') return;
      if (ctx.time < readyAt) return;

      /*
       * The rolling 2.5 s window is modelled as a bucket that empties once it
       * is older than the window, which is the same simplification Electrocute
       * already uses in `runes.ts` for its 3 s window. It can undercount at the
       * seam — damage falling just before a reset is forgotten rather than
       * sliding out one hit at a time — and it never overcounts, so a reported
       * proc is always one the player would really get.
       *
       * The accumulator sees only what the engine reports as a landed hit, and
       * the engine deliberately does not report item and rune procs as hits.
       * Damage from other items therefore does not count towards the threshold
       * here, where in game it would.
       */
      if (ctx.time - windowStartedAt > STORMSURGE_WINDOW_SECONDS) {
        windowStartedAt = ctx.time;
        accumulated = 0;
      }
      accumulated += hit.mitigated;

      const threshold = ctx.targetMaxHealth * STORMSURGE_HEALTH_THRESHOLD;
      if (accumulated < threshold) return;

      readyAt = ctx.time + STORMSURGE_COOLDOWN_SECONDS;
      accumulated = 0;
      windowStartedAt = -Infinity;

      // Riot's calculation reads ability power when the strike resolves; this
      // reads it when Squall is applied, two seconds earlier. The two differ
      // only if ability power changes inside those two seconds, which no item
      // or rune this calculator models does.
      const amount = STORMSURGE_BASE_DAMAGE + STORMSURGE_AP_RATIO * ctx.stats.abilityPower;

      ctx.addEvent({
        kind: 'info',
        label: 'Stormsurge · Squall',
        detail:
          `${(STORMSURGE_HEALTH_THRESHOLD * 100).toFixed(0)}% of maximum health dealt · ` +
          `strikes for ${amount.toFixed(0)} in ${STORMSURGE_DELAY_SECONDS} s`,
      });

      ctx.scheduleDamage({
        afterSeconds: STORMSURGE_DELAY_SECONDS,
        sourceId: 'item:4646',
        sourceLabel: 'Stormsurge · Squall',
        sourceKind: 'item',
        type: 'magic',
        amount,
        notes: [
          `${STORMSURGE_BASE_DAMAGE} + ${(STORMSURGE_AP_RATIO * 100).toFixed(0)}% of ` +
            `${ctx.stats.abilityPower.toFixed(0)} AP`,
        ],
      });
    },
  };
}

const STORMSURGE: ItemEffect = {
  id: '4646',
  name: 'Stormsurge',
  modelled: true,
  note:
    'Stormraider: dealing 25% of a champion\'s maximum health within 2.5 s applies Squall, which strikes 2 s later ' +
    'for 125 (+10% AP) magic damage. 30 s cooldown. The threshold counts only damage the engine reports as a landed ' +
    'hit, which excludes other items\' procs.',
  createRuntime: stormsurgeRuntime,
};

/* ---------------------------------------------------------------- the family */

/**
 * The sourced numbers, exposed for the tests.
 *
 * The tests do not take these as their expected values — a test that reads the
 * runtime's own constant back proves only that one number equals itself, so
 * every item's expected damage is spelled out there as arithmetic on Riot's
 * literals. What these are for is the *shape* of a case: how many ticks to
 * expect, how far apart, which threshold a target has to be under.
 */
export const ABILITY_ITEM_NUMBERS = {
  lichBane: LICH_BANE_NUMBERS,
  duskAndDawn: DUSK_AND_DAWN_NUMBERS,
  shadowflame: {
    healthThreshold: SHADOWFLAME_HEALTH_THRESHOLD,
    damageAmp: SHADOWFLAME_DAMAGE_AMP,
  },
  ludens: {
    baseDamage: LUDENS_ECHO_BASE_DAMAGE,
    apRatio: LUDENS_ECHO_AP_RATIO,
    maxCharges: LUDENS_ECHO_MAX_CHARGES,
    repeatFraction: LUDENS_ECHO_REPEAT_FRACTION,
    repeatIntervalSeconds: LUDENS_ECHO_REPEAT_INTERVAL_SECONDS,
    cooldownSeconds: LUDENS_COOLDOWN_SECONDS,
  },
  malignance: {
    damagePerSecond: MALIGNANCE_DAMAGE_PER_SECOND,
    apRatioPerSecond: MALIGNANCE_AP_RATIO_PER_SECOND,
    burnSeconds: MALIGNANCE_BURN_SECONDS,
    tickSeconds: MALIGNANCE_TICK_SECONDS,
    ticks: MALIGNANCE_TICKS,
  },
  stormsurge: {
    baseDamage: STORMSURGE_BASE_DAMAGE,
    apRatio: STORMSURGE_AP_RATIO,
    healthThreshold: STORMSURGE_HEALTH_THRESHOLD,
    windowSeconds: STORMSURGE_WINDOW_SECONDS,
    delaySeconds: STORMSURGE_DELAY_SECONDS,
    cooldownSeconds: STORMSURGE_COOLDOWN_SECONDS,
  },
} as const;

export const ABILITY_ITEMS: ItemEffect[] = [
  LICH_BANE,
  DUSK_AND_DAWN,
  SHADOWFLAME,
  LUDENS_ECHO,
  MALIGNANCE,
  STORMSURGE,
];
