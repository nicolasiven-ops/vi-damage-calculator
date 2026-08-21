import { describe, expect, it } from 'vitest';
import { analyse } from '../src/engine/analysis';
import { simulate } from '../src/engine/simulate';
import { DEFAULT_TIMINGS, type ComboStep, type SimulationInput, type TargetConfig } from '../src/engine/types';
import { VI_MODULE, VI_CONSTANTS } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats, statAtLevel } from '../src/model/stats';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * This suite deliberately runs *without* game data, so it covers the fallback
 * path: what the calculator does when CommunityDragon cannot be reached and the
 * maintained constants have to carry the combo. The game-data path is covered in
 * `vi.test.ts`, which runs the same module against the real bin file.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 3000,
  currentHealthPercent: 1,
  armor: 100,
  magicResist: 50,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `t${uid}`, action }
    : { uid: `t${uid}`, action, chargeSeconds };
}

function run(combo: ComboStep[], overrides: Partial<SimulationInput> = {}) {
  const bonusStats = overrides.bonusStats ?? emptyStats();
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 11,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds: [],
      runeIds: [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: stats,
    bonusStats,
    target: { ...TARGET },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'expected',
    ...overrides,
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

describe('basic attacks', () => {
  it('deals total attack damage through armor', () => {
    const result = run([step({ kind: 'attack' })]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    // 100 armor halves the damage.
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]!.mitigated).toBeCloseTo(stats.totalAttackDamage * 0.5, 6);
  });

  it('spaces attacks by the attack timer rather than stacking them at t=0', () => {
    const result = run([step({ kind: 'attack' }), step({ kind: 'attack' })]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const cycle = 1 / stats.totalAttackSpeed;
    expect(result.instances[1]!.time - result.instances[0]!.time).toBeCloseTo(cycle, 4);
  });
});

describe('charge abilities', () => {
  it('reports the recharge window and, with none in hand, a wait longer than the gap', () => {
    // Two E casts empty the charges; what you then wait for is the recharge,
    // not the one-second gap between casts. The strip draws whichever of the
    // two is the real wait, so both numbers have to be in the snapshot.
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);
    const last = result.snapshots[result.snapshots.length - 1]!;
    const e = last.abilities.find((entry) => entry.slot === 'E');

    expect(e?.charges?.available).toBe(0);
    expect(e?.charges?.interval).toBeCloseTo(VI_CONSTANTS.e.rechargeSeconds[4]!, 6);
    expect(e!.charges!.nextIn).toBeGreaterThan(e!.readyIn);
  });
});

describe('Vault Breaker (Q)', () => {
  it('scales damage with charge time', () => {
    const uncharged = run([step({ kind: 'ability', slot: 'Q' }, 0)]);
    const full = run([step({ kind: 'ability', slot: 'Q' }, VI_CONSTANTS.q.maxChargeSeconds)]);
    expect(full.instances[0]!.raw).toBeGreaterThan(uncharged.instances[0]!.raw * 1.8);
  });

  it('falls back to the maintained constant when game data is unavailable', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 0)]);
    // Rank 5, no bonus AD in this build: the base damage alone. Riot
    // publishes 120 for rank 5, and Q scales with bonus AD, not total AD, so
    // there is nothing to add here.
    const expected = VI_CONSTANTS.q.minBase[4]!;
    expect(result.instances[0]!.raw).toBeCloseTo(expected, 6);
  });

  it('scales with bonus attack damage only', () => {
    const bonusStats = { ...emptyStats(), attackDamage: 100 };
    const withBonus = run([step({ kind: 'ability', slot: 'Q' }, 0)], { bonusStats });
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonusStats);

    const expected = VI_CONSTANTS.q.minBase[4]! + VI_CONSTANTS.q.minBonusAdRatio * 100;
    expect(withBonus.instances[0]!.raw).toBeCloseTo(expected, 6);
    // Guards the regression this replaced: base AD must not count towards Q.
    expect(withBonus.instances[0]!.raw).toBeLessThan(
      VI_CONSTANTS.q.minBase[4]! + VI_CONSTANTS.q.minBonusAdRatio * stats.totalAttackDamage,
    );
  });

  it('costs its charge time on the timeline', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 1.25),
      step({ kind: 'attack' }),
    ]);
    expect(result.instances[0]!.time).toBeCloseTo(1.25 + DEFAULT_TIMINGS.dashTravel, 6);
  });
});

