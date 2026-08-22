/*
 * These run against the real registry: this family is wired into
 * `src/model/itemEffects.ts`, so the engine finds the effects on its own. The
 * suite used to widen the registry with a module mock, which is what a family
 * needs *before* it is registered — leaving it in place afterwards applied every
 * effect twice and squared every amplifier.
 *
 * Every expected damage figure below is arithmetic on Riot's own literals —
 * `0.75 * base AD + 0.45 * AP`, `75 + 0.05 * 200`, `(60 + 0.05 * 200) * 0.25` —
 * with the bin key or Data Dragon line it came from named in a comment. Reading
 * the implementation's constants back instead would only prove that a number
 * equals itself: a wrong constant would move both sides of the assertion and the
 * test would still pass. `ABILITY_ITEM_NUMBERS` is used only for the *shape* of
 * a case (how many ticks, how far apart, which threshold to sit under).
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
 * failure here can only be the item. The one case that deliberately gives the
 * target magic resist is Malignance's, where the missing shred is the point.
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
/** Data Dragon's id for Ignite; the engine deals it as true summoner damage. */
const IGNITE_ID = 'SummonerDot';
const ignite = () => step({ kind: 'summoner', summonerId: IGNITE_ID });

interface RunOptions {
  itemIds?: string[];
  summonerIds?: string[];
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
      summonerIds: options.summonerIds ?? [],
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

const sumRaw = (instances: DamageInstance[]) =>
  instances.reduce((total, entry) => total + entry.raw, 0);

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
    // Guards the wiring: without this, a family that fell out of the registry
    // would leave every test below quietly measuring a build with no items.
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
  /**
   * Riot bin `Items/3100`: SpellbladeADRatio = 0.75 on base AD (mStat 2 /
   * mStatFormula 1) + LichBaneAPValue = 0.45 on ability power. Written out as
   * literals so a wrong constant in the item fails this test.
   */
  const spellblade = () => 0.75 * statsFor(bonus).baseAttackDamage + 0.45 * 200;

  it('adds base AD and ability power to the attack after an ability', () => {
    const result = run([ability('Q', 0), attack()], { itemIds: ['3100'], bonus });
    const procs = from(result, 'Lich Bane');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(spellblade(), 6);
    // Both halves have to be in there. Either one alone would be wrong, and the
    // sum on its own would not say which half went missing.
    expect(procs[0]!.raw).toBeGreaterThan(0.45 * 200);
    expect(procs[0]!.raw).toBeGreaterThan(0.75 * statsFor(bonus).baseAttackDamage);
    // Base AD, not total: the bonus attack damage in this build is not part of it.
    expect(procs[0]!.raw).toBeLessThan(0.75 * statsFor(bonus).totalAttackDamage + 0.45 * 200);
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
    // really does fall inside the 1.5 s cooldown the first proc started.
    expect(swings[1]!.time - procs[0]!.time).toBeLessThan(1.5);
    expect(lichBane.cooldownSeconds).toBe(1.5);
  });

