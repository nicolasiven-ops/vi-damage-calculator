/**
 * Penetration, resistance shred, and the amplifiers that read a health bar.
 *
 * The most important thing in this file is what it does *not* contain. The
 * description parser in `items.ts` already lifts "18% Armor Penetration",
 * "40% Magic Penetration", "15 Magic Penetration" and "15 Lethality" out of Data
 * Dragon's `<stats>` block (`LABEL_TO_STAT`, `PERCENT_VARIANT`, `FRACTION_STATS`)
 * and the engine already spends those stats in the right order — percent
 * penetration multiplies the resistance, lethality is subtracted afterwards, and
 * neither is applied to an already-negative resistance (`effectiveResistance` in
 * `engine/damage.ts`). A build holding Last Whisper or Void Staff therefore
 * already meets armour and magic resistance with the right multiplier before any
 * code here runs, and declaring those numbers again in `ItemEffect.stats` would
 * count them twice. That is why the whole-item penetration staples have no entry
 * below, and why no entry below declares a `stats` block at all.
 *
 * What is left is the part Riot writes as prose rather than as a stat line: the
 * penetration a fight has to be earned into, damage that scales with a health
 * pool, and the amplifiers that read the target's health bar.
 *
 * Sources, in this project's order of preference:
 *  - Data Dragon `item.json`, patch 16.16.1, for Riot's own resolved text.
 *  - CommunityDragon `items.cdtb.bin.json` (`latest`, file dated 2026-08-16)
 *    wherever that text ships an empty tag instead of a number. Every number
 *    taken from there names the `mDataValues` entry or `mItemCalculations`
 *    formula it came from, so it can be checked against the file.
 *  - The wiki only where Riot resolves nothing, and then quoted verbatim and
 *    marked as the wiki's.
 *
 * Three readings of the bin's stat enum are load-bearing here, and each was
 * calibrated against an item whose text Riot *does* resolve rather than assumed:
 *  - `mStat: 2` with `mStatFormula: 1` is base attack damage — Trinity Force's
 *    `SpellbladeDamage` is exactly that shape with `SpellbladeMultiplier` 2, and
 *    its tooltip says "200% base AD".
 *  - `mStatFormula: 2` is the bonus part of a stat: Endless Hunger (2517) reads
 *    `mStat: 2 / mStatFormula: 2` and says "Ability Haste based on your Bonus
 *    AD", and Riftmaker (4633) reads `mStat: 12 / mStatFormula: 2` with
 *    `HealthToAPConversionPercent` 0.02 for "2% of your bonus Health".
 *  - A formula part carrying a coefficient but no `mStat` at all is ability
 *    power — Nashor's Tooth's `NashorsAPValue` has none.
 *
 * Vi is melee, and where an effect has melee and ranged values the melee one is
 * used. As it turns out none of the passives modelled here has a melee/ranged
 * split at all — no `mRangedMultiplier` on Terminus's `OnHitDamage` or Unending
 * Despair's `DrainCalc`, and the other three items carry no calculation to split
 * — which is worth recording so the next reader does not go looking for one.
 */