describe('Excessive Force (E)', () => {
  it('replaces the attack damage rather than adding to it', () => {
    const plain = run([step({ kind: 'attack' })]);
    const empowered = run([step({ kind: 'ability', slot: 'E' })]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());

    const expected = 90 + VI_CONSTANTS.e.totalAdRatio * stats.totalAttackDamage;
    const empoweredHit = empowered.instances.find((entry) => entry.slot === 'E');
    expect(empoweredHit).toBeDefined();
    expect(empoweredHit!.raw).toBeCloseTo(expected, 6);
    // Not the sum of a normal attack plus the bonus.
    expect(empoweredHit!.raw).toBeLessThan(expected + plain.instances[0]!.raw);
  });

  it('is consumed by exactly one attack', () => {
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    expect(result.instances.filter((entry) => entry.slot === 'E')).toHaveLength(1);
  });

  /**
   * "Q, AA, E" is three actions and has to produce three hits. The step is the
   * empowered attack, so it needs no attack step appended to do anything — that
   * modelling detail used to leak into the combo list.
   */
  it('swings as part of the step, with no attack step appended', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);
    expect(result.instances.filter((entry) => entry.slot === 'Q')).toHaveLength(1);
    expect(result.instances.filter((entry) => entry.sourceId === 'AA')).toHaveLength(1);
    expect(result.instances.filter((entry) => entry.slot === 'E')).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('treats an attack step after E as a second, ordinary attack', () => {
    const result = run([step({ kind: 'ability', slot: 'E' }), step({ kind: 'attack' })]);
    expect(result.instances.filter((entry) => entry.slot === 'E')).toHaveLength(1);
    expect(result.instances.filter((entry) => entry.sourceId === 'AA')).toHaveLength(1);
  });

  it('waits for a charge instead of swinging empty', () => {
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);

    // Two charges plus one recharge: all three swings are empowered, but the
    // third cannot happen until the counter has refilled.
    const swings = result.instances.filter((entry) => entry.slot === 'E');
    expect(swings).toHaveLength(3);

    const outOfCharges = result.events.filter(
      (event) => event.kind === 'wait' && event.detail.includes('no charge'),
    );
    expect(outOfCharges).toHaveLength(1);

    // Recharge is 8 s at rank 5 and starts with the first cast, so the third
    // swing lands after it — not two static cooldowns in.
    expect(swings[2]!.time).toBeGreaterThanOrEqual(8);
    expect(result.warnings).toEqual([]);
  });

  it('spends the second charge on the static cooldown, not the recharge timer', () => {
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);

    const swings = result.instances.filter((entry) => entry.slot === 'E');
    expect(swings).toHaveLength(2);
    // 1 s static gap between two uses — nowhere near the 8 s recharge.
    expect(swings[1]!.time).toBeGreaterThanOrEqual(1);
    expect(swings[1]!.time).toBeLessThan(2);
  });
});

/**
 * Cooldowns.
 *
 * The combo is a list of intentions, not a list of things that can happen at
 * will: an ability that is not up yet costs idle time, and that idle time is
 * part of the answer. A calculator that let three Qs resolve back to back would
 * report a burst no player can produce.
 */
