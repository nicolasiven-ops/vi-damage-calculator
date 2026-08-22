import { describe, expect, it } from 'vitest';
import { activeSummonerIds, emptyLoadout } from '../src/state/build';
import { isSummonerSimulated, summonerGap, summonerTiming } from '../src/model/summoners';

describe('summoner selection', () => {
  it('keeps slot order and drops empty slots', () => {
    const loadout = { ...emptyLoadout(), summonerIds: [null, 'SummonerDot'] };
    expect(activeSummonerIds(loadout)).toEqual(['SummonerDot']);

    const both = { ...emptyLoadout(), summonerIds: ['SummonerFlash', 'SummonerDot'] };
    expect(activeSummonerIds(both)).toEqual(['SummonerFlash', 'SummonerDot']);
  });

  it('treats an empty string as an empty slot', () => {
    // A stored build from an older version can carry '' rather than null.
    const loadout = { ...emptyLoadout(), summonerIds: ['', 'SummonerSmite'] };
    expect(activeSummonerIds(loadout)).toEqual(['SummonerSmite']);
  });

  it('marks exactly the two spells the engine resolves as simulated', () => {
    expect(isSummonerSimulated('SummonerDot')).toBe(true);
    expect(isSummonerSimulated('SummonerSmite')).toBe(true);
    expect(isSummonerSimulated('SummonerExhaust')).toBe(false);
  });

  it('explains every gap, including spells it has no wording for', () => {
    expect(summonerGap('SummonerDot')).toBeNull();
    expect(summonerGap('SummonerFlash')).toMatch(/Positionierung/);
    // A spell Riot adds later must still produce a sentence, not undefined.
    expect(summonerGap('SummonerMark')).toBeTruthy();
  });
});

describe('summoner timings', () => {
  it('keep the cooldown between casts apart from the recharge', () => {
    // summoner.json for 16.16: SummonerSmite cooldown 15, maxammo 2. The 90 s
    // recharge is the wiki's — Data Dragon ships no such field.
    expect(summonerTiming('SummonerSmite')).toEqual({
      betweenCasts: 15,
      rechargeSeconds: 90,
      charges: 2,
    });
    expect(summonerTiming('SummonerDot')).toEqual({
      betweenCasts: 180,
      rechargeSeconds: 180,
      charges: 1,
    });
    // The upgraded Smites are the same spell with a pet attached.
    expect(summonerTiming('SummonerSmiteAvatarOffensive')?.betweenCasts).toBe(15);
  });

  it('puts the cooldown between casts far outside any combo', () => {
    // The point of the number: holding two charges is not two casts in a fight.
    // If this ever drops below ten seconds, the horizon the solver searches, then
    // "Smite, Smite" becomes a legal opener again and this test is the warning.
    const timing = summonerTiming('SummonerSmiteAvatarOffensive')!;
    expect(timing.betweenCasts).toBeGreaterThan(10);
  });

  it('says nothing about a spell this app does not simulate', () => {
    expect(summonerTiming('SummonerFlash')).toBeNull();
  });
});
