import { describe, expect, it } from 'vitest';
import { activeSummonerIds, emptyLoadout } from '../src/state/build';
import { isSummonerSimulated, summonerCooldown, summonerGap } from '../src/model/summoners';

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

describe('summoner cooldowns', () => {
  it('match what Data Dragon publishes for patch 16.16', () => {
    // summoner.json: SummonerSmite cooldownBurn 15, maxammo 2;
    // SummonerDot cooldownBurn 180, maxammo -1 (which is one cast).
    expect(summonerCooldown('SummonerSmite')).toEqual({ seconds: 15, charges: 2 });
    expect(summonerCooldown('SummonerDot')).toEqual({ seconds: 180, charges: 1 });
    // The upgraded Smites are the same spell with a pet attached.
    expect(summonerCooldown('SummonerSmiteAvatarOffensive')?.charges).toBe(2);
  });

  it('says nothing about a spell this app does not simulate', () => {
    expect(summonerCooldown('SummonerFlash')).toBeNull();
  });
});