describe('cooldowns', () => {
  it('waits out the cooldown instead of casting through it', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'ability', slot: 'Q' }, 0),
    ]);

    const casts = result.instances.filter((entry) => entry.slot === 'Q');
    expect(casts).toHaveLength(2);
    // Rank 5 Q is a 6 s cooldown in the fixture, as it is in the game.
    expect(casts[1]!.time - casts[0]!.time).toBeGreaterThanOrEqual(6);

    const waits = result.events.filter((event) => event.kind === 'wait');
    expect(waits).toHaveLength(1);
    expect(waits[0]!.detail).toContain('cooldown');
  });

  /**
   * The cooldown starts when Q is released, so the dash runs inside it.
   *
   * That makes the gap between two hits exactly the cooldown, whether the Q was
   * tapped or held: the charge is spent before the cooldown starts and the dash
   * after. Starting the clock at the moment of impact instead — as it did
   * before — added the dash on top and stretched every rotation by 0.25 s.
   */
  it('starts a charged cooldown on release, so the dash runs inside it', () => {
    const gapBetweenHits = (first: number, second: number) => {
      const hits = run([
        step({ kind: 'ability', slot: 'Q' }, first),
        step({ kind: 'ability', slot: 'Q' }, second),
      ]).instances.filter((entry) => entry.slot === 'Q');
      return hits[1]!.time - hits[0]!.time;
    };

    // Whether the first Q was tapped or held for its full 1.25 s, the next hit
    // is exactly one cooldown later — the hold happened before the cooldown
    // started, the dash inside it.
    expect(gapBetweenHits(0, 0)).toBeCloseTo(6, 6);
    expect(gapBetweenHits(1.25, 0)).toBeCloseTo(6, 6);

    // Charging the *second* Q does cost extra: that hold is still ahead.
    expect(gapBetweenHits(1.25, 1.25)).toBeCloseTo(7.25, 6);
  });

  it('shortens cooldowns with ability haste, but never the static charge gap', () => {
    const hasted = { ...emptyStats(), abilityHaste: 100 };

    const q = run(
      [step({ kind: 'ability', slot: 'Q' }, 0), step({ kind: 'ability', slot: 'Q' }, 0)],
      { bonusStats: hasted },
    );
    const qCasts = q.instances.filter((entry) => entry.slot === 'Q');
    // 100 haste halves a 6 s cooldown.
    expect(qCasts[1]!.time - qCasts[0]!.time).toBeGreaterThanOrEqual(3);
    expect(qCasts[1]!.time - qCasts[0]!.time).toBeLessThan(4);

    const e = run(
      [step({ kind: 'ability', slot: 'E' }), step({ kind: 'ability', slot: 'E' })],
      { bonusStats: hasted },
    );
    const eSwings = e.instances.filter((entry) => entry.slot === 'E');
    // The 1 s gap between two charges is static — haste does not touch it.
    expect(eSwings[1]!.time).toBeGreaterThanOrEqual(1);
  });

  it('costs no idle time when the combo is already long enough', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'wait', seconds: 8 }),
      step({ kind: 'ability', slot: 'Q' }, 0),
    ]);
    expect(result.events.some((event) => event.kind === 'wait')).toBe(false);
    expect(result.instances.filter((entry) => entry.slot === 'Q')).toHaveLength(2);
  });

  /**
   * Vi's ultimate takes her with it: she grabs the target and cannot act for as
   * long as it is airborne. An attack written after R therefore cannot land at
   * the cast time — it lands after the grab, which is the knock-up's duration.
   */
  it('locks Vi out of attacking for the length of the ultimate grab', () => {
    const knockup = VI_CONSTANTS.r.knockupSeconds;
    const cast = VI_CONSTANTS.r.castSeconds;
    const result = run([
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'attack' }),
    ]);
    const ult = result.instances.find((entry) => entry.slot === 'R');
    const attack = result.instances.find((entry) => entry.sourceKind === 'attack');
    expect(ult).toBeDefined();
    expect(attack).toBeDefined();
    // The attack cannot precede the end of the grab that follows the ultimate.
    expect(attack!.time - ult!.time).toBeGreaterThanOrEqual(knockup - 0.01);
    // And the cast block on the timeline covers the cast, the dash and the lock.
    const castSpan = result.spans.find((span) => span.lane === 'R' && span.kind === 'cast');
    expect(castSpan).toBeDefined();
    expect(castSpan!.fullSeconds).toBeGreaterThanOrEqual(cast + knockup - 0.01);
    expect(castSpan!.parts?.some((part) => part.label === 'locked')).toBe(true);
  });

  /**
   * The combo stops at the kill: everything after it is damage into a corpse,
   * and counting it inflates every total on the page.
   */
  it('stops the combo once the target is dead and reports the unused steps', () => {
    // Frail enough that a charged Q is certainly lethal, whatever the patch
    // does to Vi's numbers.
    const frail = { ...TARGET, maxHealth: 60, armor: 0 };
    const result = run(
      [
        step({ kind: 'ability', slot: 'Q' }, 1.25),
        step({ kind: 'attack' }),
        step({ kind: 'attack' }),
        step({ kind: 'attack' }),
      ],
      { target: frail },
    );
    expect(result.killTime).not.toBeNull();
    // The first hit is enough, so the three attacks never happen.
    expect(result.unusedSteps.length).toBeGreaterThan(0);
    expect(result.instances.filter((entry) => entry.sourceKind === 'attack')).toHaveLength(0);
    expect(result.events.some((event) => event.kind === 'kill')).toBe(true);
    /*
     * The kill is the last thing in the log: nothing lands after it, and the
     * note about unused steps lives on the combo strip, not in the table.
     */
    const kill = result.events.find((event) => event.kind === 'kill')!;
    const later = result.instances.filter((entry) => entry.seq > kill.seq);
    expect(later).toHaveLength(0);
  });

  /**
   * Mana is spent, and a cast nobody can pay for does not happen.
   */
  it('spends mana on casts and refuses the one it cannot pay for', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const after = result.snapshots[result.snapshots.length - 1]!;
    /*
     * The expected sum comes from the fixture rather than from a number typed
     * here: the fixture is a snapshot of a real patch, and Riot moves costs.
     */
    const expected =
      (FIXTURE_SPELLS_BY_ID.ViQ?.cost[4] ?? 0) + (FIXTURE_SPELLS_BY_ID.ViR?.cost[2] ?? 0);
    expect(expected).toBeGreaterThan(0);
    expect(result.manaSpent).toBeCloseTo(expected, 0);
    /*
     * Not exactly the difference: mana regenerates while the combo runs, so the
     * pool is the spend plus whatever came back over those seconds. It can only
     * ever be more than the naive figure, never less.
     */
    const naive = after.attackerResource.max - expected;
    expect(after.attackerResource.current).toBeGreaterThanOrEqual(naive - 0.01);
    expect(after.attackerResource.current).toBeLessThan(naive + 30);
  });

  it('skips an ability the pool cannot pay for', () => {
    const dry = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, {
      ...emptyStats(),
      // A negative pool is not a thing; this drains it to almost nothing.
      mana: -FIXTURE_CHAMPION_STATS.mp * 10,
    });
    const result = run([step({ kind: 'ability', slot: 'R' })], { attackerStats: dry });
    expect(result.instances.filter((entry) => entry.slot === 'R')).toHaveLength(0);
    expect(result.warnings.some((warning) => /mana/i.test(warning))).toBe(true);
  });

  it('waits out a 90 s ultimate rather than double-counting it', () => {
    const result = run([
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const casts = result.instances.filter((entry) => entry.slot === 'R');
    expect(casts).toHaveLength(2);
    expect(casts[1]!.time).toBeGreaterThanOrEqual(90);
  });

  /**
   * Past a point, waiting stops being a useful answer.
   *
   * A third ultimate is 180 s out, beyond the window the simulation covers.
   * Silently stretching the timeline that far would turn a burst comparison
   * into a three-minute fiction, so the step is dropped and named.
   */
  it('skips a step that cannot come up inside the simulated window', () => {
    const result = run([
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    expect(result.instances.filter((entry) => entry.slot === 'R')).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('skipped');
  });
});

describe('Denting Blows (W)', () => {
  it('procs on the third basic attack, not before', () => {
    const two = run([step({ kind: 'attack' }), step({ kind: 'attack' })]);
    expect(two.instances.some((entry) => entry.slot === 'W')).toBe(false);

    const three = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    expect(three.instances.filter((entry) => entry.slot === 'W')).toHaveLength(1);
  });

  it('deals a percentage of the target maximum health', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    const proc = result.instances.find((entry) => entry.slot === 'W')!;
    // Rank 5 is 8% of 3000 = 240 raw, with no bonus AD in this build.
    expect(proc.raw).toBeCloseTo(3000 * 0.08, 6);
  });

  it('caps against monsters', () => {
    const result = run(
      [step({ kind: 'attack' }), step({ kind: 'attack' }), step({ kind: 'attack' })],
      { target: { ...TARGET, maxHealth: 12000, unitType: 'monster' } },
    );
    const proc = result.instances.find((entry) => entry.slot === 'W')!;
    expect(proc.raw).toBeCloseTo(VI_CONSTANTS.w.monsterCap, 6);
  });

  it('shreds armor, so hits after the proc land harder than hits before it', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    expect(attacks).toHaveLength(4);
    // Same raw damage, more of it gets through once armor is reduced.
    expect(attacks[3]!.raw).toBeCloseTo(attacks[0]!.raw, 4);
    expect(attacks[3]!.mitigated).toBeGreaterThan(attacks[0]!.mitigated);
  });

  /**
   * The shred lands after the damage that triggered it. Riot resolves it that
   * way, and it matters: the third attack and the proc itself still meet the
   * target's full armor, only what comes afterwards benefits.
   */
  it('applies the armor reduction after the triggering damage, not before', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    const proc = result.instances.find((entry) => entry.slot === 'W')!;

    // The share that gets through is the armor multiplier; equal shares mean
    // equal armor. The first three attacks and the proc all see 100 armor.
    const share = (raw: number, mitigated: number) => mitigated / raw;
    const unshredded = share(attacks[0]!.raw, attacks[0]!.mitigated);
    expect(share(attacks[1]!.raw, attacks[1]!.mitigated)).toBeCloseTo(unshredded, 6);
    expect(share(attacks[2]!.raw, attacks[2]!.mitigated)).toBeCloseTo(unshredded, 6);
    expect(share(proc.raw, proc.mitigated)).toBeCloseTo(unshredded, 6);

    // Only the fourth one lands into reduced armor.
    expect(share(attacks[3]!.raw, attacks[3]!.mitigated)).toBeGreaterThan(unshredded);
  });

  /**
   * Vault Breaker applies Denting Blows itself — its own tooltip says so. That
   * makes Q → AA → E proc on the E, which is the sequence people actually play.
   */
  it('counts Vault Breaker as a Denting Blows hit', () => {
    const withQ = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);
    expect(withQ.instances.filter((entry) => entry.slot === 'W')).toHaveLength(1);

    // Without the Q the same two attacks are only two hits, so nothing procs.
    const withoutQ = run([step({ kind: 'attack' }), step({ kind: 'ability', slot: 'E' })]);
    expect(withoutQ.instances.filter((entry) => entry.slot === 'W')).toHaveLength(0);
  });

  it('procs on the second attack after a Vault Breaker', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    const proc = result.instances.find((entry) => entry.slot === 'W');
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    expect(proc).toBeDefined();
    // Third hit overall, so it lands together with the second attack.
    expect(proc!.time).toBeCloseTo(attacks[1]!.time, 6);
  });

  it('does not count the ultimate as a Denting Blows hit', () => {
    // R deals damage but applies nothing; two attacks plus R stay below three.
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'attack' }),
    ]);
    expect(result.instances.filter((entry) => entry.slot === 'W')).toHaveLength(0);
  });
});

