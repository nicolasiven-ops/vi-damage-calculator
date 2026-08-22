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
import { FIXTURE_CHAMPION, FIXTURE_CHAMPION_STATS, FIXTURE_SPELLS_BY_ID } from './fixtures';

/**
 * Item actives, pressed as combo steps.
 *
 * Numbers are literals from Riot's bins rather than references to the module's
 * constants, so a wrong constant fails here instead of agreeing with itself.
 */
const moduleCtx: ChampionModuleContext = {
  detail: FIXTURE_CHAMPION,
  spellById: FIXTURE_SPELLS_BY_ID,
  gameData: null,
};

const TARGET: TargetConfig = {
  name: 'Target',
  level: 14,
  maxHealth: 20000,
  currentHealthPercent: 1,
  armor: 100,
  magicResist: 0,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

let uid = 0;
const step = (action: ComboStep['action']): ComboStep => {
  uid += 1;
  return { uid: `a${uid}`, action };
};

function run(combo: ComboStep[], itemIds: string[], bonus: Partial<StatBlock> = {}) {
  const bonusStats = { ...emptyStats(), ...bonus };
  const stats = resolveChampionStats(FIXTURE_CHAMPION_STATS, 14, bonusStats);
  const input: SimulationInput = {
    attacker: {
      championId: 'Vi',
      level: 14,
      ranks: { P: 1, Q: 5, W: 5, E: 5, R: 3 },
      itemIds,
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
  };
  return simulate(input, VI_MODULE, moduleCtx);
}

const press = (itemId: string): ComboStep => step({ kind: 'item', itemId });

describe('Hextech Rocketbelt · Supersonic (3152)', () => {
  it('deals 100 plus 10% ability power as magic damage when pressed', () => {
    // Items/3152: BaseDamage 100, APRatio 0.1. The target has no magic resist
    // here, so the mitigated number is the raw one.
    const result = run([press('3152')], ['3152'], { abilityPower: 200 });
    const hits = result.instances.filter((entry) => entry.sourceLabel.includes('Supersonic'));

    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe('magic');
    expect(hits[0]!.mitigated).toBeCloseTo(100 + 0.1 * 200, 4);
  });

  it('costs time, so the step after it starts later', () => {
    const withPress = run([press('3152'), step({ kind: 'attack' })], ['3152']);
    const without = run([step({ kind: 'attack' })], ['3152']);

    const attackAt = (result: ReturnType<typeof run>) =>
      result.instances.find((entry) => entry.sourceLabel === 'Basic attack')!.time;

    // A dash is not free: 0.25 s of cast plus the app's input delay.
    expect(attackAt(withPress)).toBeGreaterThan(attackAt(without) + 0.24);
  });

  it('refuses a second press inside its 50 s cooldown, and says so', () => {
    const result = run([press('3152'), press('3152')], ['3152']);
    expect(result.instances.filter((e) => e.sourceLabel.includes('Supersonic'))).toHaveLength(1);
    expect(result.warnings.some((entry) => entry.includes('cooldown'))).toBe(true);
  });

  it('refuses to press an item the build does not own', () => {
    const result = run([press('3152')], []);
    expect(result.instances).toHaveLength(0);
    expect(result.warnings.some((entry) => entry.includes('not in the build'))).toBe(true);
  });
});

describe('Hextech Gunblade · Lightning Bolt (3146)', () => {
  it('interpolates its damage by level and adds 30% ability power', () => {
    // Items/3146 ActiveDamage: 175 at level 1 to 253 at level 18, +30% AP.
    // At level 14: 175 + (253 - 175) x 13/17 = 234.647...
    const result = run([press('3146')], ['3146'], { abilityPower: 100 });
    const hits = result.instances.filter((entry) => entry.sourceLabel.includes('Lightning Bolt'));
    const expected = 175 + ((253 - 175) * 13) / 17 + 0.3 * 100;

    expect(hits).toHaveLength(1);
    expect(hits[0]!.mitigated).toBeCloseTo(expected, 4);
  });

  it('slows the target for a second and a half', () => {
    const result = run([press('3146')], ['3146']);
    const slows = result.spans.filter(
      (span) => span.lane === 'cc' && span.label.includes('Lightning Bolt'),
    );
    expect(slows).toHaveLength(1);
    expect(slows[0]!.end - slows[0]!.start).toBeCloseTo(1.5, 4);
  });
});

describe('Actualizer · Mana Made Real (2522)', () => {
  it('draws the window and refuses to invent the damage increase', () => {
    const result = run([press('2522')], ['2522']);

    expect(result.instances.filter((e) => e.sourceLabel.includes('Actualizer'))).toHaveLength(0);
    expect(
      result.warnings.some((entry) => entry.includes('not published by Riot')),
      'the missing number has to be said out loud',
    ).toBe(true);
    expect(
      result.spans.some((span) => span.label.includes('Mana Made Real')),
      'the eight seconds still belong on the timeline',
    ).toBe(true);
  });
});
