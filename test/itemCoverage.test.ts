import { describe, expect, it } from 'vitest';
import { SR_ITEMS, SR_ITEMS_PATCH } from './fixtures/srItems';
import { ITEM_DECISIONS, MODELLED_ITEM_IDS, itemCoverage, itemVerdict } from '../src/model/itemDecisions';
import { hasModelledEffect } from '../src/model/itemEffects';

/**
 * The gate that keeps the item work honest.
 *
 * Not "are all items modelled" — that is a long job — but "has every item been
 * looked at, and does every claim of having modelled one hold". A patch that
 * adds an item lands here as a failing count, which is the only reliable way to
 * notice; nothing else about the app changes when Riot ships something new.
 */
describe(`the item catalogue of patch ${SR_ITEMS_PATCH}`, () => {
  it('has a roster to check against', () => {
    expect(SR_ITEMS.length).toBeGreaterThan(150);
    // Ids are unique, or a decision could silently cover two items.
    expect(new Set(SR_ITEMS.map((item) => item.id)).size).toBe(SR_ITEMS.length);
  });

  it('claims nothing it has not implemented', () => {
    for (const id of MODELLED_ITEM_IDS) {
      expect(hasModelledEffect(id), `item ${id} is claimed as modelled`).toBe(true);
    }
  });

  it('implements nothing it has not decided', () => {
    // The other direction: an effect with no verdict would be invisible to the
    // coverage count, which is what makes the count trustworthy.
    for (const [id, verdict] of Object.entries(ITEM_DECISIONS)) {
      if (verdict.kind !== 'modelled') continue;
      expect(hasModelledEffect(id), `verdict for ${id}`).toBe(true);
    }
  });

  it('gives every shop item a verdict, and reports what is left', () => {
    const coverage = itemCoverage(SR_ITEMS);

    // Every item resolves to something — `itemVerdict` has no undefined branch.
    for (const item of SR_ITEMS) {
      expect(itemVerdict(item.id).kind, item.name).toBeTruthy();
    }

    /*
     * The counts describe the set that can actually carry a passive worth
     * modelling: completed items whose text has one. Components are stat lines
     * by construction and the description parser already handles them, so
     * counting them as unmodelled items only made the number look worse.
     */
    expect(coverage.relevant + coverage.statOnly).toBe(SR_ITEMS.length);
    expect(coverage.modelled + coverage.dismissed + coverage.todo).toBe(coverage.relevant);
    expect(coverage.relevant).toBeGreaterThan(80);

    /*
     * A progress marker rather than a wall: it fails when the work goes
     * backwards. Raise the floor only by doing the work.
     */
    expect(coverage.modelled).toBeGreaterThanOrEqual(30);
  });
});