describe('Cease and Desist (R)', () => {
  it('uses the maintained base damage and scales off bonus AD', () => {
    const result = run([step({ kind: 'ability', slot: 'R' })], {
      bonusStats: { ...emptyStats(), attackDamage: 100 },
    });
    const expected = VI_CONSTANTS.r.base[2]! + VI_CONSTANTS.r.bonusAdRatio * 100;
    expect(result.instances[0]!.raw).toBeCloseTo(expected, 6);
  });
});

describe('Blast Shield (P)', () => {
  it('shields for a percentage of Vi maximum health when an ability lands', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 0)]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    expect(result.shieldGained).toBeCloseTo(
      stats.maxHealth * VI_CONSTANTS.passive.maxHealthPercent,
      6,
    );
  });

  it('does not proc on basic attacks', () => {
    const result = run([step({ kind: 'attack' }), step({ kind: 'attack' })]);
    expect(result.shieldGained).toBe(0);
  });

  it('only procs once while on cooldown', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    expect(result.shieldGained).toBeCloseTo(
      stats.maxHealth * VI_CONSTANTS.passive.maxHealthPercent,
      6,
    );
  });

  /**
   * Denting Blows refunds part of the shield's cooldown, which is the only way
   * the shield comes back inside a single combo.
   */
  it('comes back sooner when Denting Blows procs', () => {
    /**
     * The window is picked so that only the refund can explain the result. At
     * level 11 the shield's cooldown is 12 s and the refund is 4 s, so it is
     * ready again at 8 s. Both combos put the ultimate at roughly 10.3 s: past
     * the shortened cooldown, still short of the full one. The three attacks
     * cost time themselves, which is why the ultimate is timed rather than the
     * wait — a test that only compared combo lengths would pass without any
     * refund at all.
     */
    const withoutProc = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'wait', seconds: 10 }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const withProc = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 7 }),
      step({ kind: 'ability', slot: 'R' }),
    ]);

    const ultimate = (result: ReturnType<typeof run>) =>
      result.instances.find((entry) => entry.slot === 'R')!.time;
    expect(ultimate(withoutProc)).toBeGreaterThan(8);
    expect(ultimate(withoutProc)).toBeLessThan(12);
    expect(ultimate(withProc)).toBeGreaterThan(8);
    expect(ultimate(withProc)).toBeLessThan(12);

    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const oneShield = stats.maxHealth * VI_CONSTANTS.passive.maxHealthPercent;
    expect(withoutProc.shieldGained).toBeCloseTo(oneShield, 6);
    expect(withProc.shieldGained).toBeCloseTo(oneShield * 2, 6);
  });
});

