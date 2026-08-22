/*
 * These run against the real registry: this family is wired into
 * `src/model/itemEffects.ts`, so the engine finds the effects on its own. The
 * suite used to widen the registry with a module mock, which is what a family
 * needs *before* it is registered — leaving it in place afterwards applied every
 * effect twice and squared every amplifier.
 */

import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import {
  DEFAULT_TIMINGS,
  type ComboStep,
  type DamageInstance,
  type SimulationInput,
  type TargetConfig,
} from '../src/engine/types';
import { VI_MODULE } from '../src/model/champions/vi';
import type { ChampionModuleContext } from '../src/model/champions/types';
import { emptyStats, resolveChampionStats, type StatBlock } from '../src/model/stats';
import { getItemEffect } from '../src/model/itemEffects';
import { ABILITY_ITEMS, ABILITY_ITEM_NUMBERS } from '../src/model/items/ability';
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

/**
 * No resistances anywhere, so `raw` and `mitigated` are the same number.
 *
 * These tests are about what each passive produces, not about what armour does
 * to it — the mitigation pipeline has its own suite. Zero resistances mean a
 * failure here can only be the item.
 */
const BARE_TARGET: TargetConfig = {
  name: 'Testziel',
  level: 11,
  maxHealth: 4000,
  currentHealthPercent: 1,
  armor: 0,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  uid += 1;
  return chargeSeconds === undefined
    ? { uid: `a${uid}`, action }
    : { uid: `a${uid}`, action, chargeSeconds };
}

const attack = () => step({ kind: 'attack' });
const ability = (slot: 'Q' | 'W' | 'E' | 'R', charge?: number) =>
  charge === undefined
    ? step({ kind: 'ability', slot })
    : step({ kind: 'ability', slot }, charge);

interface RunOptions {
  itemIds?: string[];
  bonus?: Partial<StatBlock>;
  target?: Partial<TargetConfig>;
}

function run(combo: ComboStep[], options: RunOptions = {}) {
  const bonusStats: StatBlock = { ...emptyStats(), ...options.bonus };
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 11,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds: options.itemIds ?? [],
      runeIds: [],
      shardIds: [],
      manualStats: {},
    },
    championBaseStats: FIXTURE_CHAMPION_STATS,
    attackerStats: resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, bonusStats),
    bonusStats,
    target: { ...BARE_TARGET, ...options.target },
    combo,
    timings: { ...DEFAULT_TIMINGS },
    critMode: 'never',
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

/** The stat block the simulation would compute for a given bonus block. */
function statsFor(bonus: Partial<StatBlock> = {}) {
  return resolveChampionStats(FIXTURE_CHAMPION_STATS, 11, { ...emptyStats(), ...bonus });
}

const from = (result: ReturnType<typeof run>, label: string): DamageInstance[] =>
  result.instances.filter((entry) => entry.sourceLabel.startsWith(label));

/* ------------------------------------------------------------- the family itself */

describe('the ability item family', () => {
  it('claims one id each, and claims nothing empty', () => {
    const ids = ABILITY_ITEMS.map((effect) => effect.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const effect of ABILITY_ITEMS) {
      expect(effect.modelled, effect.name).toBe(true);
      // Something has to actually happen, or the entry is a claim with nothing
      // behind it.
      expect(Boolean(effect.createRuntime ?? effect.amplify), effect.name).toBe(true);
      expect(effect.note.length, effect.name).toBeGreaterThan(20);
    }
  });

  it('is reachable through the registry the engine reads', () => {
    // Guards the mock itself: without this, a broken mock would leave every
    // test below quietly measuring a build with no items in it.
    for (const effect of ABILITY_ITEMS) {
      expect(getItemEffect(effect.id)?.name, effect.id).toBe(effect.name);
    }
  });
});

/* ------------------------------------------------------------------- Lich Bane */

