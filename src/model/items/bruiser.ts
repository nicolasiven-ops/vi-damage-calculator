/**
 * Bruiser and health-scaling item passives.
 *
 * Same shape as `itemEffects.ts` — one `ItemEffect` per Data Dragon item id —
 * kept in its own file because this shelf reads as a group: almost every passive
 * here is a fraction of *the attacker's own* maximum health rather than the
 * target's, which is the opposite direction from the penetration and crit items.
 *
 * Where the numbers come from
 * ---------------------------
 * Riot's `item.json` for patch 16.16.1 is the first source. Several of these
 * items ship an unresolved description there — Hullbreaker says only "deals
 * bonus physical damage", Experimental Hexplate has an empty
 * `<attackSpeed>% Attack Speed</attackSpeed>`, Iceborn Gauntlet says "bonus
 * physical damage" — so for those the number comes from Riot's own item bin
 * (`items.cdtb.bin.json` on CommunityDragon), which is the table the client
 * fills those placeholders from. Every constant below names the data value it
 * came from, and nothing is remembered.
 *
 * Two things here are *not* in Riot's files at all and are taken from the wiki,
 * each marked wiki-sourced at its own site: the spellblade arm window (see
 * `SPELLBLADE_WINDOW_SECONDS`) and Hullbreaker's rule about which enemies grant
 * a stack as opposed to which consume them (see `HULLBREAKER`). Riot publishes
 * neither, in item.json or in the bin.
 *
 * Vi is melee, so where an effect has melee and ranged values the melee one is
 * used, and the ranged value is named alongside it so the choice is visible.
 *
 * The Arena copies (223084, 226662, …) are deliberately *not* aliased onto these
 * entries. Two of them carry different data values — Arena Heartsteel is 125 plus
 * 12% maximum health, Arena Iceborn slows for 30% — so a blanket alias would
 * quietly report the Rift numbers for an Arena build.
 *
 * Spirit Visage (3065) used to live here and has been removed; see the note at
 * the foot of this file for why its passive has no home in `StatBlock`.
 */

