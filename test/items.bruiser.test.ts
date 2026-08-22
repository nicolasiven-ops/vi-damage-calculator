import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS,
  type ComboStep,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { BRUISER_ITEMS } from '../src/model/items/bruiser';
import { getItemEffect } from '../src/model/itemEffects';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/*
 * These run against the real registry: this family is wired into
 * `src/model/itemEffects.ts`, so the engine finds the effects on its own. The
 * suite used to widen the registry with a module mock, which is what a family
 * needs *before* it is registered — leaving it in place afterwards applied every
 * effect twice and squared every amplifier.
 *
 * Every expectation below is arithmetic on Riot's own literals — 70, 0.06, 1.2,
 * 0.05, 1.5, 0.5, 0.02, 0.08, 0.1 — each named at its use site with the data
 * value it came from. `BRUISER_CONSTANTS` is deliberately *not* imported: an
 * expectation built from the same constant the runtime read would pass whatever
 * that constant said, which is the one thing these tests exist to catch.
 */

const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const LEVEL = 11;

/**
 * Nothing may die, and nothing may be resisted.
 *
 * These tests are about the size of a proc, so the target is a wall: a health
 * pool no combo can empty — a kill would truncate the timeline — and no armour,
 * so `raw` and `mitigated` agree and every assertion reads as the item's own
 * number rather than as a mitigation result.
 */
const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 1_000_000,
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

/** Vi's stats for the default build, which is what the max-health passives read. */
const VI_STATS = resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, emptyStats());

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `b${uid}`, action }
    : { uid: `b${uid}`, action, chargeSeconds };
}

function attacks(count: number): ComboStep[] {
  return Array.from({ length: count }, () => step({ kind: 'attack' }));
}