describe('Lich Bane · Spellblade (3100)', () => {
  const { lichBane } = ABILITY_ITEM_NUMBERS;
  /*
   * Bonus attack damage on purpose, even though the spellblade does not scale
   * with it: it is what makes base AD and total AD two different numbers, so an
   * implementation that reached for the wrong one would fail here instead of
   * passing on a coincidence.
   */
  const bonus = { abilityPower: 200, attackDamage: 100 };
  const spellblade = () => {
    const stats = statsFor(bonus);
    return lichBane.baseAdRatio * stats.baseAttackDamage + lichBane.apRatio * stats.abilityPower;
  };

  it('adds base AD and ability power to the attack after an ability', () => {
    const result = run([ability('Q', 0), attack()], { itemIds: ['3100'], bonus });
    const procs = from(result, 'Lich Bane');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(spellblade(), 6);
    // Both halves have to be in there. Either one alone would be wrong, and the
    // sum on its own would not say which half went missing.
    expect(procs[0]!.raw).toBeGreaterThan(lichBane.apRatio * statsFor(bonus).abilityPower);
    expect(procs[0]!.raw).toBeGreaterThan(lichBane.baseAdRatio * statsFor(bonus).baseAttackDamage);
    // Base AD, not total: the bonus attack damage in this build is not part of it.
    expect(procs[0]!.raw).toBeLessThan(
      lichBane.baseAdRatio * statsFor(bonus).totalAttackDamage +
        lichBane.apRatio * statsFor(bonus).abilityPower,
    );
  });

  it('rides the empowered attack that Relentless Force casts for itself', () => {
    // E is one step that casts an ability *and* swings, so the spellblade has
    // to be armed by the cast and spent by the swing inside that single step.
    const result = run([ability('E')], { itemIds: ['3100'], bonus });
    expect(from(result, 'Lich Bane')).toHaveLength(1);
  });

  it('is spent by exactly one attack', () => {
    const result = run([ability('Q', 0), attack(), attack()], { itemIds: ['3100'], bonus });
    expect(from(result, 'Lich Bane')).toHaveLength(1);
  });

  it('does not arm again inside its own cooldown', () => {
    // Two E casts sit one static charge gap apart, which is shorter than the
    // spellblade cooldown, so the second cast finds it unavailable.
    const result = run([ability('E'), ability('E')], { itemIds: ['3100'], bonus });
    const procs = from(result, 'Lich Bane');
    const swings = result.instances.filter((entry) => entry.slot === 'E');

    expect(swings).toHaveLength(2);
    expect(procs).toHaveLength(1);
    // The premise of the test, asserted rather than assumed: the second swing
    // really does fall inside the cooldown the first proc started.
    expect(swings[1]!.time - procs[0]!.time).toBeLessThan(lichBane.cooldownSeconds);
  });

  it('does nothing for an attack with no ability before it', () => {
    const result = run([attack(), attack()], { itemIds: ['3100'], bonus });
    expect(from(result, 'Lich Bane')).toHaveLength(0);
  });
});

/* ----------------------------------------------------------------- Shadowflame */

describe('Shadowflame · Cinderbloom (4645)', () => {
  const { shadowflame, lichBane } = ABILITY_ITEM_NUMBERS;
  const bonus = { abilityPower: 200, attackDamage: 100 };
  // Lich Bane supplies the magic damage: Vi's own kit is entirely physical, so
  // without it there would be nothing for Cinderbloom to amplify.
  const combo = () => [ability('Q', 0), attack()];
  /** Under the threshold, with room left to take the combo without dying. */
  const wounded = { maxHealth: 4000, currentHealthPercent: shadowflame.healthThreshold - 0.1 };
  const magic = (result: ReturnType<typeof run>) => from(result, 'Lich Bane')[0]!;

  it('raises magic damage against a target under the health threshold', () => {
    const plain = run(combo(), { itemIds: ['3100'], bonus, target: wounded });
    const amped = run(combo(), { itemIds: ['3100', '4645'], bonus, target: wounded });

    expect(magic(amped).raw / magic(plain).raw).toBeCloseTo(1 + shadowflame.damageAmp, 6);

    // And the absolute figure, so a change to either constant is caught.
    const stats = statsFor(bonus);
    const unamplified =
      lichBane.baseAdRatio * stats.baseAttackDamage + lichBane.apRatio * stats.abilityPower;
    expect(magic(amped).raw).toBeCloseTo(unamplified * (1 + shadowflame.damageAmp), 6);
  });

  it('leaves physical damage alone', () => {
    const plain = run(combo(), { itemIds: ['3100'], bonus, target: wounded });
    const amped = run(combo(), { itemIds: ['3100', '4645'], bonus, target: wounded });
    const vault = (result: ReturnType<typeof run>) =>
      result.instances.find((entry) => entry.slot === 'Q')!;

    expect(vault(amped).raw).toBeCloseTo(vault(plain).raw, 6);
  });

  it('does nothing while the target is above the threshold', () => {
    const healthy = { maxHealth: 40000, currentHealthPercent: 1 };
    const plain = run(combo(), { itemIds: ['3100'], bonus, target: healthy });
    const amped = run(combo(), { itemIds: ['3100', '4645'], bonus, target: healthy });

    expect(magic(amped).raw).toBeCloseTo(magic(plain).raw, 6);
  });
});