describe('combo ordering', () => {
  it('changes the result when the same steps are reordered', () => {
    const shredFirst = run([
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const ultFirst = run([
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ]);
    // The ultimate lands into shredded armor in the first ordering.
    expect(shredFirst.totalMitigated).toBeGreaterThan(ultFirst.totalMitigated);
  });
});

describe('analysis', () => {
  it('accounts for every instance exactly once', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 1.25),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }),
    ]);
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const report = analyse(result, TARGET, stats);

    const summed = report.bySource.reduce((total, entry) => total + entry.mitigated, 0);
    expect(summed).toBeCloseTo(report.totalMitigated, 6);
    expect(report.curve.at(-1)!.cumulative).toBeCloseTo(report.totalMitigated, 6);
  });

  it('reports a kill time once the target runs out of health', () => {
    const result = run(Array.from({ length: 12 }, () => step({ kind: 'attack' })), {
      target: { ...TARGET, maxHealth: 400 },
    });
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, emptyStats());
    const report = analyse(result, { ...TARGET, maxHealth: 400 }, stats);
    expect(report.killTime).not.toBeNull();
    expect(report.missingDamage).toBe(0);
  });
});

describe('stat scaling', () => {
  it('uses Riot growth curve, not linear interpolation', () => {
    // At level 2 a growth stat gains only 72% of its per-level value.
    expect(statAtLevel(100, 100, 2)).toBeCloseTo(100 + 100 * 0.72, 6);
    expect(statAtLevel(100, 100, 1)).toBe(100);
    expect(statAtLevel(100, 100, 18)).toBeCloseTo(100 + 100 * 17 * (0.7025 + 0.0175 * 17), 6);
  });

  it('caps total attack speed at 2.5', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 18, {
      ...emptyStats(),
      attackSpeed: 10,
    });
    expect(stats.totalAttackSpeed).toBe(2.5);
  });

  /**
   * Hail of Blades says it may exceed the limit, so its bonus is booked on top
   * of the capped total rather than into it.
   */
  it('lets an over-cap source push past 2.5', () => {
    const bonus = { ...emptyStats(), attackSpeed: 10, attackSpeedOverCap: 0.9 };
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 18, bonus);
    expect(stats.totalAttackSpeed).toBeCloseTo(2.5 + stats.attackSpeedRatio * 0.9, 6);
    expect(stats.totalAttackSpeed).toBeGreaterThan(2.5);
  });

  it('still caps everything that is not marked as over-cap', () => {
    const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 18, {
      ...emptyStats(),
      attackSpeed: 10,
      attackSpeedOverCap: 0,
    });
    expect(stats.totalAttackSpeed).toBe(2.5);
  });

  /**
   * An attack-speed buff granted by a hit has to shorten the wait for the very
   * next attack. It used to take effect one attack later, because the timer was
   * computed from the attack speed the attack started with.
   */
  it('applies attack speed gained during an attack to the next one', () => {
    const result = run(Array.from({ length: 5 }, () => step({ kind: 'attack' })));
    const hits = result.instances
      .filter((entry) => entry.sourceId === 'AA')
      .map((entry) => entry.time);

    const beforeProc = hits[1]! - hits[0]!;
    const acrossProc = hits[3]! - hits[2]!;
    const afterProc = hits[4]! - hits[3]!;

    // Denting Blows procs on the third attack. The gap right after it already
    // runs at the buffed rate, not one attack later.
    expect(acrossProc).toBeLessThan(beforeProc);
    expect(acrossProc).toBeCloseTo(afterProc, 6);
  });
});

