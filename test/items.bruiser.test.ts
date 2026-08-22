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
import { BRUISER_CONSTANTS, BRUISER_ITEMS } from '../src/model/items/bruiser';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/*
 * These run against the real registry: this family is wired into
 * `src/model/itemEffects.ts`, so the engine finds the effects on its own. The
 * suite used to widen the registry with a module mock, which is what a family
 * needs *before* it is registered — leaving it in place afterwards applied every
 * effect twice and squared every amplifier.
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

describe('Heartsteel (3084)', () => {
  const { heartsteel } = BRUISER_CONSTANTS;

  it('opens with Colossal Consumption, sized off Vi own maximum health', () => {
    const result = run(attacks(1), ['3084']);
    const procs = procsOf(result, '3084');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(
      heartsteel.baseDamage + heartsteel.maxHealthRatio * VI_STATS.maxHealth,
      6,
    );
  });

  it('grows with Vi health and not with the target health', () => {
    const beefy = run(attacks(1), ['3084'], {
      bonusStats: { ...emptyStats(), hp: 1000 },
    });
    const plain = run(attacks(1), ['3084']);

    expect(procsOf(beefy, '3084')[0]!.raw - procsOf(plain, '3084')[0]!.raw).toBeCloseTo(
      heartsteel.maxHealthRatio * 1000,
      6,
    );

    const smallTarget = run(attacks(1), ['3084'], {
      target: { ...TARGET, maxHealth: 2500 },
    });
    expect(procsOf(smallTarget, '3084')[0]!.raw).toBeCloseTo(procsOf(plain, '3084')[0]!.raw, 6);
  });

  it('fires once per target cooldown, however long the combo runs', () => {
    const result = run(attacks(6), ['3084']);
    // Six swings inside the 30 s window: one carries the proc, five do not.
    expect(basicAttacks(result)).toHaveLength(6);
    expect(procsOf(result, '3084')).toHaveLength(1);
  });

  it('converts a tenth of the proc into maximum health', () => {
    const result = run(attacks(2), ['3084']);
    const proc = procsOf(result, '3084')[0]!;
    const before = result.snapshots[0]!.attacker.maxHealth;

    expect(lastSnapshot(result).attacker.maxHealth - before).toBeCloseTo(
      heartsteel.damageToMaxHealthRatio * proc.raw,
      6,
    );
  });
});

describe('Hullbreaker (3181)', () => {
  const { hullbreaker } = BRUISER_CONSTANTS;
  const skipper =
    hullbreaker.baseAdRatio * VI_STATS.baseAttackDamage +
    hullbreaker.maxHealthRatio * VI_STATS.maxHealth;

  it('lands Skipper on the fifth attack and not on the fourth', () => {
    expect(procsOf(run(attacks(4), ['3181']), '3181')).toHaveLength(0);

    const result = run(attacks(5), ['3181']);
    const procs = procsOf(result, '3181');
    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(skipper, 6);
    // It rides the fifth swing rather than arriving on its own.
    expect(procs[0]!.time).toBeCloseTo(basicAttacks(result)[4]!.time, 6);
  });

  it('scales with base attack damage, so bought AD does not inflate it', () => {
    const withAd = run(attacks(5), ['3181'], {
      bonusStats: { ...emptyStats(), attackDamage: 120 },
    });
    // 120 bonus AD is a third of Vi's total by now and must move Skipper by zero:
    // Riot's ratio is on stat 2 with the base-only qualifier.
    expect(procsOf(withAd, '3181')[0]!.raw).toBeCloseTo(skipper, 6);
  });

  it('scales with maximum health', () => {
    const withHealth = run(attacks(5), ['3181'], {
      bonusStats: { ...emptyStats(), hp: 800 },
    });
    expect(procsOf(withHealth, '3181')[0]!.raw - skipper).toBeCloseTo(
      hullbreaker.maxHealthRatio * 800,
      6,
    );
  });

  it('leaves minions alone, the way Riot scopes Skipper', () => {
    const result = run(attacks(5), ['3181'], {
      target: { ...TARGET, unitType: 'minion' },
    });
    expect(procsOf(result, '3181')).toHaveLength(0);
  });
});

describe('Iceborn Gauntlet (6662)', () => {
  const { icebornGauntlet } = BRUISER_CONSTANTS;
  const afterAbility = () => [step({ kind: 'ability', slot: 'Q' }, 0), step({ kind: 'attack' })];

  it('spends its spellblade on the attack after an ability', () => {
    const result = run(afterAbility(), ['6662']);
    const procs = procsOf(result, '6662');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.raw).toBeCloseTo(
      icebornGauntlet.baseAdMultiplier * VI_STATS.baseAttackDamage,
      6,
    );
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
    const label = `Slowed ${icebornGauntlet.slowPercent * 100}%`;
    const field = result.spans.find((span) => span.lane === 'cc' && span.label === label);

    expect(field).toBeDefined();
    expect(field!.end - field!.start).toBeCloseTo(icebornGauntlet.slowDurationSeconds, 6);
  });
});

describe('Experimental Hexplate (3073)', () => {
  const { hexplate } = BRUISER_CONSTANTS;
  const afterUltimate = () => [
    step({ kind: 'ability', slot: 'R' }),
    step({ kind: 'attack' }),
    step({ kind: 'attack' }),
  ];
  const bonusAttackSpeed = (result: Result) => lastSnapshot(result).attacker.bonusAttackSpeed;

  it('grants exactly the Overdrive attack speed after the ultimate', () => {
    const withItem = run(afterUltimate(), ['3073']);
    const plain = run(afterUltimate());

    expect(bonusAttackSpeed(withItem) - bonusAttackSpeed(plain)).toBeCloseTo(
      hexplate.attackSpeed,
      6,
    );
    expect(
      lastSnapshot(withItem).active.some((entry) =>
        entry.label.startsWith('Experimental Hexplate'),
      ),
    ).toBe(true);
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
});

describe('Riftmaker (4633)', () => {
  const { riftmaker } = BRUISER_CONSTANTS;

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
    expect(elapsed).toBeLessThan(riftmaker.combatDropSeconds);

    const expected = Math.min(
      riftmaker.maxAmplification,
      Math.floor(elapsed) * riftmaker.perSecondAmplification,
    );
    expect(withItem[1]!.raw / plain[1]!.raw).toBeCloseTo(1 + expected, 6);
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
    expect(elapsed * riftmaker.perSecondAmplification).toBeGreaterThan(
      riftmaker.maxAmplification,
    );
    expect(withItem[last]!.raw / plain[last]!.raw).toBeCloseTo(
      1 + riftmaker.maxAmplification,
      6,
    );
  });

  it('loses the count after four seconds without dealing damage', () => {
    const { withItem, plain } = pair(() => [
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 6 }),
      step({ kind: 'attack' }),
    ]);

    expect(withItem[1]!.time - withItem[0]!.time).toBeGreaterThan(riftmaker.combatDropSeconds);
    // Out of combat, so the second attack starts the fight again at zero stacks.
    expect(withItem[1]!.raw).toBeCloseTo(plain[1]!.raw, 6);
  });
});

describe('the family as declared', () => {
  it('gives Spirit Visage the stat Riot writes into its passive, and nothing else', () => {
    const visage = BRUISER_ITEMS.find((effect) => effect.id === '3065');

    expect(visage?.stats?.healShieldPower).toBe(BRUISER_CONSTANTS.spiritVisage.healShieldPower);
    // Stat only: there is no damage in Boundless Vitality, so there is nothing to
    // run and nothing to amplify, and the entry must not pretend otherwise.
    expect(visage?.createRuntime).toBeUndefined();
    expect(visage?.amplify).toBeUndefined();
  });

  it('claims nothing it has not implemented', () => {
    for (const effect of BRUISER_ITEMS) {
      expect(effect.modelled, effect.name).toBe(true);
      expect(effect.note.length, effect.name).toBeGreaterThan(20);
      // `modelled` has to be backed by something the engine can call or read.
      expect(Boolean(effect.createRuntime ?? effect.amplify ?? effect.stats), effect.name).toBe(
        true,
      );
    }
    expect(new Set(BRUISER_ITEMS.map((effect) => effect.id)).size).toBe(BRUISER_ITEMS.length);
  });

});
