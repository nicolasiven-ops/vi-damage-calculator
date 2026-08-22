import { describe, expect, it } from 'vitest';
import { parseItemDescription, resolveItem } from '../src/model/items';
import { FIXTURE_LEGACY_ITEM, FIXTURE_MODERN_ITEM } from './fixtures';

describe('parseItemDescription', () => {
  it('reads stats Data Dragon does not expose in its stats object', () => {
    const { stats } = parseItemDescription(FIXTURE_MODERN_ITEM.description);
    expect(stats.attackDamage).toBe(45);
    expect(stats.lethality).toBe(18);
    expect(stats.abilityHaste).toBe(20);
  });

  it('stores percentages as fractions', () => {
    const { stats } = parseItemDescription(FIXTURE_MODERN_ITEM.description);
    expect(stats.critChance).toBeCloseTo(0.25, 10);
  });

  it('distinguishes flat from percent variants by the percent sign', () => {
    const { stats } = parseItemDescription(FIXTURE_MODERN_ITEM.description);
    expect(stats.moveSpeedPercent).toBeCloseTo(0.05, 10);
    expect(stats.moveSpeedFlat).toBe(0);
  });

  it('reports stat lines it could not map instead of dropping them', () => {
    const { unparsed } = parseItemDescription(
      '<mainText><stats><attention>7</attention> Zauberkraft der Vorsehung</stats></mainText>',
    );
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toContain('Zauberkraft der Vorsehung');
  });

  it('returns empty stats when there is no stats block at all', () => {
    const { stats, found } = parseItemDescription('<mainText>nur Text</mainText>');
    expect(found.size).toBe(0);
    expect(stats.attackDamage).toBe(0);
  });
});

describe('resolveItem', () => {
  it('falls back to the legacy stats object when the description has no block', () => {
    const item = resolveItem('1001', FIXTURE_LEGACY_ITEM);
    expect(item.stats.attackDamage).toBe(30);
    expect(item.stats.hp).toBe(200);
    expect(item.stats.attackSpeed).toBeCloseTo(0.25, 10);
  });

  it('does not double-count a stat present in both sources', () => {
    const hybrid = {
      ...FIXTURE_MODERN_ITEM,
      stats: { FlatPhysicalDamageMod: 45 },
    };
    const item = resolveItem('9999', hybrid);
    expect(item.stats.attackDamage).toBe(45);
  });

  it('classifies a finished item as legendary', () => {
    expect(resolveItem('9999', FIXTURE_MODERN_ITEM).itemClass).toBe('legendary');
  });

  it('strips markup out of the passive text', () => {
    const item = resolveItem('9999', FIXTURE_MODERN_ITEM);
    expect(item.descriptionText).toContain('Testpassiv');
    expect(item.descriptionText).not.toContain('<');
  });
});

describe('adaptive force', () => {
  it('becomes attack damage at Riot\'s own 0.6 conversion', () => {
    // Flesheater (667112) sells "55 Adaptive Force / 500 Health" in patch
    // 16.16.1. Adaptive is 0.6 attack damage or 1 ability power per point, so a
    // physical champion sees 33 attack damage. Before this, the line fell into
    // `unparsedStatLines` and the item arrived with nothing but its health.
    const item = resolveItem('667112', {
      name: 'Flesheater',
      description:
        '<mainText><stats><attention>55</attention> Adaptive Force<br><attention>500</attention> Health</stats></mainText>',
      gold: { total: 2500, base: 0, sell: 1750, purchasable: true },
      image: { full: 'x.png' },
      tags: [],
      maps: { '11': true },
    } as never);

    expect(item.stats.attackDamage).toBeCloseTo(33, 6);
    expect(item.stats.hp).toBe(500);
    expect(item.unparsedStatLines).toEqual([]);
  });
});