/**
 * Timeline spans.
 *
 * The timeline draws nothing but what is produced here — it never recomputes
 * anything itself. Every length in the view is therefore a claim made by the
 * engine, and these tests check exactly those claims: when something starts,
 * when it ends, and which lane it sits on.
 */
describe('timeline spans', () => {
  const spansOf = (result: ReturnType<typeof run>, kind: string) =>
    result.spans.filter((span) => span.kind === kind);

  it('breaks a charged cast into its named parts', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 1.25)]);
    const cast = spansOf(result, 'cast').find((span) => span.lane === 'Q');

    expect(cast).toBeDefined();
    expect(cast!.start).toBeCloseTo(0, 6);
    expect(cast!.end).toBeCloseTo(1.5, 6);
    // The charge time is the first part and has to stay a section of its own:
    // it is time the player chose to spend, the dash after it is not.
    expect(cast!.parts?.map((part) => part.label)).toEqual(['charge', 'dash to target']);
    expect(cast!.parts?.[0]?.seconds).toBeCloseTo(1.25, 6);
  });

  it('starts the cooldown span on release, not on impact', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 1.25)]);
    const cooldown = spansOf(result, 'cooldown').find((span) => span.lane === 'Q');

    expect(cooldown).toBeDefined();
    expect(cooldown!.start).toBeCloseTo(1.25, 6);
    expect(cooldown!.end).toBeCloseTo(7.25, 6);
  });

  /** Two timers, two bars — otherwise the view only ever claims one of them. */
  it('gives an ability with charges both a static gap and a recharge timer', () => {
    const result = run([step({ kind: 'ability', slot: 'E' })]);
    const eSpans = result.spans.filter((span) => span.lane === 'E');

    const staticGap = eSpans.find((span) => span.kind === 'cooldown');
    const recharge = eSpans.find((span) => span.kind === 'recharge');

    expect(staticGap?.end).toBeCloseTo((staticGap?.start ?? 0) + 1, 6);
    expect(recharge?.end).toBeCloseTo((recharge?.start ?? 0) + 8, 6);
  });

  it('records forced idle time as its own span', () => {
    const result = run([
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'ability', slot: 'Q' }, 0),
    ]);
    const idle = spansOf(result, 'idle');

    expect(idle).toHaveLength(1);
    expect(idle[0]!.lane).toBe('idle');
    expect(idle[0]!.end).toBeCloseTo(6, 6);
    expect(idle[0]!.detail).toContain('cooldown');
  });

  /**
   * A reset attack timer ends — it does not merely get shorter.
   *
   * As long as it kept its original length, the view drew a timer still running
   * next to the very attack that had cancelled it.
   */
  it('ends the attack timer where a reset cancelled it', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);
    const cancelled = spansOf(result, 'attack-timer').find((span) =>
      span.detail?.includes('cancelled'),
    );

    expect(cancelled).toBeDefined();
    // The reset happens as E is cast; no older timer is left running after it.
    const stillRunning = spansOf(result, 'attack-timer').filter(
      (span) => span.start < cancelled!.end && span.end > cancelled!.end,
    );
    expect(stillRunning).toEqual([]);
  });

  it('puts the empowered attack on the ability lane, not the attack lane', () => {
    const result = run([step({ kind: 'ability', slot: 'E' })]);
    const casts = spansOf(result, 'cast');

    // One step, one lane: the empowered attack belongs to E, just as its hit does.
    expect(casts.every((span) => span.lane === 'E')).toBe(true);
    expect(casts.some((span) => span.label.includes('Relentless Force'))).toBe(true);
  });

  /** One effect, one window — even when it refreshes itself several times. */
  it('merges a refreshing effect into one window', () => {
    const result = run(Array.from({ length: 6 }, () => step({ kind: 'attack' })));
    const shred = result.spans.filter(
      (span) => span.kind === 'effect' && span.label === 'Denting Blows (W)',
    );

    expect(shred).toHaveLength(1);
    // Two procs across six attacks: the window has to reach over both of them.
    expect(shred[0]!.end - shred[0]!.start).toBeGreaterThan(4);
  });

  it('drops spans of no length', () => {
    const result = run([step({ kind: 'attack' })]);
    expect(result.spans.every((span) => span.end > span.start)).toBe(true);
  });
});