function run(
  combo: ComboStep[],
  itemIds: string[] = [],
  options: { target?: TargetConfig; bonusStats?: StatBlock } = {},
) {
  const bonusStats = options.bonusStats ?? emptyStats();
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: LEVEL,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds,
      runeIds: [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: resolveChampionStats(FIXTURE_CHAMPION_STATS, LEVEL, bonusStats),
    bonusStats,
    target: { ...(options.target ?? TARGET) },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'never',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

type Result = ReturnType<typeof run>;

const procsOf = (result: Result, id: string) =>
  result.instances.filter((entry) => entry.sourceId === `item:${id}`);

const basicAttacks = (result: Result) =>
  result.instances.filter((entry) => entry.sourceId === 'AA');

const lastSnapshot = (result: Result) => result.snapshots[result.snapshots.length - 1]!;

const buffSpans = (result: Result, labelPrefix: string) =>
  result.spans.filter((span) => span.lane === 'buff' && span.label.startsWith(labelPrefix));

describe('Heartsteel (3084)', () => {
  /*
   * Riot's numbers, spelled out once so every expectation below is arithmetic on
   * them rather than on the module's copy.
   *
   * Data Dragon 16.16.1 item 3084: "your next Attack against them deals 70 plus
   * 6% of your max Health as bonus physical damage and grants 10% of the damage
   * as max Health". Bin Items/3084: BaseDamage 70, HPRatio 0.06 (stat 12, no
   * bonus-only qualifier), DamageToMaxHealthRatio 0.10, PerTargetCooldown 30.
   */
  const BASE_DAMAGE = 70;
  const MAX_HEALTH_RATIO = 0.06;
  const DAMAGE_TO_MAX_HEALTH_RATIO = 0.1;

  it('opens with Colossal Consumption, sized off Vi own maximum health', () => {
    const result = run(attacks(1), ['3084']);
    const procs = procsOf(result, '3084');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(BASE_DAMAGE + MAX_HEALTH_RATIO * VI_STATS.maxHealth, 6);
  });

  it('grows with Vi health and not with the target health', () => {
    const beefy = run(attacks(1), ['3084'], {
      bonusStats: { ...emptyStats(), hp: 1000 },
    });
    const plain = run(attacks(1), ['3084']);

    expect(procsOf(beefy, '3084')[0]!.raw - procsOf(plain, '3084')[0]!.raw).toBeCloseTo(
      MAX_HEALTH_RATIO * 1000,
      6,
    );

    const smallTarget = run(attacks(1), ['3084'], {
      target: { ...TARGET, maxHealth: 2500 },
    });
    expect(procsOf(smallTarget, '3084')[0]!.raw).toBeCloseTo(procsOf(plain, '3084')[0]!.raw, 6);
  });

  it('fires once per target cooldown, however long the combo runs', () => {
    const result = run(attacks(6), ['3084']);
    // Six swings inside the 30 s PerTargetCooldown: one carries the proc, five
    // do not. Six attacks at Vi's level 11 attack speed span under 7 s, well
    // inside the window.
    expect(basicAttacks(result)).toHaveLength(6);
    expect(basicAttacks(result)[5]!.time - basicAttacks(result)[0]!.time).toBeLessThan(30);
    expect(procsOf(result, '3084')).toHaveLength(1);
  });

  it('converts a tenth of the proc into maximum health', () => {
    const result = run(attacks(2), ['3084']);
    const proc = procsOf(result, '3084')[0]!;
    const before = result.snapshots[0]!.attacker.maxHealth;

    expect(lastSnapshot(result).attacker.maxHealth - before).toBeCloseTo(
      DAMAGE_TO_MAX_HEALTH_RATIO * proc.raw,
      6,
    );
  });

  /*
   * The regression test for the accumulation bug.
   *
   * `applyTemporaryStats` assigns to an existing buff rather than adding to it
   * (src/engine/simulate.ts), so a runtime that re-applied one proc's 10% under
   * the same label kept only the last proc's health. Riot's gain is permanent
   * and uncapped — wiki.leagueoflegends.com/en-us/Heartsteel: "grant you
   * permanent bonus health equal to 10% of that amount" — so the total has to be
   * the sum. The old suite never saw it because no combo crossed the 30 s
   * per-target cooldown and a second proc never happened.
   */
  it('adds up its permanent health across procs, and each proc is bigger for it', () => {
    const result = run(
      [
        step({ kind: 'attack' }),
        step({ kind: 'wait', seconds: 31 }),
        step({ kind: 'attack' }),
        step({ kind: 'wait', seconds: 31 }),
        step({ kind: 'attack' }),
      ],
      ['3084'],
    );
    const procs = procsOf(result, '3084');
    expect(procs).toHaveLength(3);
    // Each wait clears the 30 s cooldown; pinned so the three procs are not an
    // accident of timing.
    expect(procs[1]!.time - procs[0]!.time).toBeGreaterThan(30);
    expect(procs[2]!.time - procs[1]!.time).toBeGreaterThan(30);

    const before = result.snapshots[0]!.attacker.maxHealth;
    const gained = lastSnapshot(result).attacker.maxHealth - before;
    const expected = procs.reduce((sum, proc) => sum + DAMAGE_TO_MAX_HEALTH_RATIO * proc.raw, 0);
    expect(gained).toBeCloseTo(expected, 6);
    // Not just "the last one": three procs of ~159 must move maximum health by
    // ~48, not by ~16. This is the assertion the replacement bug failed.
    expect(gained).toBeGreaterThan(2.5 * DAMAGE_TO_MAX_HEALTH_RATIO * procs[0]!.raw);

    // And the health is live, so every later proc reads the grown pool: each
    // proc grows by exactly 6% of the health the one before it granted.
    expect(procs[1]!.raw - procs[0]!.raw).toBeCloseTo(
      MAX_HEALTH_RATIO * DAMAGE_TO_MAX_HEALTH_RATIO * procs[0]!.raw,
      6,
    );
    expect(procs[2]!.raw - procs[1]!.raw).toBeCloseTo(
      MAX_HEALTH_RATIO * DAMAGE_TO_MAX_HEALTH_RATIO * procs[1]!.raw,
      6,
    );
  });
});

describe('Hullbreaker (3181)', () => {
  /*
   * Bin Items/3181: SkipperADRatio 1.2 on stat 2 with mStatFormula 1 (base
   * attack damage), MaxStackDamageHPRatio 0.05 on stat 12 (maximum health),
   * SkipperStackDuration 10. Data Dragon 16.16.1 item 3181 supplies the count
   * and the payout scope: "Every fifth Attack against champions and epic
   * monsters deals bonus physical damage".
   */
  const BASE_AD_RATIO = 1.2;
  const MAX_HEALTH_RATIO = 0.05;
  const ATTACKS_PER_PROC = 5;
  const STACK_DURATION = 10;
  const skipper = BASE_AD_RATIO * VI_STATS.baseAttackDamage + MAX_HEALTH_RATIO * VI_STATS.maxHealth;

  it('lands Skipper on the fifth attack and not on the fourth', () => {
    expect(procsOf(run(attacks(ATTACKS_PER_PROC - 1), ['3181']), '3181')).toHaveLength(0);

    const result = run(attacks(ATTACKS_PER_PROC), ['3181']);
    const procs = procsOf(result, '3181');
    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(skipper, 6);
    // It rides the fifth swing rather than arriving on its own.
    expect(procs[0]!.time).toBeCloseTo(basicAttacks(result)[ATTACKS_PER_PROC - 1]!.time, 6);
  });

  it('scales with base attack damage, so bought AD does not inflate it', () => {
    const withAd = run(attacks(ATTACKS_PER_PROC), ['3181'], {
      bonusStats: { ...emptyStats(), attackDamage: 120 },
    });
    // 120 bonus AD is a third of Vi's total by now and must move Skipper by zero:
    // Riot's ratio is on stat 2 with the base-only qualifier.
    expect(procsOf(withAd, '3181')[0]!.raw).toBeCloseTo(skipper, 6);
  });

  it('scales with maximum health', () => {
    const withHealth = run(attacks(ATTACKS_PER_PROC), ['3181'], {
      bonusStats: { ...emptyStats(), hp: 800 },
    });
    expect(procsOf(withHealth, '3181')[0]!.raw - skipper).toBeCloseTo(MAX_HEALTH_RATIO * 800, 6);
  });

  it('loses a partial count after the stack duration lapses', () => {
    const result = run(
      [...attacks(ATTACKS_PER_PROC - 1), step({ kind: 'wait', seconds: 11 }), ...attacks(4)],
      ['3181'],
    );
    const hits = basicAttacks(result);
    expect(hits).toHaveLength(8);
    // The gap has to be longer than SkipperStackDuration for this to mean
    // anything, and the four attacks before it must fit inside one window.
    expect(hits[4]!.time - hits[3]!.time).toBeGreaterThan(STACK_DURATION);
    expect(hits[3]!.time - hits[0]!.time).toBeLessThan(STACK_DURATION);
    // Eight attacks, and none of them the fifth of a run: the count restarted.
    expect(procsOf(result, '3181')).toHaveLength(0);
  });

  /*
   * The two scopes are different scopes.
   *
   * wiki.leagueoflegends.com/en-us/Hullbreaker: "Basic attacks on-hit against any
   * enemy grant a stack for 10 seconds … your next basic attack on-hit against a
   * champion, epic monster, or structure consumes all stacks". A minion builds
   * stacks and cannot spend them.
   *
   * Only the payout half of that is observable here: a simulation has one target
   * for its whole run, so there is no combo in which stacks built on a minion are
   * later spent on a champion. The minion case therefore asserts the payout scope
   * and nothing more, and the stacking rule is carried by the module's comment.
   */
  it('never spends Skipper on a minion, however many stacks it builds', () => {
    const result = run(attacks(10), ['3181'], {
      target: { ...TARGET, unitType: 'minion' },
    });
    expect(basicAttacks(result)).toHaveLength(10);
    expect(procsOf(result, '3181')).toHaveLength(0);
  });

  it('pays out on a monster but says out loud that it cannot tell epic from small', () => {
    const result = run(attacks(ATTACKS_PER_PROC), ['3181'], {
      target: { ...TARGET, unitType: 'monster' },
    });
    // `TargetConfig.unitType` has no epic flag, so the proc is taken at its word
    // and the overstatement is reported rather than hidden.
    expect(procsOf(result, '3181')).toHaveLength(1);
    expect(result.warnings.some((line) => line.includes('epic monsters consume stacks'))).toBe(
      true,
    );
  });
});

describe('Iceborn Gauntlet (6662)', () => {
  /*
   * Bin Items/6662: SpellbladeMultiplier 1.5 on stat 2 with mStatFormula 1 (base
   * attack damage), SpellbladeCooldown 1.5, SlowAmount 0.25, SlowFieldDuration 2.
   * The 10 s arm window is the one wiki-sourced number in this family —
   * wiki.leagueoflegends.com/en-us/Iceborn_Gauntlet: "your next basic attack
   * within 10 seconds deals 150% base AD bonus physical damage".
   */
  const BASE_AD_MULTIPLIER = 1.5;
  const COOLDOWN = 1.5;
  const SLOW_PERCENT = 0.25;
  const SLOW_DURATION = 2;
  const afterAbility = () => [step({ kind: 'ability', slot: 'Q' }, 0), step({ kind: 'attack' })];

  it('spends its spellblade on the attack after an ability', () => {
    const result = run(afterAbility(), ['6662']);
    const procs = procsOf(result, '6662');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(BASE_AD_MULTIPLIER * VI_STATS.baseAttackDamage, 6);
  });

  it('does nothing on attacks with no ability in front of them', () => {
    expect(procsOf(run(attacks(3), ['6662']), '6662')).toHaveLength(0);
  });

  it('is spent by exactly one attack', () => {
    const result = run([...afterAbility(), step({ kind: 'attack' })], ['6662']);
    expect(procsOf(result, '6662')).toHaveLength(1);
  });

  it('records the frost field, which is why the next attack lands', () => {
    const result = run(afterAbility(), ['6662']);
    const label = `Slowed ${SLOW_PERCENT * 100}%`;
    const field = result.spans.find((span) => span.lane === 'cc' && span.label === label);

    expect(field).toBeDefined();
    expect(field!.end - field!.start).toBeCloseTo(SLOW_DURATION, 6);
  });

  /*
   * The internal cooldown, which no test used to reach.
   *
   * An ability cast while the spellblade is still cooling down does not arm it,
   * exactly as on Sheen. Vi's E attacks on cast, which is what makes a second
   * ability land inside 1.5 s of the spent attack at all — her Q is on a six
   * second cooldown and the engine would simply wait it out.
   */
  it('is not re-armed by an ability cast inside the 1.5 s cooldown', () => {
    const tooSoon = run(
      [
        step({ kind: 'ability', slot: 'Q' }, 0),
        step({ kind: 'attack' }),
        step({ kind: 'ability', slot: 'E' }),
        step({ kind: 'attack' }),
      ],
      ['6662'],
    );
    const spent = procsOf(tooSoon, '6662');
    const secondCast = tooSoon.instances.find((entry) => entry.sourceId === 'E')!;
    // The premise: the second cast really is inside the cooldown.
    expect(secondCast.time - spent[0]!.time).toBeLessThan(COOLDOWN);
    expect(spent).toHaveLength(1);

    // Two seconds later the same combo arms again, so the single proc above is
    // the cooldown talking and not a broken E path.
    const inTime = run(
      [
        step({ kind: 'ability', slot: 'Q' }, 0),
        step({ kind: 'attack' }),
        step({ kind: 'wait', seconds: 2 }),
        step({ kind: 'ability', slot: 'E' }),
        step({ kind: 'attack' }),
      ],
      ['6662'],
    );
    expect(procsOf(inTime, '6662')).toHaveLength(2);
  });
});

describe('Experimental Hexplate (3073)', () => {
  /*
   * Bin Items/3073: BonusASMelee 50 and BonusMSMelee 20 (the latter restated as
   * MovementSpeedBonus 0.2, which fixes the unit) for HasteDuration 8, on a
   * Cooldown of 30.
   */
  const ATTACK_SPEED = 0.5;
  const DURATION = 8;
  const COOLDOWN = 30;
  const afterUltimate = () => [
    step({ kind: 'ability', slot: 'R' }),
    step({ kind: 'attack' }),
    step({ kind: 'attack' }),
  ];
  const bonusAttackSpeed = (result: Result) => lastSnapshot(result).attacker.bonusAttackSpeed;

  it('grants exactly the Overdrive attack speed after the ultimate', () => {
    const withItem = run(afterUltimate(), ['3073']);
    const plain = run(afterUltimate());

    expect(bonusAttackSpeed(withItem) - bonusAttackSpeed(plain)).toBeCloseTo(ATTACK_SPEED, 6);
    const span = buffSpans(withItem, 'Experimental Hexplate')[0];
    expect(span).toBeDefined();
    expect(span!.end - span!.start).toBeCloseTo(DURATION, 6);
  });

  it('is the ultimate that arms it, not a basic ability', () => {
    const combo = () => [step({ kind: 'ability', slot: 'Q' }, 0), step({ kind: 'attack' })];
    expect(bonusAttackSpeed(run(combo(), ['3073']))).toBeCloseTo(
      bonusAttackSpeed(run(combo())),
      6,
    );
  });

  it('turns the attack speed into attacks that come sooner', () => {
    const gap = (result: Result) => {
      const hits = basicAttacks(result);
      return hits[1]!.time - hits[0]!.time;
    };
    expect(gap(run(afterUltimate(), ['3073']))).toBeLessThan(gap(run(afterUltimate())));
  });

  /*
   * The 30 s Overdrive cooldown, which no test used to reach.
   *
   * Vi's ultimate is on a 90 s cooldown in the fixture, so a plain re-cast lands
   * long after Overdrive is ready again and proves nothing. 250 ability haste
   * pulls the second cast down to ~26 s, inside the item's own 30 s window —
   * Hexcharged's 30 *ultimate* ability haste is not modelled, so the same haste
   * applies with and without the item and the comparison stays fair.
   */
  it('does not re-arm Overdrive inside its own 30 s cooldown', () => {
    const combo = () => [
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'attack' }),
    ];
    const hasted = { ...emptyStats(), abilityHaste: 250 };
    const result = run(combo(), ['3073'], { bonusStats: hasted });
    const casts = result.instances.filter((entry) => entry.sourceId === 'R');

    expect(casts).toHaveLength(2);
    // The premise: the second ultimate really is inside the item's cooldown.
    expect(casts[1]!.time - casts[0]!.time).toBeLessThan(COOLDOWN);
    // One buff, from the first cast only. The span is what a second application
    // would add to, so counting spans is what catches a missing gate.
    const spans = buffSpans(result, 'Experimental Hexplate');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.start).toBeCloseTo(casts[0]!.time, 6);
    // And by the time the second ultimate lands the first buff has lapsed, so
    // the attack after it swings at Vi's plain attack speed.
    expect(casts[1]!.time - casts[0]!.time).toBeGreaterThan(DURATION);
    expect(bonusAttackSpeed(result)).toBeCloseTo(
      bonusAttackSpeed(run(combo(), [], { bonusStats: hasted })),
      6,
    );
  });
});