import type { AmplifiableHit, ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';

export const PENETRATION_CONSTANTS = {
  /**
   * Terminus — Shadow and Juxtaposition.
   *
   * Riot's text for Shadow is "Attacks deal <magicDamage> bonus magic
   * damage</magicDamage> <OnHit>On-Hit</OnHit>": the amount is an empty tag, so
   * it comes from `Items/3302` → `mItemCalculations.OnHitDamage`, which is 30
   * plus a 0.1 coefficient on `mStat: 2 / mStatFormula: 2` (bonus attack damage)
   * plus a 0.1 coefficient on a part with no `mStat` (ability power). The wiki
   * agrees verbatim — "Basic attacks deal 30 (+10% bonus AD) (+ 10% AP) bonus
   * magic damage on-hit." — and the calculation carries no `mRangedMultiplier`,
   * so melee and ranged get the same number.
   *
   * For Juxtaposition, Riot's text gives the 10% per Dark attack and the 5 s
   * duration but not the cap; `mDataValues` gives all three: `PenPerHit` 0.1,
   * `PenMax` 0.3, `BuffDuration` 5. The Arena copy (`Items/223302`) is the same
   * on-hit formula with a weaker buff — `PenPerHit` 0.08, `PenMax` 0.24 — which
   * Data Dragon's text for 223302 confirms ("Dark Attacks grant 8% Armor
   * Penetration and Magic Penetration for 5s").
   */
  terminus: {
    onHitFlat: 30,
    onHitBonusAdRatio: 0.1,
    onHitAbilityPowerRatio: 0.1,
    buffSeconds: 5,
    summonersRift: { id: '3302', penPerDarkHit: 0.1, penCap: 0.3 },
    arena: { id: '223302', penPerDarkHit: 0.08, penCap: 0.24 },
  },
  /**
   * Abyssal Mask — Unmake.
   *
   * "Nearby enemy champions take 12% more magic damage" is Riot's own resolved
   * text, and `Items/8020` backs both halves of it: `DamageAmp` 0.12 and
   * `Radius` 700. The Arena copy (`228020`) and the third id Data Dragon ships
   * (`328020`, purchasable on map 11) hold exactly the same two values, so all
   * three share one implementation.
   */
  abyssalMask: {
    ids: ['8020', '228020', '328020'],
    amplification: 0.12,
    radius: 700,
  },
  /**
   * Unending Despair — Anguish.
   *
   * Riot's text names the interval and the heal but leaves the damage as an
   * empty tag. `Items/2502` supplies it: `Cooldown` 4, `DrainRange` 650,
   * `HealMultiplier` 2.5, and `DrainCalc` = `BonusHealthDrainPercentage` 0.03 on
   * `mStat: 12 / mStatFormula: 2` — the wearer's *bonus* health, not maximum
   * health. The wiki says the same thing in words: "Every 4 seconds after
   * entering combat with champions, sap all enemy champions around you within
   * 650 units to deal magic damage equal to 3% of your bonus health to them and
   * heal yourself equal to 250% of the post-mitigation damage dealt."
   *
   * The Arena copy (`Items/222502`) keeps the 3% and adds a flat part its
   * `DrainCalc` writes as a `ByCharLevelInterpolationCalculationPart` from 15 at
   * level 1 to 25 at level 18.
   */
  unendingDespair: {
    intervalSeconds: 4,
    bonusHealthRatio: 0.03,
    healMultiplier: 2.5,
    radius: 650,
    summonersRift: { id: '2502' },
    arena: { id: '222502', flatAtLevel1: 15, flatAtLevel18: 25 },
  },
  /**
   * Serylda's Grudge — Bitter Cold.
   *
   * "Damaging Abilities Slow enemies below 50% Health by 30% for 1 second" is
   * Riot's own text and `Items/6694` matches it exactly: `SlowAmount` 0.3,
   * `SlowDuration` 1, `SlowThreshold` 0.5. The Arena copy (`226694`) slows for
   * `SlowAmount` 0.5 instead, which its Data Dragon text also states.
   *
   * The item's 35% armour penetration is a `<stats>` line and is deliberately
   * absent from this file.
   */
  seryldasGrudge: {
    slowSeconds: 1,
    healthThreshold: 0.5,
    summonersRift: { id: '6694', slowPercent: 0.3 },
    arena: { id: '226694', slowPercent: 0.5 },
  },
  /**
   * Perplexity — Giant Slayer.
   *
   * The Giant Slayer this family owns, and not a copy of the one already
   * modelled for Lord Dominik's Regards: Riot's data has the two read different
   * pools. `Items/3036` holds `MaxBonusHealth` 1500 and its text says "based on
   * their bonus Health", while `Items/4015` holds `MaxHealthDifference` 3000 and
   * its text says "against champions with greater max Health than you. Max
   * damage increase reached when Health difference is greater than 3000". Both
   * cap at `MaxBonusDamagePercent` 0.15.
   *
   * Neither Riot's text nor the bin restricts the bonus to a damage type, and
   * the wiki agrees: "Deal 0% – 15% (based on maximum health difference)
   * increased damage against enemy champions with greater maximum health than
   * you." So this amplifier applies to physical, magic and true damage alike,
   * and only against champions.
   *
   * Data Dragon 16.16.1 marks 4015 as `maps["11"] === false`, so the shop the
   * app builds from `resolvePurchasableItems` never offers it. The passive is
   * still modelled, because an id that turns up in a build has to behave, and
   * because the mechanic is the one this family is about.
   */
  perplexity: {
    id: '4015',
    maxBonusDamagePercent: 0.15,
    maxHealthDifference: 3000,
  },
} as const;

/* ------------------------------------------------------------------- helpers */

/**
 * Riot's level interpolation: the straight line from the level-1 value to the
 * level-18 one, which is what `ByCharLevelInterpolationCalculationPart` means.
 * The same shape `runes.ts` and Wit's End already use, so the two agree.
 */
function byLevel(atLevel1: number, atLevel18: number, level: number): number {
  const t = (Math.min(18, Math.max(1, level)) - 1) / 17;
  return atLevel1 + (atLevel18 - atLevel1) * t;
}

/* ------------------------------------------------------------------ Terminus */

/**
 * Terminus.
 *
 * Shadow is an ordinary on-hit rider. Juxtaposition is the interesting half:
 * every second attack on a champion grants penetration, so a combo's later hits
 * meet less resistance than its first ones and the item is worth more the longer
 * the fight runs.
 *
 * Four modelling decisions, all visible in the numbers this produces:
 *
 * 1. The alternation starts with Light. Neither Riot's data nor the wiki says
 *    which side the first attack takes — the bin holds the two buffs but no
 *    order — so the model follows the order Riot's own tooltip lists them in.
 *    The consequence is that penetration appears on the second, fourth and sixth
 *    attack rather than the first, third and fifth.
 * 2. The stacks share one 5 s window that each Dark attack refreshes, rather
 *    than expiring one at a time. This is the same simplification Black
 *    Cleaver's implementation makes and for the same reason: Dark attacks arrive
 *    every second swing, well inside 5 s, so the two models can only differ
 *    after the attacker has already stopped attacking.
 * 3. The penetration is in place for the Shadow rider of the very attack that
 *    granted it, because the engine resolves an attack's own damage before it
 *    asks items for their riders. In game both happen inside one on-hit event
 *    and the order within it is not observable.
 * 4. The Light half grants armour and magic resistance to the wearer. Nothing in
 *    an attacker-side simulation can spend those, and giving them their own
 *    temporary-stat entry would evict the Dark one: `applyTemporaryStats` treats
 *    the text before the ' · ' as a buff's identity, so two entries both named
 *    after this item are one buff. Light attacks therefore only advance the
 *    alternation.
 */
function terminus(id: string, penPerDarkHit: number, penCap: number): ItemEffect {
  const numbers = PENETRATION_CONSTANTS.terminus;
  const maxStacks = Math.round(penCap / penPerDarkHit);
  return {
    id,
    name: 'Terminus',
    modelled: true,
    note:
      `Shadow: on-hit ${numbers.onHitFlat} + ${numbers.onHitBonusAdRatio * 100}% bonus AD + ` +
      `${numbers.onHitAbilityPowerRatio * 100}% AP as magic damage. Juxtaposition: every second attack on a ` +
      `champion is a Dark one and grants ${penPerDarkHit * 100}% armor and magic penetration for ` +
      `${numbers.buffSeconds} s, stacking to ${penCap * 100}%. The Light half grants resistances, which an ` +
      'attacker-side model has nothing to spend.',
    createRuntime(): ItemRuntime {
      let penetration = 0;
      let penetrationUntil = -Infinity;
      // Riot's tooltip lists Light before Dark, so the first attack is Light.
      let nextAttackIsDark = false;

      return {
        onBasicAttack(ctx): ItemAttackRider {
          // "Alternate between Light and Dark Attacks against champions": a
          // minion or a monster advances nothing.
          if (ctx.target.unitType === 'champion') {
            const dark = nextAttackIsDark;
            nextAttackIsDark = !nextAttackIsDark;
            if (dark) {
              // A window that has run out starts again from a single stack.
              if (ctx.time > penetrationUntil) penetration = 0;
              penetration = Math.min(penCap, penetration + penPerDarkHit);
              penetrationUntil = ctx.time + numbers.buffSeconds;
              const stacks = Math.round(penetration / penPerDarkHit);
              ctx.applyTemporaryStats({
                /*
                 * One entry carrying the whole total. `applyTemporaryStats`
                 * replaces a buff of the same name rather than adding to it, and
                 * the stacks are additive within the item, so the running total
                 * is what has to be handed over each time.
                 */
                stats: { armorPenPercent: penetration, magicPenPercent: penetration },
                durationSeconds: numbers.buffSeconds,
                label: `Terminus · Dark ${stacks}/${maxStacks}`,
              });
            }
          }

          const amount =
            numbers.onHitFlat +
            numbers.onHitBonusAdRatio * ctx.stats.bonusAttackDamage +
            numbers.onHitAbilityPowerRatio * ctx.stats.abilityPower;
          return {
            amount,
            type: 'magic',
            label: 'Terminus · Shadow',
            notes: [
              `${numbers.onHitFlat} + ${numbers.onHitBonusAdRatio * 100}% bonus AD + ` +
                `${numbers.onHitAbilityPowerRatio * 100}% AP`,
            ],
          };
        },
      };
    },
  };
}

/* -------------------------------------------------------------- Abyssal Mask */

/**
 * Unmake, as an attacker-side amplifier on magic damage.
 *
 * `applyTargetAmplification` would be the wrong facility: it raises every kind
 * of damage the target takes, and Unmake raises only the magic part. Since the
 * simulation has exactly one attacker, amplifying our own magic damage by 12% is
 * the same number the target would take from the aura.
 *
 * The aura reaches 700 units and Vi's attack range is 125, so whatever she is
 * hitting stands inside it. A ranged wearer could sit outside its own aura;
 * this model cannot express that, and for a melee champion it does not arise.
 */
function unmakeAmplification(ctx: SimContext, hit: AmplifiableHit): number {
  // "take 12% more magic damage": physical and true damage are untouched.
  if (hit.type !== 'magic') return 0;
  // "Nearby enemy champions": minions and monsters are not affected.
  if (ctx.target.unitType !== 'champion') return 0;
  return PENETRATION_CONSTANTS.abyssalMask.amplification;
}

function abyssalMask(id: string): ItemEffect {
  const numbers = PENETRATION_CONSTANTS.abyssalMask;
  return {
    id,
    name: 'Abyssal Mask',
    modelled: true,
    note:
      `Unmake: enemy champions within ${numbers.radius} units take ${numbers.amplification * 100}% more magic ` +
      'damage. Vi is melee, so her target is always inside the aura.',
    amplify: unmakeAmplification,
  };
}

/* ---------------------------------------------------------- Unending Despair */

/**
 * Unending Despair.
 *
 * The damage is modelled; the heal is not, and cannot be — `grantShield` is the
 * only restorative hook a context offers and a shield is not health, so there is
 * no honest place to put "heal for 250% of the damage dealt". The note says so
 * out loud rather than letting a third of the item disappear quietly.
 *
 * The tick is driven by damage landing rather than by a timer scheduled in
 * advance, and that is deliberate. "In combat with champions" is a state the
 * simulation does not track, but a hit that just landed on a champion is proof
 * of it, whereas five ticks scheduled from the first hit would keep ticking
 * through an idle stretch the game would have dropped combat in. The cost is
 * that a tick lands on the first hit at or after the four-second mark rather
 * than exactly on it — for Vi, whose attacks come well under a second apart,
 * that is a fraction of a second late.
 */
function unendingDespair(id: string, flat?: { atLevel1: number; atLevel18: number }): ItemEffect {
  const numbers = PENETRATION_CONSTANTS.unendingDespair;
  return {
    id,
    name: 'Unending Despair',
    modelled: true,
    note:
      `Anguish: every ${numbers.intervalSeconds} s in combat with a champion, ` +
      (flat ? `${flat.atLevel1}–${flat.atLevel18} by level plus ` : '') +
      `${numbers.bonusHealthRatio * 100}% of bonus health as magic damage. The heal for ` +
      `${numbers.healMultiplier * 100}% of it is not counted: the simulation has no way to report healing.`,
    createRuntime(): ItemRuntime {
      let nextTickAt = Infinity;
      return {
        onHitLanded(ctx, hit) {
          // A hit that did nothing, or that landed on a minion, is not the
          // fight this passive asks for.
          if (hit.mitigated <= 0) return;
          if (ctx.target.unitType !== 'champion') return;

          if (nextTickAt === Infinity) {
            // The first tick is one interval after combat starts, not at once.
            nextTickAt = ctx.time + numbers.intervalSeconds;
            return;
          }
          if (ctx.time < nextTickAt) return;
          nextTickAt = ctx.time + numbers.intervalSeconds;

          const fromHealth = numbers.bonusHealthRatio * ctx.stats.bonusHealth;
          const base = flat ? byLevel(flat.atLevel1, flat.atLevel18, ctx.stats.level) : 0;
          ctx.dealDamage({
            sourceId: `item:${id}`,
            sourceLabel: 'Unending Despair · Anguish',
            sourceKind: 'item',
            type: 'magic',
            amount: base + fromHealth,
            notes: [
              ...(flat ? [`${base.toFixed(0)} at level ${ctx.stats.level}`] : []),
              `${numbers.bonusHealthRatio * 100}% of ${ctx.stats.bonusHealth.toFixed(0)} bonus health`,
              `the ${numbers.healMultiplier * 100}% heal is not modelled`,
            ],
          });
        },
      };
    },
  };
}

/* ---------------------------------------------------------- Serylda's Grudge */

/**
 * Serylda's Grudge.
 *
 * Bitter Cold adds no damage: the item's contribution to a damage number is its
 * 35% armour penetration, which is a stat line the parser already reads. It is
 * modelled anyway, because the timeline is part of the answer — a combo whose
 * last hits only connect because the target was slowed reads differently from
 * one that assumes the target stood still. `applyCrowdControl` exists for
 * exactly this and is documented as changing no number.
 *
 * Two assumptions, stated because Riot's data settles neither. The health check
 * uses the target's health *after* the hit, which is both the value the engine
 * reports to a runtime and the moment the game applies a debuff, so an ability
 * that takes the target across 50% slows immediately. And the slow is recorded
 * again only once its second has run out, since re-applying an active slow
 * extends it rather than being a second event worth a second bar.
 */
function seryldasGrudge(id: string, slowPercent: number): ItemEffect {
  const numbers = PENETRATION_CONSTANTS.seryldasGrudge;
  return {
    id,
    name: "Serylda's Grudge",
    modelled: true,
    note:
      `Bitter Cold: damaging abilities slow a target below ${numbers.healthThreshold * 100}% health by ` +
      `${slowPercent * 100}% for ${numbers.slowSeconds} s. It changes no damage number and is on the timeline ` +
      "because the combo's timing depends on it; the item's armor penetration is a parsed stat line.",
    createRuntime(): ItemRuntime {
      let slowedUntil = -Infinity;
      return {
        onHitLanded(ctx, hit) {
          if (!hit.isAbilityDamage || hit.mitigated <= 0) return;
          if (hit.targetHealthPercentAfter >= numbers.healthThreshold) return;
          if (ctx.time < slowedUntil) return;
          slowedUntil = ctx.time + numbers.slowSeconds;
          ctx.applyCrowdControl({
            label: 'Slowed',
            durationSeconds: numbers.slowSeconds,
            detail: `Serylda's Grudge · Bitter Cold · ${slowPercent * 100}% slow`,
          });
        },
      };
    },
  };
}

/* ----------------------------------------------------------------- Perplexity */

/**
 * Giant Slayer, as Perplexity's data defines it.
 *
 * Stateless, so it lives on `ItemEffect.amplify` rather than in a runtime: the
 * bonus reads two maximum-health pools and needs no memory of the fight. The
 * ramp between 0% and the cap is linear in the health difference: that is what
 * the wiki's "0% – 15% (based on maximum health difference)" together with the
 * bin's single `MaxHealthDifference` breakpoint describes. It is spelled out as
 * an assumption because Riot ships the cap and the breakpoint but not the curve
 * between them.
 *
 * The hit is not inspected because Riot's text puts no damage type on the bonus.
 * That is the whole reason this reads as an unconditional multiplier: the same
 * 15% lands on a basic attack, on Vault Breaker, and on an item's magic on-hit.
 */
const PERPLEXITY: ItemEffect = {
  id: PENETRATION_CONSTANTS.perplexity.id,
  name: 'Perplexity',
  modelled: true,
  note:
    `Giant Slayer: up to ${PENETRATION_CONSTANTS.perplexity.maxBonusDamagePercent * 100}% more damage of every ` +
    `type against a champion with more maximum health than Vi, reaching the cap at a difference of ` +
    `${PENETRATION_CONSTANTS.perplexity.maxHealthDifference}. Not a Summoner's Rift item in patch 16.16.1.`,
  amplify(ctx) {
    const numbers = PENETRATION_CONSTANTS.perplexity;
    // "against enemy champions": a monster with a huge health pool grants
    // nothing, which is what keeps this out of jungle clear numbers.
    if (ctx.target.unitType !== 'champion') return 0;
    const excess = ctx.targetMaxHealth - ctx.stats.maxHealth;
    if (excess <= 0) return 0;
    return Math.min(
      numbers.maxBonusDamagePercent,
      (excess / numbers.maxHealthDifference) * numbers.maxBonusDamagePercent,
    );
  },
};

/* ----------------------------------------------------------------- the array */

export const PENETRATION_ITEMS: ItemEffect[] = [
  terminus(
    PENETRATION_CONSTANTS.terminus.summonersRift.id,
    PENETRATION_CONSTANTS.terminus.summonersRift.penPerDarkHit,
    PENETRATION_CONSTANTS.terminus.summonersRift.penCap,
  ),
  terminus(
    PENETRATION_CONSTANTS.terminus.arena.id,
    PENETRATION_CONSTANTS.terminus.arena.penPerDarkHit,
    PENETRATION_CONSTANTS.terminus.arena.penCap,
  ),
  ...PENETRATION_CONSTANTS.abyssalMask.ids.map((id) => abyssalMask(id)),
  unendingDespair(PENETRATION_CONSTANTS.unendingDespair.summonersRift.id),
  unendingDespair(PENETRATION_CONSTANTS.unendingDespair.arena.id, {
    atLevel1: PENETRATION_CONSTANTS.unendingDespair.arena.flatAtLevel1,
    atLevel18: PENETRATION_CONSTANTS.unendingDespair.arena.flatAtLevel18,
  }),
  seryldasGrudge(
    PENETRATION_CONSTANTS.seryldasGrudge.summonersRift.id,
    PENETRATION_CONSTANTS.seryldasGrudge.summonersRift.slowPercent,
  ),
  seryldasGrudge(
    PENETRATION_CONSTANTS.seryldasGrudge.arena.id,
    PENETRATION_CONSTANTS.seryldasGrudge.arena.slowPercent,
  ),
  PERPLEXITY,
];