/**
 * One bar per timer, whatever the combo does inside it.
 *
 * Found by an adversarial review of the timeline view: the recharge timer runs
 * across uses, so casting twice inside one window drew the same interval twice
 * and the view stacked the duplicate into a second row — two bars claiming two
 * timers where the simulation only ever had one.
 */
describe('span de-duplication', () => {
  it('draws one recharge window even when two charges are spent inside it', () => {
    const result = run([
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'ability', slot: 'E' }),
    ]);
    const recharge = result.spans.filter((span) => span.kind === 'recharge');

    expect(recharge).toHaveLength(1);
    // The timer belongs to the first cast and is not restarted by the second.
    expect(recharge[0]!.start).toBeLessThan(1);
    expect(recharge[0]!.detail).toContain('0/2');
  });
});

/**
 * Findings from the adversarial review of the timeline work.
 *
 * Each of these is a defect that survived two independent attempts to refute it,
 * so each gets a test that fails if it comes back.
 */
describe('review findings', () => {
  /**
   * Waiting for the attack timer can outlast the buff that set its pace.
   *
   * The stats were read before the wait, so an attack queued behind a slow timer
   * computed its wind-up — and the timer it left behind — from attack speed Vi
   * no longer had by the time she actually swung.
   */
  it('computes the wind-up from the attack speed at the moment of the swing', () => {
    // Six attacks: Denting Blows procs on the third and grants attack speed for
    // 4 s. The attacks after the buff expires must be slower again.
    const result = run(Array.from({ length: 8 }, () => step({ kind: 'attack' })));
    const windups = result.spans
      .filter((span) => span.lane === 'AA' && span.kind === 'cast')
      .map((span) => Number(span.fullSeconds.toFixed(4)));

    // Some wind-up while buffed, some unbuffed: the values must not all be equal,
    // and the buffed ones must be the shorter ones.
    const distinct = [...new Set(windups)];
    expect(distinct.length).toBeGreaterThan(1);
    expect(Math.min(...windups)).toBeLessThan(Math.max(...windups));
  });

  it('draws a deliberate wait as its own span', () => {
    const result = run([
      step({ kind: 'attack' }),
      step({ kind: 'wait', seconds: 2 }),
      step({ kind: 'attack' }),
    ]);
    const waits = result.spans.filter((span) => span.kind === 'idle');

    expect(waits).toHaveLength(1);
    expect(waits[0]!.fullSeconds).toBeCloseTo(2, 6);
    // Distinguishable from forced idle time, which names the ability blocking it.
    expect(waits[0]!.detail).toContain('deliberate');
  });
});

/**
 * A stacking buff is one window, however often it restacks.
 *
 * Conqueror writes its stack count into its own label ("Conqueror · 6/12
 * stacks"), so matching effect windows by their text produced a fresh bar for
 * every stack — six attacks drew six overlapping bars for one continuous buff,
 * and the timeline stacked them into six rows.
 */
describe('stacking buffs', () => {
  it('keeps one effect window while a stacking buff restacks', () => {
    const result = run(Array.from({ length: 6 }, () => step({ kind: 'attack' })), {
      attacker: {
        championId: 'Vi',
        level: 11,
        ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
        itemIds: [],
        runeIds: [8010],
        shardIds: [],
        manualStats: {},
      },
    });

    const conqueror = result.spans.filter(
      (span) => span.kind === 'effect' && span.label.startsWith('Conqueror'),
    );
    expect(conqueror).toHaveLength(1);
    // The one bar reports the latest stack count, not the first: six melee hits
    // are two stacks each, so it ends fully stacked.
    expect(conqueror[0]!.label).toContain('12/12');
  });
});