describe('Riftmaker (4633)', () => {
  /*
   * Data Dragon 16.16.1 item 4633: "For each second in combat with enemy
   * champions, deal 2% bonus damage, up to 8%. At maximum strength, gain
   * Omnivamp." Bin Items/4633 resolves the keyword and the window:
   * EternityDamageIncreasePerSecond 0.02, EternityDamageIncreaseMax 0.08,
   * BuffCounterDuration 4, VampAmountMelee 0.10 (ranged 0.06).
   */
  const PER_SECOND = 0.02;
  const MAX_AMPLIFICATION = 0.08;
  const COMBAT_DROP = 4;
  const OMNIVAMP_AT_MAX = 0.1;

  /** The same combo with and without the item, so only the amplifier differs. */
  function pair(combo: () => ComboStep[]) {
    return {
      withItem: basicAttacks(run(combo(), ['4633'])),
      plain: basicAttacks(run(combo())),
    };
  }

  it('leaves the hit that starts the fight alone and ramps 2% for each second after it', () => {
    const { withItem, plain } = pair(() => [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
    ]);

    // Nothing has been in combat yet when the first hit is computed.
    expect(withItem[0]!.raw).toBeCloseTo(plain[0]!.raw, 6);

    const elapsed = withItem[1]!.time - withItem[0]!.time;
    // Pins the timeline the expectation is derived from: three whole seconds of
    // combat, and no four-second gap that would have dropped the count.
    expect(Math.floor(elapsed)).toBe(3);
    expect(elapsed).toBeLessThan(COMBAT_DROP);

    // Three seconds at 2% each, which is below the 8% cap.
    expect(withItem[1]!.raw / plain[1]!.raw).toBeCloseTo(1 + 3 * PER_SECOND, 6);
  });

  it('stops at its cap however long the fight runs', () => {
    const { withItem, plain } = pair(() => [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
    ]);

    const last = withItem.length - 1;
    const elapsed = withItem[last]!.time - withItem[0]!.time;
    // Well past the cap, which is four seconds of combat.
    expect(elapsed * PER_SECOND).toBeGreaterThan(MAX_AMPLIFICATION);
    expect(withItem[last]!.raw / plain[last]!.raw).toBeCloseTo(1 + MAX_AMPLIFICATION, 6);
  });

  it('loses the count after four seconds without dealing damage', () => {
    const { withItem, plain } = pair(() => [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 6 }),
      step({ kind: 'attack' }),
    ]);

    expect(withItem[1]!.time - withItem[0]!.time).toBeGreaterThan(COMBAT_DROP);
    // Out of combat, so the second attack starts the fight again at zero stacks.
    expect(withItem[1]!.raw).toBeCloseTo(plain[1]!.raw, 6);
  });

  /*
   * The omnivamp half of Void Corruption, which used to be dropped silently.
   *
   * It arrives one hit late by design: `dealDamage` computes vamp before it calls
   * `onHitLanded`, so the hit that reaches maximum stacks heals nothing and every
   * instance the engine records after it heals 10%. That includes Vi's own
   * Denting Blows proc, because Riot's text puts no qualifier on the omnivamp
   * either.
   */
  it('heals 10% of everything dealt once Void Corruption is at maximum', () => {
    const combo = () => [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 3 }),
      step({ kind: 'attack' }),
    ];
    const withItem = run(combo(), ['4633']);
    const plain = run(combo());

    // Vi has no lifesteal, vamp or heal of her own in this build, so all of the
    // healing below belongs to the item.
    expect(plain.healingDone).toBe(0);

    const hits = basicAttacks(withItem);
    // The buff goes up on the third attack: the first hit that is a full four
    // seconds into the fight, i.e. at the 8% cap.
    const trigger = hits[2]!;
    expect(Math.floor(trigger.time - hits[0]!.time) * PER_SECOND).toBeGreaterThanOrEqual(
      MAX_AMPLIFICATION,
    );
    expect(Math.floor(hits[1]!.time - hits[0]!.time) * PER_SECOND).toBeLessThan(MAX_AMPLIFICATION);

    const triggerIndex = withItem.instances.indexOf(trigger);
    const afterTrigger = withItem.instances.slice(triggerIndex + 1);
    // Nothing later than the trigger may fall outside the 4 s window, or it
    // would have healed nothing and this sum would be too big.
    expect(hits[3]!.time - trigger.time).toBeLessThan(COMBAT_DROP);
    const healable = afterTrigger.reduce((sum, entry) => sum + entry.mitigated, 0);

    expect(healable).toBeGreaterThan(0);
    expect(withItem.healingDone).toBeCloseTo(OMNIVAMP_AT_MAX * healable, 6);
    // The buff carries a real omnivamp stat, not just a timeline label.
    expect(lastSnapshot(withItem).attacker.omnivamp).toBeCloseTo(OMNIVAMP_AT_MAX, 6);
  });

  it('grants no omnivamp before the amplifier is at maximum', () => {
    const result = run([step({ kind: 'attack' })], ['4633']);
    expect(result.healingDone).toBe(0);
    expect(buffSpans(result, 'Riftmaker')).toHaveLength(0);
  });
});

