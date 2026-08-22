/**
 * Penetration, resistance shred, and the amplifiers that read a health bar.
 *
 * The most important thing in this file is what it does *not* contain. The
 * description parser in `items.ts` already lifts "18% Armor Penetration",
 * "40% Magic Penetration", "15 Magic Penetration" and "15 Lethality" out of Data
 * Dragon's `<stats>` block (`LABEL_TO_STAT`, `PERCENT_VARIANT`, `FRACTION_STATS`)
 * and the engine spends those stats in the right order — percent penetration
 * multiplies the resistance, lethality is subtracted afterwards, and neither is
 * applied to an already-negative resistance (`effectiveResistance` in
 * `engine/damage.ts`). A build holding Last Whisper or Void Staff therefore
 * already meets armour and magic resistance with the right multiplier before any
 * code here runs, and declaring those numbers again in `ItemEffect.stats` would
 * count them twice. That is why the whole-item penetration staples have no entry
 * below, and why no entry below declares a `stats` block at all.
 *
 * That claim holds for a build of several penetration items and not only for one
 * at a time, which is worth writing down because this file is the first thing in
 * the codebase to put percent penetration into the stat block *dynamically*
 * (Terminus, below) and the obvious suspicion is that two sources get added:
 *
 *  - They do not. `sumStats` (`model/stats.ts`) keeps `armorPenPercent`,
 *    `magicPenPercent` and `tenacity` in a `MULTIPLICATIVE_STATS` set and
 *    composes them as `1 − Π(1 − v)` instead of adding them, so 10% from
 *    Terminus's buff on top of a 35% stat line is spent as
 *    1 − (1 − 0.10)(1 − 0.35) = 41.5% and not 45%. `currentStats()` passes
 *    `input.bonusStats` and each temporary-stat entry as separate blocks
 *    (`engine/simulate.ts`), and `runBuild.ts` passes one block per item, so
 *    every pair of sources meets that rule. `resolveChampionStats` then only
 *    clamps the composed figure to 0…1. A test pins the composition rather than
 *    trusting this paragraph.
 *  - Percent armour *reduction* is composed the same way one layer down:
 *    `combinedShred()` does `remaining *= 1 - clamp01(shred.percent)`. Flat
 *    reductions, by contrast, are summed — which is why Flesheater below has to
 *    hand its whole running total to one shred entry instead of one entry per
 *    stack.
 *  - Riot would not allow two of these items anyway, which is worth knowing
 *    before hunting for a stacking bug that cannot occur in a legal build:
 *    `Items/ItemGroups/LastWhisper` and `Items/ItemGroups/VoidPen` are both
 *    `mMaxGroupOwnable: 1`, and `Items/3302` (Terminus) belongs to both.
 *    Verified this run: LastWhisper holds 3033, 3035, 3036, 3071, 3302, 6694 and
 *    4015 (plus their mode copies and 228005); VoidPen holds 3135, 3137, 3302,
 *    4010, 4015, 4630 and 8010 (plus copies). `resolvePurchasableItems` enforces
 *    no group rule, so the app will happily hand the engine an illegal loadout —
 *    it just no longer follows that the number would be wrong.
 *
 * What is left for this file is the part Riot writes as prose rather than as a
 * stat line: the penetration a fight has to be earned into, the flat shred an
 * on-hit applies, damage that scales with a health pool, and the amplifiers that
 * read the target's health bar.
 *
 * Reachability policy, applied uniformly below. Several ids here have
 * `maps["11"] === false` in Data Dragon 16.16.1, so `resolvePurchasableItems`
 * (`src/model/items.ts`) drops them and the app's shop never offers them. They
 * are modelled anyway — an id that turns up in a saved build has to behave, and
 * the Arena copies share this family's code for free — and every such entry says
 * so in its `note` (see `NOT_ON_THE_RIFT` below). Unreachability is therefore
 * *not* a reason this file gives for skipping anything; the skip list at the
 * bottom names a missing capability instead.
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
 * split at all, which is worth recording so the next reader does not go looking
 * for one: there is no `mRangedMultiplier` and no `IsRangedCastRequirement`
 * conditional on Terminus's `OnHitDamage`, on Unending Despair's `DrainCalc` or
 * anywhere in `Items/667112`; `Items/8020` and `Items/4015` ship no
 * `mItemCalculations` at all; and Serylda's only calculation is the `PenCalc`
 * tooltip formula for its armour-penetration stat line (`mStat: 29`,
 * `mDisplayAsPercent: true`) on both `Items/6694` and `Items/226694`, which has
 * no ranged branch either. (Riftmaker, by contrast, does ship the conditional
 * shape — `ChampRange` with `IsRangedCastRequirement` — so its absence here is a
 * fact about these items, not about the bin.)
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
   * `outOfCombatSeconds` is an assumption and the only number in this file that
   * is not Riot's. It has to exist: Riot's own text is "Every 4 seconds *while
   * in combat with champions*" and the wiki's is "after *entering* combat", so
   * the counter is armed by entering combat and a re-entry re-arms it — but
   * `Items/2502` ships no combat window (its `mDataValues` are exactly
   * `DrainRange` 650, `Cooldown` 4, `BonusHealthDrainPercentage` 0.03,
   * `HealMultiplier` 2.5). 4 s is the value Riot ships for the same idea where
   * it does ship one: `Items/4633` (Riftmaker) has `SecondsInCombat` 4 and
   * `BuffCounterDuration` 4. Without it a hit landing after an arbitrarily long
   * idle stretch would fire a tick off a timer armed before the idle, which is
   * the exact failure this design exists to avoid.
   *
   * The Arena copy (`Items/222502`) keeps the 3% and adds a flat part its
   * `DrainCalc` writes as a `ByCharLevelInterpolationCalculationPart` from 15 at
   * level 1 to 25 at level 18 (`mStartValue` 15, `mEndValue` 25).
   */
  unendingDespair: {
    intervalSeconds: 4,
    outOfCombatSeconds: 4,
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
   * `SlowAmount` 0.5 instead, which its Data Dragon text also states ("Slow
   * enemies below 50% Health by 50% for 1 second").
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
   * Flesheater — Hack the Meat.
   *
   * Riot resolves the whole passive in Data Dragon 16.16.1: "Dealing damage
   * shreds 3 Armor and Magic Resist for 5 seconds, stacking up to 10 times.
   * Applying stacks has a 1 second cooldown per Ability." `Items/667112`
   * confirms every number — `Shred` 3, `MaxStacks` 10, `ShredStackTime` 5,
   * `ShredInternalCD` 1 — and `Items/447112` ships the identical four, so both
   * ids share one implementation.
   *
   * Which id is which matters here, because this pair is the inverse of every
   * other pair in this family. Data Dragon 16.16.1: 667112 is
   * `maps: {"11": true, …}`, 2500 gold, 55 Adaptive Force / 500 Health — a
   * Summoner's Rift shop item; 447112 is `maps: {"30": true, …}`, 2750 gold,
   * 70 Adaptive Force / 500 Health / 20 Ability Haste — the Arena copy. The bin
   * also carries `LethalityAmount` and `TargetMaxHealthRatio` on both, which
   * neither item's resolved stat line or text mentions; they are read as stale
   * values from an earlier version of the item and are not used.
   */
  flesheater: {
    shredPerStack: 3,
    maxStacks: 10,
    stackSeconds: 5,
    internalCooldownSeconds: 1,
    summonersRift: { id: '667112' },
    arena: { id: '447112' },
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
   */
  perplexity: {
    id: '4015',
    maxBonusDamagePercent: 0.15,
    maxHealthDifference: 3000,
  },
} as const;

/* ------------------------------------------------------------------- helpers */

/**
 * The ids in this file that Data Dragon 16.16.1 ships with
 * `maps["11"] === false`, checked against `item.json` this run: the map-30
 * (Arena) copies 223302, 228020, 222502, 226694 and 447112, plus 4015
 * Perplexity, which has no Rift entry of its own at all.
 *
 * They are modelled under the policy stated in the header; the set exists so the
 * fact appears in the entry's own note rather than only in a header a reader of
 * one entry never gets to.
 */
const NOT_ON_THE_RIFT: ReadonlySet<string> = new Set([
  '223302',
  '228020',
  '222502',
  '226694',
  '447112',
  '4015',
]);

function shopNote(id: string): string {
  return NOT_ON_THE_RIFT.has(id)
    ? ' Not on a Summoner\'s Rift shelf in patch 16.16.1 (maps["11"] === false), so the shop never offers it;' +
        ' modelled anyway so a saved build holding the id still behaves.'
    : '';
}

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
 * 4. The Light half grants armour and magic resistance to the wearer
 *    (`Items/3302` → `ARMRPerHitScaling`, 6 at level 1 with +1 at 11 and +1 at
 *    14, and `ARMRMaxScaling` = three times that). Nothing in an attacker-side
 *    simulation can spend resistances, and giving them their own
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
      'attacker-side model has nothing to spend.' +
      shopNote(id),
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
      'damage. Vi is melee, so her target is always inside the aura.' +
      shopNote(id),
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
 * through an idle stretch the game would have dropped combat in.
 *
 * Which is why the runtime keeps `lastHitAt` as well as `nextTickAt`: driving
 * the tick off hits is only honest if the counter is *re-armed* when combat is
 * re-entered. A gap longer than `outOfCombatSeconds` between two qualifying hits
 * is read as combat having dropped, and the next hit starts a fresh four
 * seconds instead of cashing in a timer armed before the idle. The window is an
 * assumption; the constant's comment says where the 4 s comes from.
 *
 * The remaining cost is that a tick lands on the first hit at or after the
 * four-second mark rather than exactly on it — for Vi, whose attacks come well
 * under a second apart, that is a fraction of a second late.
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
      `${numbers.bonusHealthRatio * 100}% of bonus health as magic damage. Combat is assumed to drop after ` +
      `${numbers.outOfCombatSeconds} s without a hit, which re-arms the interval. The heal for ` +
      `${numbers.healMultiplier * 100}% of it is not counted: the simulation has no way to report healing.` +
      shopNote(id),
    createRuntime(): ItemRuntime {
      let lastHitAt = -Infinity;
      let nextTickAt = Infinity;
      return {
        onHitLanded(ctx, hit) {
          // A hit that did nothing, or that landed on a minion, is not the
          // fight this passive asks for.
          if (hit.mitigated <= 0) return;
          if (ctx.target.unitType !== 'champion') return;

          /*
           * Entering combat arms the counter; the first hit of the simulation
           * qualifies because `lastHitAt` starts at -Infinity. Note that this
           * also swallows the tick — `nextTickAt` is set one interval into the
           * future, so the `ctx.time < nextTickAt` guard below returns.
           */
          if (ctx.time - lastHitAt > numbers.outOfCombatSeconds) {
            nextTickAt = ctx.time + numbers.intervalSeconds;
          }
          lastHitAt = ctx.time;

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
      "because the combo's timing depends on it; the item's armor penetration is a parsed stat line." +
      shopNote(id),
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

/* ---------------------------------------------------------------- Flesheater */

/**
 * Flesheater — Hack the Meat, the armour half.
 *
 * Half of this passive is expressible and half is not, and the split is worth
 * being explicit about because the item's text does not distinguish them:
 *
 *  - The 3 armour per stack is a *flat armour reduction*, which is exactly
 *    `ctx.applyArmorShred({ flat })`. It reaches `mitigate` as
 *    `armor.flatReduction`, subtracted before percent reduction and before any
 *    penetration (`effectiveResistance` in `engine/damage.ts`), which is Riot's
 *    own order. That half is modelled here.
 *  - The equal 3 magic resist per stack is **not** counted. `applyDamage` builds
 *    the magic-resist input with `flatReduction: 0, percentReduction: 0`
 *    hard-coded, so the engine has no slot for it, and writing it in as
 *    `magicPenPercent` would be wrong — penetration is attacker-side and does
 *    not compose with the target's other attackers the way reduction does. Vi's
 *    magic damage in a Flesheater build is therefore understated by whatever the
 *    shred would have removed.
 *
 * Two further simplifications, both stated rather than hidden:
 *
 *  - `ShredInternalCD` 1 ("Applying stacks has a 1 second cooldown per Ability")
 *    is not modelled. It is *per ability*, and `HitInfo` carries `sourceId`,
 *    `sourceKind`, `type`, `isAbilityDamage` and `triggersOnHit` but no
 *    `AbilitySlot`, so a runtime cannot tell one ability's hits from another's
 *    and a single shared 1 s gate would be a different rule from Riot's. Every
 *    qualifying hit therefore applies a stack, which reaches 10 stacks sooner
 *    than the game does when several hits land inside one second.
 *  - Cannibalize ("On Champion Takedown, steal 10% of their stats and size for
 *    the rest of the round") has no hook: there is no takedown event, and the
 *    simulated target dying ends the combo.
 *
 * The shred is applied under one constant label on purpose. `applyArmorShred`
 * keys its entries by label and `combinedShred()` *sums* the flat parts across
 * entries, so a per-stack label — the shape Black Cleaver uses — would leave ten
 * live entries adding up to 3 + 6 + … + 30 = 165 armour instead of the running
 * total of 30. One label means the entry is refreshed with the new total, which
 * is what the item does.
 */
function flesheater(id: string): ItemEffect {
  const numbers = PENETRATION_CONSTANTS.flesheater;
  const totalShred = numbers.shredPerStack * numbers.maxStacks;
  return {
    id,
    name: 'Flesheater',
    modelled: true,
    note:
      `Hack the Meat: dealing damage shreds ${numbers.shredPerStack} armor for ${numbers.stackSeconds} s, ` +
      `stacking to ${numbers.maxStacks} (−${totalShred} armor). The equal magic resist shred is not counted: ` +
      'the engine builds the magic-resist input with no reduction slot. The ' +
      `${numbers.internalCooldownSeconds} s per-ability cooldown on applying stacks is not modelled either, ` +
      'because a hit does not report which ability it came from. Cannibalize needs a takedown event.' +
      shopNote(id),
    createRuntime(): ItemRuntime {
      let stacks = 0;
      let expiresAt = -Infinity;
      return {
        onHitLanded(ctx, hit) {
          // "Dealing damage": any damage type, but damage that did nothing is
          // not damage dealt.
          if (hit.mitigated <= 0) return;

          // The stacks share one window that every new hit refreshes, the same
          // simplification Terminus's Dark stacks make above.
          if (ctx.time > expiresAt) stacks = 0;
          stacks = Math.min(numbers.maxStacks, stacks + 1);
          expiresAt = ctx.time + numbers.stackSeconds;

          ctx.applyArmorShred({
            flat: numbers.shredPerStack * stacks,
            durationSeconds: numbers.stackSeconds,
            // Constant by necessity — see the note on summed flat entries above.
            label: 'Flesheater · Hack the Meat',
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
    `${PENETRATION_CONSTANTS.perplexity.maxHealthDifference}.` +
    shopNote(PENETRATION_CONSTANTS.perplexity.id),
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
  flesheater(PENETRATION_CONSTANTS.flesheater.summonersRift.id),
  flesheater(PENETRATION_CONSTANTS.flesheater.arena.id),
  PERPLEXITY,
];

/*
 * ------------------------------------------------------------- what is skipped
 *
 * Every penetration-family item this file deliberately has no entry for, and the
 * one thing that blocks it. Reachability is never the reason (see the policy in
 * the header) — each of these is either already covered elsewhere or needs a
 * capability the engine does not have.
 *
 * Already covered, so an entry would double-count or duplicate:
 *  - 3035 Last Whisper (18% Armor Penetration) and 3135 Void Staff (40% Magic
 *    Penetration): pure `<stats>` lines that `items.ts` already parses into
 *    `armorPenPercent` / `magicPenPercent`. No passive text at all.
 *  - 3036 Lord Dominik's Regards: modelled in `src/model/itemEffects.ts`. Worth
 *    flagging for whoever owns that file — its Giant Slayer ramps over a 2000
 *    max-health difference, while `Items/3036` reads `MaxBonusHealth` 1500 on
 *    the target's *bonus* health, and Riot's current text puts no damage type on
 *    the bonus while the implementation restricts it to physical.
 *  - 4645 Shadowflame: Cinderbloom (`HealthThreshold` 0.4,
 *    `SpellItemDamageAmp` 0.2) is implemented in `src/model/items/ability.ts`.
 *    A second copy here would apply the amplifier twice through the registry.
 *
 * Missing a capability:
 *  - 3033 Mortal Reminder: the penetration is a parsed stat line; the passive is
 *    Grievous Wounds. The simulation never heals the target, so anti-heal cannot
 *    reach a damage number and there is no hook to reduce a heal.
 *  - 3137 Cryptbloom: parsed stat line plus Life from Death, a heal that fires
 *    on a takedown. No healing to report (`grantShield` is the only restorative
 *    hook and a shield is not health) and no takedown event — the simulated
 *    target dying ends the combo.
 *  - 6695 Serpent's Fang: lethality is a parsed stat line; Shield Reaver is
 *    `ShieldShred` 50 / `ShieldWounds` 50 for a melee wearer (`ShieldShredRange`
 *    and `ShieldWoundsRange` are 35) over `DebuffDuration` 3 (`Items/6695`).
 *    The target has no shields in this model — shields exist
 *    only on the attacker, via `grantShield` — so there is nothing to reduce.
 *  - 8010 Bloodletter's Curse and its 4010 copy: `ShredPerStack` 0.075,
 *    `MaxStacks` 4, `DebuffDuration` 6, `InternalCD` 0.3 — a 30% magic-resist
 *    shred, the mechanic this family is about and the one the engine cannot
 *    express. `applyArmorShred` is armour-only and `applyDamage` builds the
 *    magic-resist input with `flatReduction: 0, percentReduction: 0` hard-coded.
 *    Faking it as `magicPenPercent` would be wrong: penetration is
 *    attacker-side and does not compose with the target's other attackers the
 *    way reduction does. (Flesheater above loses its magic half to the same gap.)
 *  - 226696 Axiom Arc, Arena copy: "Your Ultimate Abilities deal 20% increased
 *    damage". `AmplifiableHit` carries `sourceId`, `sourceKind`, `type`,
 *    `isAbilityDamage` and `triggersOnHit` but no `AbilitySlot`, so "ultimate
 *    only" cannot be told from "any ability".
 *  - 773035 Last Whisper and 773135 Void Staff, the legacy-mode copies: these
 *    write their penetration into the passive line instead of the `<stats>`
 *    block ("You ignore 35% of your opponent's Armor", "Magic damage ignores 35%
 *    of the target's Magic Resist"), so `ItemEffect.stats` would be the right
 *    home — which is exactly what this file's no-stats invariant forbids, and a
 *    stats-only entry reaches no damage number through any hook.
 *  - 773001 Abyssal Scepter, likewise legacy-mode: "Aura - Despair: Reduces the
 *    Magic Resist of nearby enemies by 20" is a flat magic-resist reduction, and
 *    the engine has no slot for one (same hard-coded zeroes as 8010 above).
 *  - 3001 Evenshroud: settled before any capability argument is needed. Data
 *    Dragon 16.16.1 ships 3001 with every `maps` value false, `inStore: false`
 *    *and* `gold.purchasable: false` — it is not buyable anywhere, on any map,
 *    so no build can contain it. (Had it been buyable, Coruscation's
 *    `AmpAmount` 0.07 for `AmpDuration` 5 s would still need a hook telling an
 *    item that the attacker applied crowd control; `ItemRuntime` sees casts,
 *    hits and attacks only, and `applyCrowdControl` is write-only.)
 */