import type { SimContext } from '../../engine/context';
import type { AmplifiableHit, ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';

/**
 * The published numbers, in one block.
 *
 * Separated from the behaviour so the runtime and the note both read the same
 * copy of a value. The tests do *not* read these back — a test that compares the
 * engine's output against the constant the engine just read proves only that the
 * value round-tripped — so every expectation in `test/items.bruiser.test.ts` is
 * written as arithmetic on Riot's literals instead.
 */
export const BRUISER_CONSTANTS = {
  /**
   * Heartsteel — Colossal Consumption.
   *
   * The only passive in this file that Riot resolves in `item.json` itself:
   * "your next Attack against them deals 70 plus 6% of your max Health as bonus
   * physical damage and grants 10% of the damage as max Health". The bin agrees
   * (`BaseDamage` 70, `HPRatio` 0.06 on stat 12 with no bonus-only qualifier,
   * `DamageToMaxHealthRatio` 0.10) and supplies the parts the prose rounds off
   * to "a few seconds": `PerTargetCooldown` 30, and an arming condition of
   * `NumTicksToTrigger` 6 × `TrackerTickRate` 0.5 = 3 s within
   * `DistanceToChampion` 700 units.
   *
   * The bin's `DataValuesModeOverride` halves `DamageToMaxHealthRatio` to 0.05
   * in ARAM and URF. This calculator simulates the Rift, so the Rift value is
   * the one taken.
   */
  heartsteel: {
    baseDamage: 70,
    maxHealthRatio: 0.06,
    damageToMaxHealthRatio: 0.1,
    perTargetCooldownSeconds: 30,
    /**
     * `NumTicksToTrigger` 6 × `TrackerTickRate` 0.5. Not a gate in the runtime —
     * see the comment in `onBasicAttack` for why the stack is assumed to be up —
     * but rendered into the item's note, so the value is on screen and a wrong
     * one is visible rather than dead.
     */
    armSeconds: 3,
  },
  /**
   * Hullbreaker — Skipper.
   *
   * "Every fifth Attack against champions and epic monsters deals bonus physical
   * damage" is Riot's own text; the amount is only in the bin. Melee:
   * `SkipperADRatio` 1.2 on stat 2 with `mStatFormula` 1 — base attack damage,
   * the same encoding Sheen's 100% base AD spellblade uses — plus
   * `MaxStackDamageHPRatio` 0.05 on stat 12, maximum health. Ranged would be
   * `RangedSkipperADRatio` 0.7, which the bin also states as the calculation's
   * `mRangedMultiplier` 0.7. `SkipperStackDuration` 10 is how long a partial
   * count survives without attacking.
   *
   * The structure values (`SkipperADRatioVSStructures` 3.0,
   * `MaxStackDamageVSStructuresHPRatio` 0.10) are left out: `TargetConfig` has
   * no structure unit type, so there is no target they could apply to.
   */
  hullbreaker: {
    attacksPerProc: 5,
    baseAdRatio: 1.2,
    maxHealthRatio: 0.05,
    stackDurationSeconds: 10,
  },
  /**
   * Iceborn Gauntlet — Spellblade and the frost field.
   *
   * `SpellbladeMultiplier` 1.5 on stat 2 with `mStatFormula` 1 (base attack
   * damage), `SpellbladeCooldown` 1.5, `SlowAmount` 0.25 for
   * `SlowFieldDuration` 2 (ranged: `RangedSlowAmount` 0.125). The bin also
   * carries `AuraDuration` 3.0 next to `SlowFieldDuration` 2.0 without saying
   * which governs the visible field; 2 s is used because that is the number both
   * `item.json` ("creates a frost field for 2s") and the wiki tooltip print.
   *
   * `MonsterMod` 1.5 is in the bin too and is tied to neither the damage nor the
   * field there; it is left out rather than guessed at, so a monster target is
   * under-reported by whatever that multiplier turns out to govern.
   */
  icebornGauntlet: {
    baseAdMultiplier: 1.5,
    cooldownSeconds: 1.5,
    slowPercent: 0.25,
    slowDurationSeconds: 2,
  },
  /**
   * Experimental Hexplate — Overdrive.
   *
   * `BonusASMelee` 50 and `BonusMSMelee` 20 for `HasteDuration` 8, on a
   * `Cooldown` of 30 (ranged: `BonusASRanged` 35 and `BonusMSRanged` 14). Both
   * are whole percent in the bin: the same file states the movement bonus twice,
   * once as `BonusMSMelee` 20 and once as `MovementSpeedBonus` 0.2, which fixes
   * the unit.
   */
  hexplate: {
    attackSpeed: 0.5,
    moveSpeedPercent: 0.2,
    durationSeconds: 8,
    cooldownSeconds: 30,
    /** `UltimateHaste` 30 — recorded, not modelled. See the note on the item. */
    ultimateAbilityHaste: 30,
  },
  /**
   * Riftmaker — Void Corruption.
   *
   * "For each second in combat with enemy champions, deal 2% bonus damage, up to
   * 8%. At maximum strength, gain Omnivamp" is Riot's resolved text. The bin's
   * `EternityDamageIncreasePerSecond` 0.02 and `EternityDamageIncreaseMax` 0.08
   * agree, `VampAmountMelee` 0.10 (ranged: `VampAmountRanged` 0.06) supplies the
   * omnivamp that item.json leaves as a bare keyword, and `BuffCounterDuration`
   * 4 — matched by a second data value, `SecondsInCombat` 4 — is the window
   * after which the count is lost.
   *
   * Disagreement worth recording: the wiki's notes give the buff as lasting 3 s
   * unstacked and 5 s stacked, where the bin has one uniform 4 s. Riot's own
   * data wins, and the wiki's split is named here so a reader who has seen it
   * knows it was considered rather than missed.
   */
  riftmaker: {
    perSecondAmplification: 0.02,
    maxAmplification: 0.08,
    combatDropSeconds: 4,
    omnivampAtMax: 0.1,
  },
} as const;

/**
 * How long a spellblade stays armed after the ability that armed it.
 *
 * Wiki-sourced, and the only number in this file that has to be. Riot publishes
 * the 1.5 s internal cooldown as a data value (`SpellbladeCooldown`) and does
 * not publish this window anywhere: not in `item.json`, whose text is only
 * "After using an Ability, your next Attack deals …", and not in the bin, where
 * Items/6662, Items/3057 (Sheen) and Items/3078 (Trinity Force) all carry a
 * cooldown and no window at all.
 *
 * The client's own tooltip does state it, and the wiki quotes it verbatim —
 * wiki.leagueoflegends.com/en-us/Iceborn_Gauntlet: "After using an ability, your
 * next basic attack within 10 seconds deals 150% base AD bonus physical damage
 * on-hit and creates a 300 radius frost field for 2 seconds. Enemies within the
 * field are slowed by (Melee 25% / Ranged 12.5%) (1.5 second cooldown, starts
 * after using the empowered attack)." That one sentence is also an independent
 * confirmation of the four bin values above.
 *
 * It is kept identical to the figure the spellblade family in `itemEffects.ts`
 * runs on, which the same tooltip covers: two spellblades disagreeing about
 * their arm window would be a difference nothing in the game supports.
 */
const SPELLBLADE_WINDOW_SECONDS = 10;

/**
 * A gain the game calls permanent, expressed in a simulation that only has
 * durations. Longer than any combo the engine will run — it stops at two
 * minutes — so the buff never expires inside the answer.
 */
const PERMANENT_SECONDS = 600;

/* ---------------------------------------------------------------- Heartsteel */

const HEARTSTEEL: ItemEffect = {
  id: '3084',
  name: 'Heartsteel',
  modelled: true,
  note: `Colossal Consumption: after ${
    BRUISER_CONSTANTS.heartsteel.armSeconds
  }s near the target the next attack deals ${BRUISER_CONSTANTS.heartsteel.baseDamage} + ${
    BRUISER_CONSTANTS.heartsteel.maxHealthRatio * 100
  }% of maximum health as bonus physical damage, once per ${
    BRUISER_CONSTANTS.heartsteel.perTargetCooldownSeconds
  }s per target, and converts a tenth of that into permanent maximum health that adds up across procs.`,
  createRuntime(): ItemRuntime {
    const { baseDamage, maxHealthRatio, damageToMaxHealthRatio, perTargetCooldownSeconds } =
      BRUISER_CONSTANTS.heartsteel;
    let readyAt = 0;
    /*
     * The running total of health granted so far, and the reason it exists.
     *
     * `applyTemporaryStats` identifies a buff by the text before its ' · '
     * (src/engine/simulate.ts) and *assigns* to the entry it finds rather than
     * adding to it. Re-applying one proc's 10% under the same label therefore
     * discards every earlier proc. Riot's gain is permanent and uncapped, so the
     * total is accumulated here and the buff is re-applied with the sum.
     */
    let grantedHealth = 0;
    return {
      onBasicAttack(ctx): ItemAttackRider | null {
        if (ctx.time < readyAt) return null;
        readyAt = ctx.time + perTargetCooldownSeconds;

        /*
         * The stack is assumed to be up when the combo starts.
         *
         * Arming it costs 3 s of standing within 700 units of the target, which
         * is a walk-up, not a combo step — a player buys Heartsteel precisely to
         * open with it. Requiring those 3 s to elapse *inside* the simulated
         * combo would mean the passive almost never fired, which is a worse
         * model of the item than this. Between procs the 30 s per-target
         * cooldown is longer than the 3 s arming time, so the assumption costs
         * nothing on the second and later procs either.
         */
        const amount = baseDamage + maxHealthRatio * ctx.stats.maxHealth;
        const gain = damageToMaxHealthRatio * amount;
        grantedHealth += gain;

        /*
         * The health is granted here rather than after the hit resolves, because
         * a rider has no after: item damage does not re-enter the proc hooks.
         * Riot's own `ProcHealthGain` is `DamageProcCalc` × 0.10, i.e. a tenth of
         * the pre-mitigation figure, which is the number computed above — so the
         * only thing the early booking can affect is another maximum-health item
         * resolving its own rider on this very same attack.
         */
        ctx.applyTemporaryStats({
          stats: { hp: grantedHealth },
          durationSeconds: PERMANENT_SECONDS,
          label: 'Heartsteel · Colossal Consumption',
        });

        return {
          amount,
          type: 'physical',
          label: 'Heartsteel · Colossal Consumption',
          notes: [
            `${baseDamage} + ${maxHealthRatio * 100}% of ${ctx.stats.maxHealth.toFixed(0)} health`,
            // This proc's own increment, not the running total: the timeline
            // reads as a list of procs, so each line states what that proc did.
            `+${gain.toFixed(0)} permanent maximum health`,
          ],
        };
      },
    };
  },
};

/* --------------------------------------------------------------- Hullbreaker */

/**
 * Hullbreaker.
 *
 * Riot's two scopes are different scopes, and conflating them is the bug this
 * shape exists to avoid. `item.json` states only the payout side — "Every fifth
 * Attack against champions and epic monsters deals bonus physical damage" — and
 * the bin states no scope at all. The stacking side is wiki-sourced,
 * wiki.leagueoflegends.com/en-us/Hullbreaker: "Basic attacks on-hit against any
 * enemy grant a stack for 10 seconds, stacking up to 5 times. At maximum stacks,
 * or 4 stacks, your next basic attack on-hit against a champion, epic monster,
 * or structure consumes all stacks to deal (Melee 120% / Ranged 84%) base AD
 * (+ (Melee 5% / Ranged 3.5%) maximum health) bonus physical damage" — which is
 * also an independent confirmation of the bin's 1.2 and 0.05.
 *
 * That same wiki sentence is self-contradictory about the count ("up to 5 times"
 * against "or 4 stacks"), so the count comes from Riot instead: item.json's
 * "every fifth Attack" puts the payout on the fifth swing, which is what
 * `attacksPerProc` 5 means here. A full counter is *held*, not spent, when the
 * attack that would spend it lands on something that cannot consume stacks.
 */
const HULLBREAKER: ItemEffect = {
  id: '3181',
  name: 'Hullbreaker',
  modelled: true,
  note: `Skipper: any enemy hit builds a stack for ${
    BRUISER_CONSTANTS.hullbreaker.stackDurationSeconds
  }s, and every ${BRUISER_CONSTANTS.hullbreaker.attacksPerProc}th attack — spent only on a champion or epic monster — deals ${
    BRUISER_CONSTANTS.hullbreaker.baseAdRatio * 100
  }% base AD + ${
    BRUISER_CONSTANTS.hullbreaker.maxHealthRatio * 100
  }% of maximum health as bonus physical damage (melee values).`,
  createRuntime(): ItemRuntime {
    const { attacksPerProc, baseAdRatio, maxHealthRatio, stackDurationSeconds } =
      BRUISER_CONSTANTS.hullbreaker;
    let attacks = 0;
    let expiresAt = -Infinity;
    let warnedAboutMonster = false;
    return {
      onBasicAttack(ctx): ItemAttackRider | null {
        // Stacking first, and for every target: Riot grants a stack on-hit
        // "against any enemy", minions included. Only spending them is scoped.
        if (ctx.time > expiresAt) attacks = 0;
        // Capped rather than wrapped. A counter that is already full and hits a
        // minion stays full, so the next champion swing spends it — the game
        // holds the stacks, it does not throw them away.
        attacks = Math.min(attacks + 1, attacksPerProc);
        expiresAt = ctx.time + stackDurationSeconds;
        if (attacks < attacksPerProc) return null;

        // Payout scope: champion, epic monster or structure. `TargetConfig` has
        // no structure type, and its 'monster' cannot tell a Baron from a Krug.
        if (ctx.target.unitType === 'minion') return null;
        if (ctx.target.unitType === 'monster' && !warnedAboutMonster) {
          warnedAboutMonster = true;
          ctx.warn(
            'Hullbreaker · Skipper: only epic monsters consume stacks, and this ' +
              'simulation cannot tell an epic monster from a small one — against a ' +
              'small camp the real damage is zero and this result is overstated.',
          );
        }
        attacks = 0;

        const fromAd = baseAdRatio * ctx.stats.baseAttackDamage;
        const fromHealth = maxHealthRatio * ctx.stats.maxHealth;
        return {
          amount: fromAd + fromHealth,
          type: 'physical',
          label: 'Hullbreaker · Skipper',
          notes: [
            `${baseAdRatio * 100}% of ${ctx.stats.baseAttackDamage.toFixed(0)} base AD`,
            `${maxHealthRatio * 100}% of ${ctx.stats.maxHealth.toFixed(0)} health`,
          ],
        };
      },
    };
  },
};

/* ----------------------------------------------------------- Iceborn Gauntlet */

const ICEBORN_GAUNTLET: ItemEffect = {
  id: '6662',
  name: 'Iceborn Gauntlet',
  modelled: true,
  note: `Spellblade: ${
    BRUISER_CONSTANTS.icebornGauntlet.baseAdMultiplier * 100
  }% base AD on the next basic attack within ${SPELLBLADE_WINDOW_SECONDS}s of an ability, every ${
    BRUISER_CONSTANTS.icebornGauntlet.cooldownSeconds
  }s, and a frost field that slows for ${
    BRUISER_CONSTANTS.icebornGauntlet.slowPercent * 100
  }% (melee value).`,
  createRuntime(): ItemRuntime {
    const { baseAdMultiplier, cooldownSeconds, slowPercent, slowDurationSeconds } =
      BRUISER_CONSTANTS.icebornGauntlet;
    let armedUntil = -Infinity;
    let readyAt = 0;
    return {
      onAbilityCast(ctx) {
        // Arming while the passive is still cooling down is wasted, exactly as
        // it is on Sheen: the buff is not applied, so the next attack is plain.
        if (ctx.time < readyAt) return;
        armedUntil = ctx.time + SPELLBLADE_WINDOW_SECONDS;
      },
      onBasicAttack(ctx): ItemAttackRider | null {
        if (ctx.time > armedUntil) return null;
        armedUntil = -Infinity;
        readyAt = ctx.time + cooldownSeconds;

        /*
         * The slow changes no number here — nothing about the target moving is
         * simulated — and is recorded anyway, because a timeline that shows the
         * damage but not the field is missing the reason the next attack landed.
         */
        ctx.applyCrowdControl({
          label: `Slowed ${slowPercent * 100}%`,
          durationSeconds: slowDurationSeconds,
          detail: 'movement only, inside the frost field',
        });

        return {
          amount: baseAdMultiplier * ctx.stats.baseAttackDamage,
          type: 'physical',
          label: 'Iceborn Gauntlet · Spellblade',
          notes: [`${baseAdMultiplier * 100}% base AD`],
        };
      },
    };
  },
};

/* ------------------------------------------------------- Experimental Hexplate */

/**
 * Experimental Hexplate.
 *
 * Overdrive is the half that reaches a damage number: attack speed is more
 * attacks inside the same combo. Hexcharged is 30 *Ultimate* Ability Haste, and
 * the stat model has plain haste and basic-ability haste but nothing that
 * shortens only the ultimate — booking it as either would be wrong in the
 * direction that matters, so it is named here and left out.
 */
const EXPERIMENTAL_HEXPLATE: ItemEffect = {
  id: '3073',
  name: 'Experimental Hexplate',
  modelled: true,
  note: `Overdrive: +${BRUISER_CONSTANTS.hexplate.attackSpeed * 100}% attack speed and +${
    BRUISER_CONSTANTS.hexplate.moveSpeedPercent * 100
  }% move speed for ${BRUISER_CONSTANTS.hexplate.durationSeconds}s after the ultimate, every ${
    BRUISER_CONSTANTS.hexplate.cooldownSeconds
  }s (melee values). Hexcharged's ${
    BRUISER_CONSTANTS.hexplate.ultimateAbilityHaste
  } ultimate ability haste is not modelled: the stat model has no ultimate-only haste.`,
  createRuntime(): ItemRuntime {
    const { attackSpeed, moveSpeedPercent, durationSeconds, cooldownSeconds } =
      BRUISER_CONSTANTS.hexplate;
    let readyAt = 0;
    return {
      onAbilityCast(ctx, slot) {
        if (slot !== 'R' || ctx.time < readyAt) return;
        readyAt = ctx.time + cooldownSeconds;
        ctx.applyTemporaryStats({
          stats: { attackSpeed, moveSpeedPercent },
          durationSeconds,
          label: 'Experimental Hexplate · Overdrive',
        });
      },
    };
  },
};

/* ----------------------------------------------------------------- Riftmaker */

/**
 * Riftmaker.
 *
 * Void Corruption is a stacking amplifier, so it lives in the runtime for the
 * same reason Spear of Shojin's does: it has to remember when the fight started.
 * The omnivamp half of the same passive is applied from here too — `omnivamp` is
 * a live `StatBlock` key that `simulate` already turns into healing, so there is
 * nothing missing for it.
 *
 * Void Infusion — 2% of bonus health as ability power — does not appear at all;
 * see the skipped list in this family's report for why a stat-from-stat
 * conversion has nowhere to live yet.
 */
const RIFTMAKER: ItemEffect = {
  id: '4633',
  name: 'Riftmaker',
  modelled: true,
  note: `Void Corruption: +${
    BRUISER_CONSTANTS.riftmaker.perSecondAmplification * 100
  }% damage per second in combat, up to +${
    BRUISER_CONSTANTS.riftmaker.maxAmplification * 100
  }%, and ${
    BRUISER_CONSTANTS.riftmaker.omnivampAtMax * 100
  }% omnivamp while at maximum (melee value). Void Infusion's bonus-health-to-AP conversion is not modelled.`,
  createRuntime(): ItemRuntime {
    const { perSecondAmplification, maxAmplification, combatDropSeconds, omnivampAtMax } =
      BRUISER_CONSTANTS.riftmaker;
    /*
     * Combat starts with the first damage dealt.
     *
     * "In combat with enemy champions" also covers damage *taken*, which this
     * simulation does not have — so the clock starts at the first hit that
     * lands. For a combo opened by the player that is the same instant; for one
     * opened by the enemy it is late, which under-reports rather than over.
     */
    let combatStartedAt: number | null = null;
    let lastHitAt = -Infinity;
    return {
      onHitLanded(ctx, hit) {
        if (hit.mitigated <= 0) return;
        if (combatStartedAt === null || ctx.time - lastHitAt > combatDropSeconds) {
          combatStartedAt = ctx.time;
        }
        lastHitAt = ctx.time;

        /*
         * Omnivamp at maximum strength, granted as a buff that the 4 s window
         * lets lapse on its own.
         *
         * It arrives one hit late: `dealDamage` computes vamp before it calls
         * this hook, so the hit that reaches maximum stacks heals nothing and
         * the ones after it do. That is the same one-hit lag the amplifier
         * already has — `amplify` reads a clock this hook advances — and both
         * err downwards.
         */
        if (Math.floor(ctx.time - combatStartedAt) * perSecondAmplification >= maxAmplification) {
          ctx.applyTemporaryStats({
            stats: { omnivamp: omnivampAtMax },
            durationSeconds: combatDropSeconds,
            label: 'Riftmaker · Void Corruption',
          });
        }
      },
      /*
       * The hit is not read. Riot's text is "deal 2% bonus damage" with no
       * qualifier — unlike Shojin's ability-only amplifier one file over — so
       * every kind of damage is raised, and the parameter is typed rather than
       * dropped to make that a decision instead of an omission.
       */
      amplify(ctx: SimContext, _hit: AmplifiableHit): number {
        if (combatStartedAt === null) return 0;
        // Out of combat long enough and the counter is gone; the hit that
        // restarts the fight is unamplified, and the stacks build again.
        if (ctx.time - lastHitAt > combatDropSeconds) return 0;
        const secondsInCombat = Math.floor(ctx.time - combatStartedAt);
        return Math.min(maxAmplification, secondsInCombat * perSecondAmplification);
      },
    };
  },
};

/* -------------------------------------------------------------- Spirit Visage */

/*
 * Spirit Visage (3065) is deliberately absent, and this is the record of why.
 *
 * It was previously registered here with `stats: { healShieldPower: 0.25 }`,
 * which is the wrong mechanic in the wrong direction. `healShieldPower` is the
 * OUTGOING stat: src/model/items.ts parses Riot's own "Heal and Shield Power"
 * stat line into it and src/ui/StatSheet.tsx renders it as the row "Heal &
 * Shield Power", i.e. how much more Vi's own heals and shields give to whoever
 * receives them. Boundless Vitality is the INCOMING amplifier.
 *
 * Data Dragon 16.16.1 item 3065: "<passive>Boundless Vitality</passive><br>Heals
 * and Shields on you are increased by 25%." — "on you". Its <stats> block is
 * 400 Health, 50 Magic Resist, 10 Ability Haste and 100% Base Health Regen, and
 * carries no heal & shield power line; bin Items/3065 has `HealingIncrease` 0.25
 * and `ShieldIncrease` 0.25, which are increase-of-received values and not the
 * shared stat other items grant. The wiki agrees and widens it:
 * wiki.leagueoflegends.com/en-us/Spirit_Visage — "Increases all healing and
 * shielding received as well as health regeneration by 25%" — and its notes
 * confirm the item is not listed as granting Heal and Shield Power, while the
 * passive does benefit drains and health regeneration, which heal & shield power
 * never touches.
 *
 * So 0% Heal & Shield Power is the correct reading, and the row was reading 25%.
 * `StatBlock` has no key for a multiplier on incoming healing, shielding and
 * regeneration, and adding one would mean editing src/model/stats.ts and every
 * consumer of it. The entry is therefore dropped rather than kept as a
 * `modelled: false` note: `hasModelledEffect` in src/model/itemEffects.ts is
 * true for *any* registered id regardless of the flag, so a note-only entry
 * would make the item picker print its "Passive is simulated" tag for a passive
 * that is not simulated. 3065 now falls into `unmodelledItemIds`, which is the
 * honest place for it, and it keeps its full 400 HP / 50 MR stat line from Data
 * Dragon either way. It is reported in this family's skipped list.
 */

export const BRUISER_ITEMS: ItemEffect[] = [
  HEARTSTEEL,
  HULLBREAKER,
  ICEBORN_GAUNTLET,
  EXPERIMENTAL_HEXPLATE,
  RIFTMAKER,
];
