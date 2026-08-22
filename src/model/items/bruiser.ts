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
 * came from. Nothing here is taken from the wiki, and nothing is remembered.
 *
 * Vi is melee, so where an effect has melee and ranged values the melee one is
 * used, and the ranged value is named alongside it so the choice is visible.
 *
 * The Arena copies (223084, 226662, …) are deliberately *not* aliased onto these
 * entries. Two of them carry different data values — Arena Heartsteel is 125 plus
 * 12% maximum health, Arena Iceborn slows for 30% — so a blanket alias would
 * quietly report the Rift numbers for an Arena build.
 */

import type { SimContext } from '../../engine/context';
import type { AmplifiableHit, ItemAttackRider, ItemEffect, ItemRuntime } from '../itemEffects';

/**
 * The published numbers, in one block.
 *
 * Separated from the behaviour so the tests can assert against the source of the
 * value rather than against a second copy of it typed out by hand — a test that
 * repeats the constant only proves that two people typed the same thing.
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
   */
  heartsteel: {
    baseDamage: 70,
    maxHealthRatio: 0.06,
    damageToMaxHealthRatio: 0.1,
    perTargetCooldownSeconds: 30,
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
   * `RangedSkipperADRatio` 0.7. `SkipperStackDuration` 10 is how long a partial
   * count survives without attacking.
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
   * `SpellbladeMultiplier` 1.5 on base attack damage, `SpellbladeCooldown` 1.5,
   * `SlowAmount` 0.25 for `SlowFieldDuration` 2 (ranged: `RangedSlowAmount`
   * 0.125). The bin also carries `MonsterMod` 1.5, which it does not tie to
   * either the damage or the field; it is left out rather than guessed at, so a
   * monster target is under-reported by whatever that multiplier turns out to
   * govern.
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
   * `Cooldown` of 30 (ranged: 35 and 14). Both are whole percent in the bin:
   * the same file states the movement bonus twice, once as `BonusMSMelee` 20 and
   * once as `MovementSpeedBonus` 0.2, which fixes the unit.
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
   * 8%" is Riot's resolved text; the bin's `EternityDamageIncreasePerSecond`
   * 0.02, `EternityDamageIncreaseMax` 0.08 and `BuffCounterDuration` 4 agree and
   * add the window after which the count is lost.
   */
  riftmaker: {
    perSecondAmplification: 0.02,
    maxAmplification: 0.08,
    combatDropSeconds: 4,
  },
  /**
   * Spirit Visage — Boundless Vitality.
   *
   * `HealingIncrease` 0.25 and `ShieldIncrease` 0.25, which is the item's whole
   * passive: "Heals and Shields on you are increased by 25%".
   */
  spiritVisage: {
    healShieldPower: 0.25,
  },
} as const;

/**
 * How long a spellblade stays armed after the ability that armed it.
 *
 * Riot publishes the 1.5 s cooldown as a data value and does not publish this
 * window at all — not in `item.json`, not in the bin. The 10 s used here is the
 * figure the spellblade family in `itemEffects.ts` already runs on, and it is
 * kept identical on purpose: two spellblades disagreeing about their arm window
 * would be a difference nothing in the game supports.
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
  note: `Colossal Consumption: the next attack deals ${BRUISER_CONSTANTS.heartsteel.baseDamage} + ${
    BRUISER_CONSTANTS.heartsteel.maxHealthRatio * 100
  }% of maximum health as bonus physical damage, once per ${
    BRUISER_CONSTANTS.heartsteel.perTargetCooldownSeconds
  }s per target, and converts a tenth of that into maximum health.`,
  createRuntime(): ItemRuntime {
    const { baseDamage, maxHealthRatio, damageToMaxHealthRatio, perTargetCooldownSeconds } =
      BRUISER_CONSTANTS.heartsteel;
    let readyAt = 0;
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
         * model of the item than this.
         */
        const amount = baseDamage + maxHealthRatio * ctx.stats.maxHealth;

        /*
         * The health is granted here rather than after the hit resolves, because
         * a rider has no after: item damage does not re-enter the proc hooks.
         * Riot's own `ProcHealthGain` is `DamageProcCalc` × 0.10, i.e. a tenth of
         * the pre-mitigation figure, which is the number computed above — so the
         * only thing the early booking can affect is another maximum-health item
         * resolving its own rider on this very same attack.
         */
        ctx.applyTemporaryStats({
          stats: { hp: damageToMaxHealthRatio * amount },
          durationSeconds: PERMANENT_SECONDS,
          label: 'Heartsteel · Colossal Consumption',
        });

        return {
          amount,
          type: 'physical',
          label: 'Heartsteel · Colossal Consumption',
          notes: [
            `${baseDamage} + ${maxHealthRatio * 100}% of ${ctx.stats.maxHealth.toFixed(0)} health`,
            `+${(damageToMaxHealthRatio * amount).toFixed(0)} permanent maximum health`,
          ],
        };
      },
    };
  },
};

/* --------------------------------------------------------------- Hullbreaker */

const HULLBREAKER: ItemEffect = {
  id: '3181',
  name: 'Hullbreaker',
  modelled: true,
  note: `Skipper: every ${BRUISER_CONSTANTS.hullbreaker.attacksPerProc}th attack deals ${
    BRUISER_CONSTANTS.hullbreaker.baseAdRatio * 100
  }% base AD + ${
    BRUISER_CONSTANTS.hullbreaker.maxHealthRatio * 100
  }% of maximum health as bonus physical damage (melee values).`,
  createRuntime(): ItemRuntime {
    const { attacksPerProc, baseAdRatio, maxHealthRatio, stackDurationSeconds } =
      BRUISER_CONSTANTS.hullbreaker;
    let attacks = 0;
    let expiresAt = -Infinity;
    return {
      onBasicAttack(ctx): ItemAttackRider | null {
        // Riot's text is "against champions and epic monsters". This simulation
        // knows champion from monster but not epic from small, so a monster
        // target is taken at its word and a minion is excluded outright.
        if (ctx.target.unitType === 'minion') return null;

        if (ctx.time > expiresAt) attacks = 0;
        attacks += 1;
        expiresAt = ctx.time + stackDurationSeconds;
        if (attacks < attacksPerProc) return null;
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
  }% base AD on the next basic attack, and a frost field that slows for ${
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
  }%. Void Infusion's bonus-health-to-AP conversion is not modelled.`,
  createRuntime(): ItemRuntime {
    const { perSecondAmplification, maxAmplification, combatDropSeconds } =
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

/**
 * Spirit Visage.
 *
 * No damage, and modelled anyway. Boundless Vitality is a stat this calculator
 * already carries, but Riot writes it into the passive text rather than the stat
 * block, so the description parser never sees it and the stat sheet reads 0%
 * heal & shield power for a 2,700 g item that grants 25%. Declaring it here is
 * what makes that row true. It moves no damage number and, as of today, no
 * shield number either: nothing in the simulation consumes the stat yet.
 */
const SPIRIT_VISAGE: ItemEffect = {
  id: '3065',
  name: 'Spirit Visage',
  modelled: true,
  note: `Boundless Vitality: heals and shields on Vi are increased by ${
    BRUISER_CONSTANTS.spiritVisage.healShieldPower * 100
  }%. No damage effect.`,
  stats: { healShieldPower: BRUISER_CONSTANTS.spiritVisage.healShieldPower },
};

export const BRUISER_ITEMS: ItemEffect[] = [
  HEARTSTEEL,
  HULLBREAKER,
  ICEBORN_GAUNTLET,
  EXPERIMENTAL_HEXPLATE,
  RIFTMAKER,
  SPIRIT_VISAGE,
];
