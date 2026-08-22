/**
 * On-hit riders and attack-speed stackers.
 *
 * Same contract as the passives in `../itemEffects`: keyed by Data Dragon item
 * id, damage expressed through the hooks the simulation offers, and an item
 * whose passive those hooks cannot reach is left out of the array entirely so
 * the app keeps reporting it as unmodelled instead of quietly under- or
 * over-counting it.
 *
 * Where the numbers come from, in the order they were preferred:
 *  - Data Dragon's resolved item text for the tracked patch,
 *    https://ddragon.leagueoflegends.com/cdn/16.16.1/data/en_US/item.json —
 *    it prints "15 bonus physical damage" for Recurve Bow and "30 bonus magic
 *    damage" for Guinsoo's, so those are Riot's own resolved figures.
 *  - The game's item bin, where Data Dragon prints prose instead of a number:
 *    https://raw.communitydragon.org/latest/game/items.cdtb.bin.json, entries
 *    `Items/<id>` (dump dated 2026-08-16). Kraken Slayer's whole passive lives
 *    there; Data Dragon says only "bonus physical damage".
 *  - The wiki, only for what neither Riot source states, quoted verbatim at the
 *    point of use and marked as wiki-sourced each time: the shape of Kraken
 *    Slayer's missing-health ramp, Guinsoo's phantom-stack mechanism, and the
 *    fact that a stack lasts its duration from the attack that granted it rather
 *    than being refreshed by the next one ("grant a stack for 3 seconds, up to 2
 *    stacks" — and where the wiki does mean a refresh it writes one, as in Vi's
 *    own Denting Blows: "refreshing on subsequent applications").
 *
 * Vi is melee, so every melee/ranged split below resolves to the melee value.
 * Kraken Slayer is the only item here that carries one, and it says so at its
 * constant; the flat on-hits are the same number for both.
 *
 * Considered and left out
 * -----------------------
 * The rest of this family reaches no damage number a single-target simulation
 * can honour, so those items have no entry at all and the app goes on reporting
 * their passive as unmodelled. Each is named here with what is missing, because
 * "absent" and "overlooked" have to be told apart:
 *
 *  - Hearthbound Axe (3051) is stat-only. Data Dragon prints 20 attack damage
 *    and 20% attack speed and then an empty tail where a passive block used to
 *    sit, and `Items/3051` in the bin has no `mDataValues`, no
 *    `mItemCalculations` and no `spellName` — its only populated key is an
 *    `mEffectAmount` of eight zeroes. There is nothing left to model.
 *  - Berserker's Greaves (3006) is stat-only too, but not identically, and the
 *    difference is worth stating because the earlier wording here claimed the
 *    two items were the same case. Data Dragon prints 30% attack speed and 45
 *    move speed and no passive block, which is where "no passive" comes from;
 *    the bin is not silent, though. `Items/3006` carries one data value,
 *    `FeatsAS` 0.05 — the Feats of Strength boot upgrade, which is a conditional
 *    stat and not a damage effect (it also has no `mItemCalculations` key at
 *    all). The item stays omitted on the strength of "not a damage effect",
 *    not on the strength of "no data in the bin".
 *  - Tiamat (3077), Ravenous Hydra (3074) and Stridebreaker (6631) carry Cleave,
 *    which spares the only enemy this simulation has. Data Dragon writes it
 *    without a number — "Attacks deal physical damage to nearby enemies" — so
 *    the wiki is quoted for who is hit, verbatim and wiki-sourced: "Basic
 *    attacks on-hit deal (40% AD / 20% AD) physical damage to other enemies in a
 *    350 radius centered around the target." *Other* enemies is the whole
 *    reason for the omission: the target of the attack is not among them, so
 *    against a lone target Cleave adds exactly zero. Riot's own numbers agree
 *    about the size of a bolt that is never fired here —
 *    `MeleeItemCalcValue` is 0.4 × total attack damage on all three, against
 *    `RangedItemCalcValue`'s 0.2.
 *    Their actives do hit the target, and are still left out: Tiamat's Crescent
 *    is `PrimaryDamage` = `ActiveADRatio` 0.75 × total attack damage, Ravenous
 *    Crescent 0.8, Stridebreaker's Breaking Shockwave `SlashDamage` = `ADRatio`
 *    0.8, on a `Cooldown` of 10, 10 and 15 seconds. The missing capability is a
 *    hook, not a number: `ItemRuntime` is offered a basic attack, a champion
 *    ability cast and a landed hit, and a combo has no step that presses an
 *    item, so nothing in this file can be the thing that fires an active.
 *  - Runaan's Hurricane (3085) is the same case one step further out. Riot's own
 *    text sends its bolts at "2 additional enemies near the target", so none of
 *    it reaches a lone target; its size is not settled here because it never
 *    applies (the bin states it twice and not identically — `BoltDamage` as 0.65
 *    × total attack damage, `BoltMinPercent`/`BoltMaxPercent` as 40).
 *
 * Four more Rift items carry Data Dragon's `<OnHit>` keyword and are modelled by
 * no family at all, so their absence is decided here rather than left to a
 * silence (the shop list in `test/fixtures/srItems.ts` is the denominator, and
 * every other `<OnHit>` id in it is registered somewhere):
 *
 *  - Cull (1083). Its Reap is "Restore 3 Health On-Hit" — an on-hit effect that
 *    deals no damage. Nothing this calculator reports would change.
 *  - Ardent Censer (3504) does carry a resolved on-hit damage number, "20 magic
 *    damage On-Hit", but only inside Sanctify, which is granted by "Healing or
 *    Shielding an ally". Vi heals and shields nobody, and the simulation has no
 *    ally, so the trigger can never fire. Missing capability: a second friendly
 *    unit, not a number.
 *  - Dream Maker (3870) is the same gate one step further out — its bonus magic
 *    damage lands on the *ally* it bubbled, not on the owner.
 *  - Bloodsong (3877) is a Spellblade, so it belongs with Sheen, Trinity Force
 *    and Lich Bane in the ability family rather than here, and is named only so
 *    that its absence from this file is a decision. Dusk and Dawn (2510) is the
 *    same case: a Spellblade whose text also re-applies on-hit effects.
 *
 * Terminus (3302) belongs to this family by its Shadow on-hit and is modelled in
 * `./penetration` instead, where its Juxtaposition penetration stacks live; it
 * must not be entered twice. Blade of the Ruined King, Wit's End, Nashor's Tooth
 * and Titanic Hydra are already in `../itemEffects` for the same reason.
 */

