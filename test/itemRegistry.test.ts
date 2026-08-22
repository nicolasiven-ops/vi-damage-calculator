import { describe, expect, it } from 'vitest';
import { REGISTERED_ITEM_IDS, getItemEffect } from '../src/model/itemEffects';
import { SR_ITEMS } from './fixtures/srItems';

/**
 * The registry as a whole, which is the only level where these questions mean
 * anything.
 *
 * Each family used to ask whether *it* duplicated the main registry. That
 * question answers itself once the family is part of the registry, and it was
 * never really about one family: what matters is that no item is modelled twice
 * anywhere, because the Map would keep the last one silently and a silent winner
 * is only discovered when a number is already wrong.
 */
describe('the item registry', () => {
  it('models every item exactly once', () => {
    const seen = new Map<string, number>();
    for (const id of REGISTERED_ITEM_IDS) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const twice = [...seen.entries()].filter(([, count]) => count > 1);
    expect(twice, `these ids are registered more than once: ${twice.map(([id]) => id).join(', ')}`)
      .toEqual([]);
  });

  it('gives every registered effect a name, a note and something that acts', () => {
    for (const id of REGISTERED_ITEM_IDS) {
      const effect = getItemEffect(id)!;
      expect(effect.name.length, id).toBeGreaterThan(0);
      expect(effect.note.length, id).toBeGreaterThan(0);
      // An entry with neither an amplifier, a runtime nor granted stats does
      // nothing at all, and an entry that does nothing is worse than no entry:
      // it reports the item as modelled.
      expect(
        Boolean(effect.amplify) || Boolean(effect.createRuntime) || Boolean(effect.stats),
        `${effect.name} (${id}) is registered but has no effect`,
      ).toBe(true);
    }
  });

  it('registers nothing the current shop does not sell, unless it says why', () => {
    /*
     * Items that are modelled but not on a Rift shop shelf right now. Each one is
     * legitimate and each one is a different reason, which is why they are named
     * rather than waved through by a pattern: a new stranger appearing here
     * should be a decision, not a silence.
     */
    const OFF_SHELF: Record<string, string> = {
      '3042': 'Muramana — owned by transforming Manamune, never bought',
      '3040': "Seraph's Embrace — same, from Archangel's Staff",
      '6632': 'Divine Sunderer — off the Rift entirely in this patch',
      '6677': 'Rageknife — off the Rift in this patch',
      '4637': 'Demonic Embrace — on the map but no longer purchasable',
      '6701': 'Opportunity — on the map but no longer purchasable',
      '4015': 'Perplexity — not a Rift item; modelled because its family shares the code',
    };

    const shop = new Set(SR_ITEMS.map((item) => item.id));
    const strangers = REGISTERED_ITEM_IDS.filter(
      (id) =>
        !shop.has(id) &&
        // Mode copies carry the Rift id with a prefix: 223161 is Spear of
        // Shojin's, 328020 an Abyssal Mask.
        !/^\d?\d\d(\d{4})$/.test(id) &&
        !(id in OFF_SHELF),
    );
    expect(
      strangers,
      `registered, not in the shop and not explained: ${strangers.join(', ')}`,
    ).toEqual([]);
  });
});