describe('the family as declared', () => {
  /**
   * The headline number of each item, as its note is expected to print it.
   *
   * This is what keeps a constant from going dead. `armSeconds` in particular has
   * no branch to gate — Heartsteel's stack is assumed armed when the combo opens
   * — so the only way a wrong 3 becomes visible is that it is rendered, and the
   * only way rendering it is worth anything is that something checks.
   */
  const NOTE_MUST_MENTION: Record<string, string[]> = {
    // 70 + 6% max health, 30 s per target, 3 s to arm (6 ticks × 0.5 s).
    '3084': ['70', '6%', '30s', '3s'],
    // 120% base AD + 5% max health, 10 s stack duration, on the 5th attack.
    '3181': ['120%', '5%', '10s', '5th'],
    // 150% base AD within 10 s, 1.5 s cooldown, 25% slow.
    '6662': ['150%', '10s', '1.5s', '25%'],
    // 50% attack speed, 20% move speed, 8 s, 30 s cooldown, 30 ultimate haste.
    '3073': ['50%', '20%', '8s', '30s', '30 ultimate'],
    // 2% per second to 8%, 10% omnivamp at maximum.
    '4633': ['2%', '8%', '10%'],
  };

  it('reaches the engine through the real registry, exactly once per id', () => {
    for (const effect of BRUISER_ITEMS) {
      // Same object, not an equal one: two families defining the same id would
      // collapse into the registry Map with the later one winning silently.
      expect(getItemEffect(effect.id), effect.name).toBe(effect);
    }
    expect(new Set(BRUISER_ITEMS.map((effect) => effect.id)).size).toBe(BRUISER_ITEMS.length);
  });

  it('claims nothing it has not implemented, and prints the numbers it claims', () => {
    for (const effect of BRUISER_ITEMS) {
      // `modelled` has to be backed by something the engine can call or read.
      expect(Boolean(effect.createRuntime ?? effect.amplify ?? effect.stats), effect.name).toBe(
        true,
      );
      const required = NOTE_MUST_MENTION[effect.id];
      expect(required, `no note expectation for ${effect.name}`).toBeDefined();
      for (const fragment of required!) {
        expect(effect.note, `${effect.name} note is missing ${fragment}`).toContain(fragment);
      }
    }
    // The table covers the family and nothing else, so a new item cannot slip in
    // without a number to check.
    expect(BRUISER_ITEMS.map((effect) => effect.id).sort()).toEqual(
      Object.keys(NOTE_MUST_MENTION).sort(),
    );
  });

  /*
   * Spirit Visage is absent on purpose.
   *
   * It used to be registered here with `stats: { healShieldPower: 0.25 }`, which
   * is the outgoing stat — src/model/items.ts parses Riot's own "Heal and Shield
   * Power" line into it and src/ui/StatSheet.tsx renders it as that row — while
   * Boundless Vitality amplifies healing *received*. Data Dragon 16.16.1 item
   * 3065: "Heals and Shields on you are increased by 25%", with no heal & shield
   * power in its <stats> block; bin Items/3065 has HealingIncrease 0.25 and
   * ShieldIncrease 0.25. `StatBlock` has no key for an incoming amplifier, so the
   * honest reading of Vi's Heal & Shield Power with Spirit Visage is 0%.
   */
  it('leaves Spirit Visage out rather than booking its passive as the wrong stat', () => {
    expect(BRUISER_ITEMS.map((effect) => effect.id)).not.toContain('3065');
    expect(getItemEffect('3065')).toBeUndefined();
    // And no bruiser entry grants the outgoing stat, which none of them has.
    for (const effect of BRUISER_ITEMS) {
      expect(effect.stats?.healShieldPower, effect.name).toBeUndefined();
    }
  });
});