/* --------------------------------------------------------------- Luden's Echo */

describe("Luden's Echo (6655)", () => {
  const { ludens } = ABILITY_ITEM_NUMBERS;
  const abilityPower = 200;
  const bonus = { abilityPower };
  const oneEcho = ludens.baseDamage + ludens.apRatio * abilityPower;
  const echoes = (result: ReturnType<typeof run>) => from(result, "Luden's Echo");

  it('fires the single-target worth of echoes off a damaging ability', () => {
    const result = run([ability('Q', 0)], { itemIds: ['6655'], bonus });
    const procs = echoes(result);

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(oneEcho * ludens.singleTargetEchoes, 6);
    // Two echoes' worth into one target — not one, and not all six.
    expect(procs[0]!.raw).toBeGreaterThan(oneEcho);
    expect(procs[0]!.raw).toBeLessThan(oneEcho * 6);
  });

  it('scales with ability power', () => {
    const withoutAp = run([ability('Q', 0)], { itemIds: ['6655'] });
    const withAp = run([ability('Q', 0)], { itemIds: ['6655'], bonus });

    expect(echoes(withoutAp)[0]!.raw).toBeCloseTo(
      ludens.baseDamage * ludens.singleTargetEchoes,
      6,
    );
    expect(echoes(withAp)[0]!.raw).toBeCloseTo(oneEcho * ludens.singleTargetEchoes, 6);
    expect(echoes(withAp)[0]!.raw).toBeGreaterThan(echoes(withoutAp)[0]!.raw);
  });

  it('holds its cooldown across a second ability in the same combo', () => {
    const result = run([ability('Q', 0), ability('R')], { itemIds: ['6655'], bonus });
    const casts = result.instances.filter((entry) => entry.slot === 'Q' || entry.slot === 'R');

    expect(casts).toHaveLength(2);
    expect(casts[1]!.time - casts[0]!.time).toBeLessThan(ludens.cooldownSeconds);
    expect(echoes(result)).toHaveLength(1);
  });

  it('ignores basic attacks and the Denting Blows proc', () => {
    // Three attacks land the W proc, which the engine books as passive damage
    // rather than ability damage — so nothing in this combo is an ability.
    const result = run([attack(), attack(), attack()], { itemIds: ['6655'], bonus });
    expect(result.instances.some((entry) => entry.slot === 'W')).toBe(true);
    expect(echoes(result)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ Malignance */

describe('Malignance · Hatefog (3118)', () => {
  const { malignance } = ABILITY_ITEM_NUMBERS;
  const abilityPower = 200;
  const bonus = { abilityPower };
  const perSecond = malignance.damagePerSecond + malignance.apRatioPerSecond * abilityPower;

  it('burns for three seconds of quarter-second ticks after the ultimate', () => {
    const result = run([ability('R')], { itemIds: ['3118'], bonus });
    const ticks = from(result, 'Malignance');
    const ult = result.instances.find((entry) => entry.slot === 'R')!;

    expect(ticks).toHaveLength(malignance.ticks);
    for (const tick of ticks) {
      expect(tick.type).toBe('magic');
      expect(tick.raw).toBeCloseTo(perSecond * malignance.tickSeconds, 6);
    }

    const total = ticks.reduce((sum, tick) => sum + tick.raw, 0);
    expect(total).toBeCloseTo(perSecond * malignance.burnSeconds, 6);

    // The ticks are spread across the burn rather than stacked on the cast.
    expect(ticks[0]!.time).toBeCloseTo(ult.time + malignance.tickSeconds, 6);
    expect(ticks[ticks.length - 1]!.time).toBeCloseTo(ult.time + malignance.burnSeconds, 6);
  });

  it('is triggered by the ultimate only', () => {
    const noUltimate = run([ability('Q', 0), attack(), attack(), attack()], {
      itemIds: ['3118'],
      bonus,
    });
    expect(noUltimate.instances.length).toBeGreaterThan(3);
    expect(from(noUltimate, 'Malignance')).toHaveLength(0);
  });

  it('says out loud which of its parts it does not model', () => {
    const effect = getItemEffect('3118');
    expect(effect?.note).toMatch(/magic resist/i);
    expect(effect?.note).toMatch(/ultimate ability haste/i);
  });
});

/* ------------------------------------------------------------------ Stormsurge */

describe('Stormsurge · Squall (4646)', () => {
  const { stormsurge } = ABILITY_ITEM_NUMBERS;
  const abilityPower = 200;
  /*
   * Enough attack damage that a single attack clears a quarter of the target's
   * maximum health, so this proc does not depend on how many attacks fit inside
   * the 2.5 s window. The window has its own test below.
   */
  const bonus = { abilityPower, attackDamage: 600 };
  const squallDamage = stormsurge.baseDamage + stormsurge.apRatio * abilityPower;
  const squalls = (result: ReturnType<typeof run>) => from(result, 'Stormsurge');

  it('strikes after the delay once a quarter of maximum health is gone', () => {
    const maxHealth = 2000;
    const result = run([attack(), attack()], { itemIds: ['4646'], bonus, target: { maxHealth } });
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    const procs = squalls(result);

    // The premise: the first attack alone clears the threshold.
    expect(attacks[0]!.mitigated).toBeGreaterThan(maxHealth * stormsurge.healthThreshold);

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(squallDamage, 6);
    expect(procs[0]!.time).toBeCloseTo(attacks[0]!.time + stormsurge.delaySeconds, 6);
  });

  it('does not strike when the threshold is never reached', () => {
    // The same two attacks against a target twenty times as large: the damage
    // dealt stays far short of a quarter of its maximum health.
    const result = run([attack(), attack()], {
      itemIds: ['4646'],
      bonus,
      target: { maxHealth: 40000 },
    });
    expect(squalls(result)).toHaveLength(0);
  });

  it('forgets damage older than the window instead of accumulating forever', () => {
    /*
     * Two attacks worth a sixth of the target's maximum health each: together
     * they clear the quarter mark, so the only thing that can stop the proc is
     * the window. A deliberate pause longer than the window sits between them
     * in the first combo and not in the second.
     */
    const maxHealth = statsFor().totalAttackDamage * 6;
    const target = { maxHealth };
    const onlyAp = { abilityPower };

    const spaced = run(
      [attack(), step({ kind: 'wait', seconds: stormsurge.windowSeconds + 1 }), attack()],
      { itemIds: ['4646'], bonus: onlyAp, target },
    );
    expect(spaced.instances.filter((entry) => entry.sourceId === 'AA')).toHaveLength(2);
    expect(squalls(spaced)).toHaveLength(0);

    const together = run([attack(), attack()], { itemIds: ['4646'], bonus: onlyAp, target });
    expect(squalls(together)).toHaveLength(1);
  });

  it('strikes once, because the cooldown outlasts any combo it could be in', () => {
    const maxHealth = 2000;
    const result = run([attack(), attack()], { itemIds: ['4646'], bonus, target: { maxHealth } });
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    const last = result.instances[result.instances.length - 1]!;

    // Both attacks clear the threshold on their own, and the whole combo is far
    // shorter than the cooldown — so a second Squall could only come from the
    // cooldown going unhonoured.
    expect(attacks).toHaveLength(2);
    expect(attacks[1]!.mitigated).toBeGreaterThan(maxHealth * stormsurge.healthThreshold);
    expect(last.time).toBeLessThan(stormsurge.cooldownSeconds);
    expect(result.targetHpRemaining).toBeGreaterThan(0);
    expect(squalls(result)).toHaveLength(1);
  });
});