/*
 * `AmplifiableHit` is deliberately absent from this import. The brief names it
 * alongside the other three, but nothing in this family amplifies foreign
 * damage — every effect here is its own damage instance — and `noUnusedLocals`
 * rejects an unused type import outright (TS6196). Guinsoo's Phantom Hit was
 * the one candidate: it could have been written as an `amplify` that doubles
 * every item on-hit instance during the attack that triggers it. That was
 * rejected, because riders are applied item by item and an item's
 * `onBasicAttack` runs only when its turn comes: whether another item's rider
 * were doubled would depend on the order of the build, silently.
 */
import type { ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';
import type { SimContext } from '../../engine/context';
import { clamp } from '../stats';

/**
 * The numbers, in one place, so a test can assert against the same value the
 * runtime uses rather than restating it.
 */
export const ONHIT_CONSTANTS = {
  /** Recurve Bow's Sting. `Items/1043` → `OnHitDamage: 15`, physical per Data Dragon. */
  recurveBow: { onHitDamage: 15 },
  /**
   * Rageknife. `Items/6677` → `OnHitDamage: 20` (magic), `AttackSpeedPerStack:
   * 0.05`, `MaxStacks: 3`, `BuffDuration: 3`.
   */
  rageknife: {
    wrathDamage: 20,
    attackSpeedPerStack: 0.05,
    maxStacks: 3,
    stackSeconds: 3,
  },
  /**
   * Guinsoo's Rageblade. `Items/3124` → `OnHitDamage: 30` (magic, and Data
   * Dragon prints the same 30), `AttackSpeedPerStack: 0.08`, `MaxStacks: 4`,
   * `BuffDuration: 3`.
   *
   * The Phantom Hit numbers are not in the bin's data values. Data Dragon's own
   * text carries the rule ("While fully stacked, every third Attack applies
   * On-Hit effects twice") and the wiki carries the mechanism it is built from,
   * quoted at `PHANTOM_HIT` below.
   */
  guinsoo: {
    wrathDamage: 30,
    attackSpeedPerStack: 0.08,
    maxStacks: 4,
    stackSeconds: 3,
    phantomStacks: 2,
    phantomStackSeconds: 6,
    phantomDelaySeconds: 0.15,
  },
  /**
   * Kraken Slayer's Bring It Down. `Items/6672` → `AttackCount: 3`,
   * `BuffDuration: 4`, `MaxAmpNumber: 1.75`, `RangedDamageMultiplier: 0.8`, and
   * `mItemCalculations.DamageAmount` = level-1 value 150 with a breakpoint at
   * level 9 worth 5 per level.
   *
   * `RangedDamageMultiplier` is what makes 150 the *melee* value: ranged
   * champions get 80% of it. Vi is melee, so the multiplier is not applied.
   */
  kraken: {
    attackCount: 3,
    stackSeconds: 4,
    baseAtLevel1: 150,
    breakpointLevel: 9,
    bonusPerLevelFromBreakpoint: 5,
    maxMissingHealthMultiplier: 1.75,
  },
} as const;

/**
 * A level-scaled value in the form Riot's item bin uses: one flat value up to a
 * breakpoint level, then a fixed bonus for every level from the breakpoint on.
 *
 * The reading of "at and after" is calibrated against an item whose resolved
 * text Riot does publish. Locket of the Iron Solari carries `mLevel1Value: 290`
 * with a level-9 breakpoint worth 7 per level, and Data Dragon renders the same
 * shield as "290 - 360 Shield". 360 − 290 = 70 = 7 × 10, so the bonus is paid
 * once for each of levels 9 through 18 — which is the arithmetic below.
 *
 * For Kraken Slayer that gives 150 up to level 8 and 200 at level 18. The wiki
 * states a melee range of 150 – 210 for the same passive; Riot's own data is
 * preferred here, and the discrepancy is noted rather than averaged away.
 */
function byLevelBreakpoint(
  level1Value: number,
  breakpointLevel: number,
  bonusPerLevel: number,
  level: number,
): number {
  const paidLevels = Math.max(0, clamp(level, 1, 18) - (breakpointLevel - 1));
  return level1Value + bonusPerLevel * paidLevels;
}

/* ------------------------------------------------------------------ on-hit riders */

/**
 * The plain shape: a flat number added to every basic attack, no state, no
 * internal cooldown. Recurve Bow is the whole of it.
 */
function flatOnHit(
  id: string,
  name: string,
  passive: string,
  amount: number,
  type: 'physical' | 'magic',
  note: string,
): ItemEffect {
  return {
    id,
    name,
    modelled: true,
    note,
    createRuntime() {
      return {
        onBasicAttack(): ItemAttackRider {
          return {
            amount,
            type,
            label: `${name} · ${passive}`,
            notes: [`${amount} flat ${type} damage on-hit`],
          };
        },
      };
    },
  };
}

/* --------------------------------------------------------------- seething strike */

/**
 * Guinsoo's Rageblade and Rageknife are one mechanic at two sizes: a flat magic
 * on-hit called Wrath, plus Seething Strike, which stacks bonus attack speed
 * for a few seconds per basic attack. Guinsoo's adds the Phantom Hit on top;
 * Rageknife passes `null` and gets the plain version.
 */
interface PhantomHitSpec {
  /** Phantom stacks needed before an attack repeats the on-hit. */
  stacks: number;
  /** How long a phantom stack survives without another attack. */
  stackSeconds: number;
  /** The wiki's stated delay between the attack and the repeated on-hit. */
  delaySeconds: number;
}

interface SeethingStrikeSpec {
  id: string;
  name: string;
  note: string;
  /** Flat magic damage Wrath adds to every basic attack. */
  wrathDamage: number;
  attackSpeedPerStack: number;
  maxStacks: number;
  stackSeconds: number;
  phantomHit: PhantomHitSpec | null;
}

/**
 * Guinsoo's Phantom Hit, as the wiki describes the mechanism Data Dragon
 * summarises as "every third Attack applies On-Hit effects twice":
 *
 * "At maximum stacks, basic attacks on-attack also grant a Phantom stack for 6
 * seconds, up to 2 stacks. At 2 Phantom stacks, the next basic attack consumes
 * all of those stacks on-attack to trigger a Phantom Hit that applies on-hit
 * effects to the target after a 0.15-second delay."
 *
 * That is wiki text, not Riot's: the bin's data values carry the Wrath damage
 * and the attack-speed stacks but nothing about phantom stacks.
 *
 * What is modelled is the part that is exact — the Phantom Hit repeating
 * *this item's own* Wrath damage, as a separate instance 0.15 s later. What is
 * not modelled is the other half, and it is wider than "other items": the wiki's
 * wording is that a Phantom Hit "applies on-hit effects to the target", not
 * *item* on-hit effects, and Data Dragon's own summary is likewise unqualified —
 * "every third Attack applies On-Hit effects twice". Two things are therefore
 * counted once where the game counts them twice:
 *
 *  - any other on-hit item in the build, because there is no hook by which one
 *    item can re-trigger another item's `onBasicAttack`;
 *  - Vi's own Denting Blows, which is the larger term in this calculator and is
 *    not an item at all. The engine advances it from
 *    `ChampionRuntime.onBasicAttackHit` (`simulate.ts`, after the item riders),
 *    and Riot's own W tooltip counts attacks — "Every 3rd Attack on the same
 *    target deals an additional {{ totaldamagetooltip }} max Health physical
 *    damage" — so a real Phantom Hit advances that counter and lands the
 *    %max-health proc more often than this model reports. Nothing here can call
 *    the champion runtime, and a build may well contain no second on-hit item,
 *    so naming only items would point the user at the wrong shortfall.
 *
 * The runtime warns when it fires, naming both, rather than handing over a quiet
 * under-count.
 *
 * One reading had to be chosen: whether the attack that *reaches* maximum
 * Seething stacks already counts as being "at maximum stacks" for the phantom
 * counter. It does here, because both stacks are granted by the same attack in
 * the wiki's wording ("on-attack"), which puts the first Phantom Hit on the
 * sixth attack of an uninterrupted sequence.
 */
const PHANTOM_HIT: PhantomHitSpec = {
  stacks: ONHIT_CONSTANTS.guinsoo.phantomStacks,
  stackSeconds: ONHIT_CONSTANTS.guinsoo.phantomStackSeconds,
  delaySeconds: ONHIT_CONSTANTS.guinsoo.phantomDelaySeconds,
};

function seethingStrike(spec: SeethingStrikeSpec): ItemEffect {
  return {
    id: spec.id,
    name: spec.name,
    modelled: true,
    note: spec.note,
    createRuntime(): ItemRuntime {
      /*
       * Both counters live in this closure, which is where the item's memory
       * belongs: a fresh build gets a fresh runtime, and nothing outside can
       * reach in.
       *
       * Each is a list of the times its stacks were granted, not a count with
       * one shared deadline. Riot's wording is per stack — Guinsoo's is "Attacks
       * grant 8% Attack Speed for 3 seconds. (stacks 4 times)" in Data Dragon,
       * Rageknife the same shape at 5% and 3 stacks, and the wiki's phantom
       * clause is "grant a Phantom stack for 6 seconds, up to 2 stacks". A single
       * window refreshed by every attack diverges in both directions: a sequence
       * with gaps just under the window would hold maximum stacks forever, where
       * in game the oldest stack has already lapsed, and one gap over the window
       * would drop every stack, where in game the younger ones survive. A list of
       * grant times gets both right and costs an array filter per attack.
       */
      let stacks: number[] = [];
      let phantom: number[] = [];

      /** The grants still inside their own window, oldest first. */
      const live = (grants: number[], now: number, window: number): number[] =>
        grants.filter((grantedAt) => grantedAt > now - window);

      return {
        onBasicAttack(ctx: SimContext): ItemAttackRider {
          // At the cap a new stack replaces the oldest, which is why the newest
          // `maxStacks` are kept rather than the count simply being clamped: the
          // dropped stack has to be the one whose timer is furthest along.
          stacks = [...live(stacks, ctx.time, spec.stackSeconds), ctx.time].slice(
            -spec.maxStacks,
          );
          const stackCount = stacks.length;

          /*
           * The buff carries the total for the current stack count, not one
           * stack's worth: `applyTemporaryStats` replaces the stats held under
           * a label rather than adding to them, and the label's identity is the
           * text before the ' · ', so this refreshes one buff bar instead of
           * opening one per stack. That is a presentation decision and not the
           * timer: the stack count above is per stack, and this only means the
           * displayed total steps down at the next attack rather than at the
           * moment a single stack lapses. Nothing reads attack speed between two
           * attacks — the engine rescales the attack timer at the hit, using the
           * value this call just left behind — so the lag changes no number.
           */
          ctx.applyTemporaryStats({
            stats: { attackSpeed: spec.attackSpeedPerStack * stackCount },
            durationSeconds: spec.stackSeconds,
            label: `${spec.name} · Seething Strike ${stackCount}/${spec.maxStacks}`,
          });

          const phantomSpec = spec.phantomHit;
          if (phantomSpec && stackCount >= spec.maxStacks) {
            phantom = live(phantom, ctx.time, phantomSpec.stackSeconds);
            if (phantom.length >= phantomSpec.stacks) {
              // "consumes all of those stacks", so the list empties rather than
              // decrementing by the cost of one Phantom Hit.
              phantom = [];
              ctx.scheduleDamage({
                afterSeconds: phantomSpec.delaySeconds,
                sourceId: `item:${spec.id}`,
                sourceLabel: `${spec.name} · Phantom Hit`,
                sourceKind: 'item',
                type: 'magic',
                amount: spec.wrathDamage,
                notes: [`Wrath applied a second time after ${phantomSpec.delaySeconds} s`],
              });
              ctx.warn(
                `${spec.name}: the Phantom Hit repeats only this item's own on-hit damage. ` +
                  'A real Phantom Hit re-applies every on-hit effect, so both any other ' +
                  "on-hit item in the build and Vi's Denting Blows stack (the champion's " +
                  'own on-basic-attack-hit effect, which no item can re-trigger) are ' +
                  'counted once on that attack instead of twice. This total is short.',
              );
            } else {
              phantom.push(ctx.time);
            }
          }

          return {
            amount: spec.wrathDamage,
            type: 'magic',
            label: `${spec.name} · Wrath`,
            notes: [`${spec.wrathDamage} flat magic damage on-hit`],
          };
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ definitions */

const RECURVE_BOW: ItemEffect = flatOnHit(
  '1043',
  'Recurve Bow',
  'Sting',
  ONHIT_CONSTANTS.recurveBow.onHitDamage,
  'physical',
  'Sting: 15 bonus physical damage on-hit, on every basic attack, with no cooldown.',
);

const RAGEKNIFE: ItemEffect = seethingStrike({
  id: '6677',
  name: 'Rageknife',
  note:
    'Wrath: 20 bonus magic damage on-hit. Seething Strike: 5% attack speed per basic attack for 3 s, up to 3 stacks (15%).',
  wrathDamage: ONHIT_CONSTANTS.rageknife.wrathDamage,
  attackSpeedPerStack: ONHIT_CONSTANTS.rageknife.attackSpeedPerStack,
  maxStacks: ONHIT_CONSTANTS.rageknife.maxStacks,
  stackSeconds: ONHIT_CONSTANTS.rageknife.stackSeconds,
  /*
   * Rageknife has no Phantom Hit. Data Dragon lists Seething Strike for it as
   * attack speed only, and the bin gives it no phantom-stack values.
   */
  phantomHit: null,
});

const GUINSOOS_RAGEBLADE: ItemEffect = seethingStrike({
  id: '3124',
  name: "Guinsoo's Rageblade",
  note:
    "Wrath: 30 bonus magic damage on-hit. Seething Strike: 8% attack speed per basic attack for 3 s, up to 4 stacks (32%); at full stacks every third attack repeats the on-hit. Only this item's own Wrath is repeated — see the warning it raises.",
  wrathDamage: ONHIT_CONSTANTS.guinsoo.wrathDamage,
  attackSpeedPerStack: ONHIT_CONSTANTS.guinsoo.attackSpeedPerStack,
  maxStacks: ONHIT_CONSTANTS.guinsoo.maxStacks,
  stackSeconds: ONHIT_CONSTANTS.guinsoo.stackSeconds,
  phantomHit: PHANTOM_HIT,
});

/**
 * Kraken Slayer.
 *
 * Data Dragon says only "Every third Attack deals bonus physical damage On-Hit,
 * increased based on their missing Health", so every number comes from the bin
 * entry quoted at `ONHIT_CONSTANTS.kraken`.
 *
 * The one thing neither Riot source states is the shape of the increase — the
 * bin gives its endpoint as `MaxAmpNumber: 1.75` but not the curve between. The
 * wiki states it, verbatim: "deal (Melee 150 – 210 / Ranged 120 – 168) (based on
 * level) bonus physical damage on-hit, increased by 0% – 75% (based on target's
 * missing health)". That range is wiki-sourced, and the assumption made of it
 * here is that the increase is linear in missing health: nothing extra at full
 * health, the whole 75% at none. Its endpoint is Riot's own — 1 + 0.75 is
 * exactly `MaxAmpNumber` — but the straight line between the ends is an
 * assumption, not a published formula. The wiki's 210 at level 18 is *not* used;
 * Riot's own level table gives 200, and that is what runs here.
 *
 * The stack window is Riot's `BuffDuration: 4`; the wiki says 3 seconds. Each
 * stack carries its own copy of it (see the runtime), so what the number has to
 * beat is one attack cycle: any Vi build worth simulating attacks well inside
 * 3 s, and the every-third-attack cadence is therefore the same under either
 * figure. Riot's own 4 is what runs.
 */
const KRAKEN_SLAYER: ItemEffect = {
  id: '6672',
  name: 'Kraken Slayer',
  modelled: true,
  note:
    "Bring It Down: every third basic attack deals 150–200 (by level) bonus physical damage on-hit, up to 75% more against a target's missing health.",
  createRuntime() {
    const kraken = ONHIT_CONSTANTS.kraken;
    /*
     * The times the live stacks were granted, not a count with one shared
     * deadline. Riot's wiki is per stack — "Basic attacks on-hit grant a stack
     * for 3 seconds, up to 2 stacks" (wiki-sourced; the bin's own number is
     * `BuffDuration` 4, used below) — and for this item the difference decides
     * whether a whole instance fires (165 at level 11), not the size of a buff.
     * With a single refreshed window, attacks at t=0, t=3.5 and t=7.0 would proc,
     * because each attack pushed the deadline out by another 4 s; in game the
     * first stack expired at t=4, so the t=7.0 attack is only the second live
     * stack and nothing happens.
     */
    let stacks: number[] = [];

    return {
      onBasicAttack(ctx): ItemAttackRider | null {
        stacks = stacks.filter((grantedAt) => grantedAt > ctx.time - kraken.stackSeconds);
        stacks.push(ctx.time);
        if (stacks.length < kraken.attackCount) return null;
        // "consumes all stacks" — the counter empties, it does not carry a
        // remainder into the next cycle.
        stacks = [];

        const base = byLevelBreakpoint(
          kraken.baseAtLevel1,
          kraken.breakpointLevel,
          kraken.bonusPerLevelFromBreakpoint,
          ctx.stats.level,
        );
        /*
         * When the amp samples health is an engine-imposed approximation, not a
         * sourced rule. Neither Riot source says: Data Dragon has only "increased
         * based on their missing Health" and the wiki only "increased by 0% - 75%
         * (based on target's missing health)". What the engine offers is a hook
         * that runs after the attack's damage has landed, so the fraction read
         * here already counts that attack — and, because item riders are applied
         * one after another in build order (`simulate.ts`: each rider's damage is
         * dealt before the next item is asked), it also counts every rider placed
         * before Kraken in the build. The number is therefore mildly dependent on
         * item order, silently, which is the same flaw this file's header cites
         * for rejecting an amplify-based Phantom Hit; it is accepted here because
         * the alternative is not modelling the ramp at all.
         *
         * The size of that dependence is bounded by the other riders that have
         * already landed inside the current three-attack window. A Recurve Bow
         * ahead of Kraken in the build contributes 15 per attack, so 45 by the
         * third; against a 2500 HP target that is 1.8 percentage points of
         * missing health, worth 0.75 × 1.8% ≈ 2.2 damage on a 165 base — about
         * 1.3% of the proc, in the direction of slightly too much. An engine
         * change that snapshots target health once per attack and exposes it
         * would remove the dependence entirely; that is outside this file.
         *
         * Clamped because the simulation may have taken the target below zero,
         * and a negative health pool must not push the ramp past its maximum.
         */
        const missing = clamp(1 - ctx.targetCurrentHealth / ctx.targetMaxHealth, 0, 1);
        const rampSpan = kraken.maxMissingHealthMultiplier - 1;
        return {
          amount: base * (1 + rampSpan * missing),
          type: 'physical',
          label: 'Kraken Slayer · Bring It Down',
          notes: [
            `${base.toFixed(0)} at level ${ctx.stats.level}`,
            `+${(rampSpan * missing * 100).toFixed(0)}% for ${(missing * 100).toFixed(0)}% missing health`,
          ],
        };
      },
    };
  },
};

export const ONHIT_ITEMS: ItemEffect[] = [
  RECURVE_BOW,
  RAGEKNIFE,
  GUINSOOS_RAGEBLADE,
  KRAKEN_SLAYER,
];