/**
 * State snapshots.
 *
 * The stats view answers "what were the numbers at this point in the combo",
 * which only works if the simulation records the state it computed with rather
 * than letting the app recompute it. These tests hold that line: the snapshot has
 * to agree with the damage that was actually dealt.
 */
describe('stat snapshots', () => {
  it('records one snapshot per step, plus the state before the combo', () => {
    const combo = [
      step({ kind: 'ability', slot: 'Q' }, 0),
      step({ kind: 'attack' }),
      step({ kind: 'attack' }),
    ];
    const result = run(combo);

    expect(result.snapshots).toHaveLength(combo.length + 1);
    expect(result.snapshots[0]!.index).toBe(-1);
    expect(result.snapshots[0]!.stepUid).toBeUndefined();
    expect(result.snapshots.slice(1).map((entry) => entry.stepUid)).toEqual(
      combo.map((entry) => entry.uid),
    );
  });

  it('reports the target health the combo actually left behind', () => {
    const result = run([step({ kind: 'attack' }), step({ kind: 'attack' })]);
    const last = result.snapshots[result.snapshots.length - 1]!;

    expect(last.target.currentHealth).toBeCloseTo(result.targetHpRemaining, 6);
    expect(last.damageDone).toBeCloseTo(result.totalMitigated, 6);
  });

  /**
   * The effective armour in a snapshot is the number the damage was computed
   * against, not a fresh guess: after Denting Blows procs it has to be 20 % lower.
   */
  it('reports armor as the damage actually met it', () => {
    const result = run(Array.from({ length: 3 }, () => step({ kind: 'attack' })));
    const before = result.snapshots[1]!;
    const afterProc = result.snapshots[result.snapshots.length - 1]!;

    expect(before.target.effectiveArmor).toBeCloseTo(TARGET.armor, 6);
    expect(afterProc.target.effectiveArmor).toBeCloseTo(TARGET.armor * 0.8, 6);
    expect(afterProc.active.some((entry) => entry.label.startsWith('Denting Blows'))).toBe(true);
  });

  it('carries the attack speed the buff granted', () => {
    const result = run(Array.from({ length: 3 }, () => step({ kind: 'attack' })));
    const first = result.snapshots[1]!;
    const last = result.snapshots[result.snapshots.length - 1]!;

    expect(last.attacker.totalAttackSpeed).toBeGreaterThan(first.attacker.totalAttackSpeed);
  });
});

/**
 * Effects are classified by what they do, so the timeline can colour them.
 *
 * The distinction that matters when reading a combo is not where an effect came
 * from but which way it points. Denting Blows produces one of each in the same
 * instant — attack speed for Vi, an armour shred on the target — and filing both
 * as "an effect" is what made them look like one thing.
 */
describe('effect classification', () => {
  it('separates a target debuff from the buff applied alongside it', () => {
    const result = run(Array.from({ length: 3 }, () => step({ kind: 'attack' })));

    const debuffs = result.spans.filter((span) => span.lane === 'debuff');
    const buffs = result.spans.filter((span) => span.lane === 'buff');

    // The armour shred sits on the target …
    expect(debuffs.map((span) => span.label)).toContain('Denting Blows (W)');
    expect(debuffs.every((span) => span.effectKind === 'debuff')).toBe(true);

    // … while the attack speed it grants is a buff on Vi.
    expect(buffs.some((span) => span.label.includes('attack speed'))).toBe(true);
  });

  it('calls a damage buff offensive and a shield defensive', () => {
    const result = run([step({ kind: 'ability', slot: 'Q' }, 0), step({ kind: 'attack' }), step({ kind: 'attack' }), step({ kind: 'attack' })]);
    const byLabel = (needle: string) =>
      result.spans.find((span) => span.label.includes(needle));

    // Blast Shield keeps Vi alive and adds no damage.
    expect(byLabel('Blast Shield')?.effectKind).toBe('defense');
    // Attack speed does add damage.
    expect(byLabel('attack speed')?.effectKind).toBe('offense');
  });

  it('records whether an effect came from the kit or from gear', () => {
    const result = run(Array.from({ length: 4 }, () => step({ kind: 'attack' })), {
      attacker: {
        championId: 'Vi',
        level: 11,
        ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
        itemIds: [],
        runeIds: [9923],
        shardIds: [],
        manualStats: {},
      },
    });

    const rune = result.spans.find((span) => span.label === 'Hail of Blades');
    const kit = result.spans.find((span) => span.label === 'Denting Blows (W)');

    expect(rune?.effectOrigin).toBe('gear');
    expect(kit?.effectOrigin).toBe('champion');
  });
});