  it('does nothing for an attack with no ability before it', () => {
    const result = run([attack(), attack()], { itemIds: ['3100'], bonus });
    expect(from(result, 'Lich Bane')).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- Dusk and Dawn */

describe('Dusk and Dawn · Spellblade (2510)', () => {
  const bonus = { abilityPower: 200, attackDamage: 100 };

  it('deals 75% base AD and 10% AP after an ability', () => {
    /*
     * Riot bin `Items/2510`, mItemCalculations.SpellbladeDamage: coefficient
     * 0.75 on base AD (mStat 2 / mStatFormula 1) + coefficient 0.10 on ability
     * power. The AP half is the whole reason this item is not Lich Bane, so the
     * literal 0.10 is what this test is really guarding.
     */
    const expected = 0.75 * statsFor(bonus).baseAttackDamage + 0.1 * 200;
    const result = run([ability('Q', 0), attack()], { itemIds: ['2510'], bonus });
    const procs = from(result, 'Dusk and Dawn');

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(expected, 6);
    // Not Lich Bane's 45% AP, which would be 70 damage more on this build.
    expect(procs[0]!.raw).toBeLessThan(0.75 * statsFor(bonus).baseAttackDamage + 0.45 * 200);
  });

  it('rides the empowered attack and is spent by one swing', () => {
    const result = run([ability('E'), attack()], { itemIds: ['2510'], bonus });
    expect(from(result, 'Dusk and Dawn')).toHaveLength(1);
  });

  it('does nothing for an attack with no ability before it', () => {
    const result = run([attack(), attack()], { itemIds: ['2510'], bonus });
    expect(from(result, 'Dusk and Dawn')).toHaveLength(0);
  });

  it('says out loud that the repeated on-hit and the heal are missing', () => {
    // Both are declared omissions with no behaviour to assert — nothing in the
    // engine can even express them — so the note is the only guard available.
    const effect = getItemEffect('2510');
    expect(effect?.note).toMatch(/on-hit/i);
    expect(effect?.note).toMatch(/heal/i);
  });
});

/* ----------------------------------------------------------------- Shadowflame */

describe('Shadowflame · Cinderbloom (4645)', () => {
  const { shadowflame } = ABILITY_ITEM_NUMBERS;
  const bonus = { abilityPower: 200, attackDamage: 100 };
  // Lich Bane supplies the magic damage: Vi's own kit is entirely physical, so
  // without it there would be nothing for Cinderbloom to amplify.
  const combo = () => [ability('Q', 0), attack()];
  /** Under the threshold, with room left to take the combo without dying. */
  const wounded = { maxHealth: 4000, currentHealthPercent: shadowflame.healthThreshold - 0.1 };
  const magic = (result: ReturnType<typeof run>) => from(result, 'Lich Bane')[0]!;
  /** Lich Bane's unamplified magic hit, from its own Riot literals. */
  const spellblade = (ap: number) => 0.75 * statsFor(bonus).baseAttackDamage + 0.45 * ap;

  it('raises magic damage against a target under the health threshold', () => {
    const plain = run(combo(), { itemIds: ['3100'], bonus, target: wounded });
    const amped = run(combo(), { itemIds: ['3100', '4645'], bonus, target: wounded });

    // Data Dragon 16.16.1: "dealing 20% increased damage"; bin
    // `Items/4645` SpellItemDamageAmp = 0.2, HealthThreshold = 0.4.
    expect(magic(amped).raw / magic(plain).raw).toBeCloseTo(1.2, 6);
    expect(magic(amped).raw).toBeCloseTo(spellblade(200) * 1.2, 6);
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

  it('leaves summoner-spell damage alone', () => {
    /*
     * Wiki (Shadowflame, notes): "Cinderbloom affects the damage dealt by all
     * sources except summoner spells." Ignite is dealt as true damage with
     * `sourceKind: 'summoner'`, and true damage is otherwise exactly what
     * Cinderbloom amplifies — so an ungated amplifier would show up here as a
     * clean ×1.2 on the burn.
     */
    const target = { maxHealth: 10000, currentHealthPercent: 0.3 };
    const options = { bonus, target, summonerIds: [IGNITE_ID] };
    const plain = run([ignite()], { ...options, itemIds: [] });
    const amped = run([ignite()], { ...options, itemIds: ['4645'] });

    expect(from(plain, 'Ignite')).toHaveLength(5);
    expect(from(plain, 'Ignite')[0]!.type).toBe('true');
    expect(sumRaw(from(plain, 'Ignite'))).toBeGreaterThan(0);
    expect(sumRaw(from(amped, 'Ignite'))).toBeCloseTo(sumRaw(from(plain, 'Ignite')), 6);

    // The same target and the same item, with magic damage from an item instead:
    // this proves the gate is source-specific and not simply an inactive item.
    const spell = run(combo(), { ...options, itemIds: ['3100', '4645'] });
    const bare = run(combo(), { ...options, itemIds: ['3100'] });
    expect(magic(spell).raw / magic(bare).raw).toBeCloseTo(1.2, 6);
  });

  it('grows with critical strike damage the way Riot multiplies it', () => {
    /*
     * Wiki (Shadowflame, notes): "increased damage = base damage + ((base
     * damage × 0.2) × (product of all critical damage modifiers))", and the
     * worked example "126 = 100 + ((100 × 0.2) × (1 + 0.3))" for a +30%
     * critical-damage modifier. Both runs carry the same +30%, so the item is
     * the only difference and 1.26 is the whole claim.
     */
    const critBonus = { ...bonus, critDamage: 0.3 };
    const plain = run(combo(), { itemIds: ['3100'], bonus: critBonus, target: wounded });
    const amped = run(combo(), { itemIds: ['3100', '4645'], bonus: critBonus, target: wounded });

    expect(magic(amped).raw / magic(plain).raw).toBeCloseTo(1 + 0.2 * (1 + 0.3), 6);
    expect(magic(amped).raw).toBeCloseTo(spellblade(200) * 1.26, 6);
    // And the plain 20% is still what a build without the modifier gets, so the
    // multiplication has not been folded into the constant.
    const noCrit = run(combo(), { itemIds: ['3100', '4645'], bonus, target: wounded });
    expect(magic(noCrit).raw).toBeCloseTo(spellblade(200) * 1.2, 6);
  });
});

/* --------------------------------------------------------------- Luden's Echo */

describe("Luden's Echo (6655)", () => {
  const { ludens } = ABILITY_ITEM_NUMBERS;
  const abilityPower = 200;
  const bonus = { abilityPower };
  /**
   * Riot bin `Items/6655`: BaseDamage = 75, APRatio = 0.05, MaxCharges = 6,
   * RepeatDamageReduction = 0.2. One echo at 200 AP is 85; the five redirected
   * ones are 17 each; Riot's own SingleTargetMax = Damage × 2 = 170.
   */
  const ONE_ECHO = 75 + 0.05 * 200;
  const REPEAT = 0.2 * ONE_ECHO;
  const echoes = (result: ReturnType<typeof run>) => from(result, "Luden's Echo");

  it('deals one echo on the hit and five repeats a quarter second apart', () => {
    const result = run([ability('Q', 0)], { itemIds: ['6655'], bonus });
    const procs = echoes(result);
    const vault = result.instances.find((entry) => entry.slot === 'Q')!;

    expect(procs).toHaveLength(6);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(85, 6);
    expect(procs[0]!.time).toBeCloseTo(vault.time, 6);

    for (let charge = 1; charge < 6; charge += 1) {
      // Wiki: "Echo's remaining charges against the primary target deal their
      // additional damage in 0.25-second intervals", the last 1.25 s in.
      expect(procs[charge]!.raw, `echo ${charge + 1}`).toBeCloseTo(17, 6);
      expect(procs[charge]!.time, `echo ${charge + 1}`).toBeCloseTo(vault.time + 0.25 * charge, 6);
    }

    // Riot's SingleTargetMax: twice one echo, no matter how it is split up.
    expect(sumRaw(procs)).toBeCloseTo(170, 6);
    expect(ONE_ECHO * 2).toBe(170);
    expect(REPEAT).toBeCloseTo(17, 6);
  });

  it('scales with ability power', () => {
    const withoutAp = run([ability('Q', 0)], { itemIds: ['6655'] });
    const withAp = run([ability('Q', 0)], { itemIds: ['6655'], bonus });

    // No AP: 75 base, so 75 + 5 × 15 = 150 in total.
    expect(echoes(withoutAp)[0]!.raw).toBeCloseTo(75, 6);
    expect(echoes(withoutAp)[1]!.raw).toBeCloseTo(15, 6);
    expect(sumRaw(echoes(withoutAp))).toBeCloseTo(150, 6);
    expect(sumRaw(echoes(withAp))).toBeCloseTo(170, 6);
  });

  it('fires off Relentless Force, which the game counts as ability damage', () => {
    /*
     * Wiki (Vi/LoL, Relentless Force): it "Applies spell damage to the primary
     * target", and the V14.5 note that it "now triggers spell effects upon
     * dealing damage". The engine books the empowered attack as an 'ability'
     * source without setting `isAbilityDamage`, so a model that trusted the flag
     * alone would silently drop 170 damage off Vi's most common opener.
     */
    const result = run([ability('E')], { itemIds: ['6655'], bonus });
    const swing = result.instances.find((entry) => entry.slot === 'E')!;
    const procs = echoes(result);

    expect(procs).toHaveLength(6);
    expect(sumRaw(procs)).toBeCloseTo(170, 6);
    expect(procs[0]!.time).toBeCloseTo(swing.time, 6);
  });

  it('holds its cooldown across a second ability in the same combo', () => {
    const result = run([ability('Q', 0), ability('R')], { itemIds: ['6655'], bonus });
    const casts = result.instances.filter((entry) => entry.slot === 'Q' || entry.slot === 'R');

    expect(casts).toHaveLength(2);
    // Bin Cooldown = 12 s, longer than any combo this calculator runs.
    expect(casts[1]!.time - casts[0]!.time).toBeLessThan(12);
    expect(ludens.cooldownSeconds).toBe(12);
    expect(echoes(result)).toHaveLength(6);
  });

  it('ignores basic attacks and the Denting Blows proc', () => {
    // Three attacks land the W proc, which the engine books as passive damage
    // rather than ability damage — so nothing in this combo is an ability.
    const result = run([attack(), attack(), attack()], { itemIds: ['6655'], bonus });
    expect(result.instances.some((entry) => entry.slot === 'W')).toBe(true);
    expect(echoes(result)).toHaveLength(0);
  });

  it('stops at the kill instead of front-loading the repeats', () => {
    /*
     * The reason the repeats are scheduled at all. A target left on less health
     * than the burst dies partway through the sequence, and the engine books no
     * damage after the kill — so the echoes that in game arrive after it are not
     * counted here either. A single lump at the moment of the hit would have
     * credited all 170.
     */
    const frail = { maxHealth: 230, currentHealthPercent: 1 };
    const result = run([ability('Q', 0)], { itemIds: ['6655'], bonus, target: frail });
    const procs = echoes(result);

    expect(result.targetHpRemaining).toBe(0);
    expect(procs.length).toBeLessThan(6);
    expect(sumRaw(procs)).toBeLessThan(170);
  });
});

/* ------------------------------------------------------------------ Malignance */

describe('Malignance · Hatefog (3118)', () => {
  const { malignance } = ABILITY_ITEM_NUMBERS;
  const abilityPower = 200;
  const bonus = { abilityPower };
  /**
   * Riot bin `Items/3118`: BaseDamage = 60, APRatio = 0.05, GroundDuration = 3.
   * Wiki: "15 (+ 1.25% AP) magic damage every 0.25 seconds", "180 (+ 15% AP)
   * total". At 200 AP that is 17.5 a tick, twelve ticks, 210 in total.
   */
  const PER_TICK = (60 + 0.05 * 200) * 0.25;
  const TOTAL = (60 + 0.05 * 200) * 3;

  it('burns for three seconds of quarter-second ticks after the ultimate', () => {
    const result = run([ability('R')], { itemIds: ['3118'], bonus });
    const ticks = from(result, 'Malignance');
    const ult = result.instances.find((entry) => entry.slot === 'R')!;

    expect(ticks).toHaveLength(12);
    expect(malignance.ticks).toBe(12);
    for (const tick of ticks) {
      expect(tick.type).toBe('magic');
      expect(tick.raw).toBeCloseTo(17.5, 6);
      expect(tick.raw).toBeCloseTo(PER_TICK, 6);
    }

    expect(sumRaw(ticks)).toBeCloseTo(210, 6);
    expect(TOTAL).toBe(210);

    // The ticks are spread across the burn rather than stacked on the cast.
    expect(ticks[0]!.time).toBeCloseTo(ult.time + 0.25, 6);
    expect(ticks[ticks.length - 1]!.time).toBeCloseTo(ult.time + 3, 6);
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

  it('lets the burn meet the full magic resist, because the shred is not modelled', () => {
    /*
     * The behavioural half of the note above. Against 50 magic resist and no
     * magic penetration the ticks keep 100/(100+50) of their raw damage. Riot's
     * MagicResistanceShred = 10 would leave 100/(100+40) instead — 4.8% more
     * damage per tick — so this assertion is what would fail if the shred were
     * ever faked in, and it is what pins the declared gap.
     */
    const result = run([ability('R')], { itemIds: ['3118'], bonus, target: { magicResist: 50 } });
    const ticks = from(result, 'Malignance');

    expect(ticks).toHaveLength(12);
    for (const tick of ticks) {
      expect(tick.raw).toBeCloseTo(17.5, 6);
      expect(tick.mitigated).toBeCloseTo(17.5 * (100 / 150), 6);
      expect(tick.mitigated).not.toBeCloseTo(17.5 * (100 / 140), 6);
    }
    expect(sumRaw(ticks)).toBeCloseTo(210, 6);
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
  /**
   * Riot bin `Items/4646`: BaseDamage = 125, APRatio = 0.1 (melee value, and
   * RangedProcDamageMod is 1 this patch anyway), DamageThreshold = 0.25,
   * DelayDuration = 2, Cooldown = 30, WindowDuration = 2.5.
   */
  const SQUALL = 125 + 0.1 * 200;
  const squalls = (result: ReturnType<typeof run>) => from(result, 'Stormsurge');

  it('strikes after the delay once a quarter of maximum health is gone', () => {
    const maxHealth = 2000;
    const result = run([attack(), attack()], { itemIds: ['4646'], bonus, target: { maxHealth } });
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    const procs = squalls(result);

    // The premise: the first attack alone clears the threshold.
    expect(attacks[0]!.mitigated).toBeGreaterThan(maxHealth * 0.25);

    expect(procs).toHaveLength(1);
    expect(procs[0]!.type).toBe('magic');
    expect(procs[0]!.raw).toBeCloseTo(145, 6);
    expect(SQUALL).toBe(145);
    expect(procs[0]!.time).toBeCloseTo(attacks[0]!.time + 2, 6);
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

    const spaced = run([attack(), step({ kind: 'wait', seconds: 2.5 + 1 }), attack()], {
      itemIds: ['4646'],
      bonus: onlyAp,
      target,
    });
    expect(spaced.instances.filter((entry) => entry.sourceId === 'AA')).toHaveLength(2);
    expect(squalls(spaced)).toHaveLength(0);

    const together = run([attack(), attack()], { itemIds: ['4646'], bonus: onlyAp, target });
    expect(squalls(together)).toHaveLength(1);
    expect(stormsurge.windowSeconds).toBe(2.5);
  });

  it('strikes once, because the cooldown outlasts any combo it could be in', () => {
    const maxHealth = 2000;
    const result = run([attack(), attack()], { itemIds: ['4646'], bonus, target: { maxHealth } });
    const attacks = result.instances.filter((entry) => entry.sourceId === 'AA');
    const last = result.instances[result.instances.length - 1]!;

    // Both attacks clear the threshold on their own, and the whole combo is far
    // shorter than the 30 s cooldown — so a second Squall could only come from
    // the cooldown going unhonoured.
    expect(attacks).toHaveLength(2);
    expect(attacks[1]!.mitigated).toBeGreaterThan(maxHealth * 0.25);
    expect(last.time).toBeLessThan(30);
    expect(stormsurge.cooldownSeconds).toBe(30);
    expect(result.targetHpRemaining).toBeGreaterThan(0);
    expect(squalls(result)).toHaveLength(1);
  });
});
