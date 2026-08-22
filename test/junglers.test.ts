/**
 * The declared junglers, checked for the things a declaration can get wrong.
 *
 * Not the damage numbers: those are Riot's, read from the patch at run time, and a
 * test that hardcoded them would be asserting a copy of the thing it is meant to
 * be checking. What a test can hold is the shape — that no slot is declared twice,
 * that every ultimate has three ranks, that every ability names a damage type and
 * a formula, and that a champion whose game data is missing says so instead of
 * inventing a number.
 *
 * The keys themselves were checked against Riot's own files by
 * `scripts/survey-champions.mjs`, which prints every spell and calculation a
 * champion publishes. That is a script rather than a test because it needs the
 * network.
 */

import { describe, expect, it } from 'vitest';
import { JUNGLER_DECLARATIONS, JUNGLER_MODULES } from '../src/model/champions/junglers';
import { declaredModule } from '../src/model/champions/declared';
import type { AbilitySlot } from '../src/engine/types';

describe('the declared junglers', () => {
  it('covers the ten most-played Emerald+ junglers', () => {
    expect(JUNGLER_DECLARATIONS).toHaveLength(10);
    expect(Object.keys(JUNGLER_MODULES).sort()).toEqual([
      'Briar',
      'Graves',
      'Hecarim',
      'JarvanIV',
      'LeeSin',
      'MonkeyKing',
      'Nocturne',
      'Shyvana',
      'Sylas',
      'Talon',
    ]);
  });

  it.each(JUNGLER_DECLARATIONS.map((entry) => [entry.championId, entry] as const))(
    '%s is declared consistently',
    (_id, declaration) => {
      const slots = declaration.abilities.map((ability) => ability.slot);
      // One declaration per slot, and never the passive: it is not castable.
      expect(new Set(slots).size).toBe(slots.length);
      expect(slots).not.toContain('P');

      for (const ability of declaration.abilities) {
        expect(ability.spell.length).toBeGreaterThan(0);
        expect(ability.calc.length).toBeGreaterThan(0);
        expect(['physical', 'magic', 'true']).toContain(ability.type);
        // The ultimate has three ranks; everything else has five.
        expect(ability.maxRank).toBe(ability.slot === 'R' ? 3 : 5);
        // Every ability states what it leaves out, and every champion does too.
        expect(ability.notes.length).toBeGreaterThan(0);
      }
      expect(declaration.gaps.length).toBeGreaterThan(0);
    },
  );

  it('says nothing rather than something wrong when the game data is missing', () => {
    const module = declaredModule({
      championId: 'Test',
      displayName: 'Test',
      abilities: [
        {
          slot: 'Q' as AbilitySlot,
          ddragonId: 'TestQ',
          name: 'Test Q',
          maxRank: 5,
          spell: 'TestQ',
          calc: 'TotalDamage',
          type: 'physical',
          notes: ['nothing'],
        },
      ],
      gaps: ['everything'],
    });

    const warnings: string[] = [];
    const runtime = module.createRuntime({ detail: null, spellById: {}, gameData: null });
    let dealt = 0;
    runtime.castAbility?.('Q' as AbilitySlot, {
      rank: () => 5,
      stats: { level: 11 },
      warn: (message: string) => warnings.push(message),
      dealDamage: () => { dealt += 1; return null; },
    } as never, { chargeSeconds: 0 });

    expect(dealt).toBe(0);
    expect(warnings[0]).toContain('TestQ.TotalDamage');
  });

  it('carries every ability note into the module the interface reads', () => {
    const shyvana = JUNGLER_MODULES.Shyvana!;
    const dragonForm = shyvana.abilities
      .flatMap((ability) => ability.modelNotes)
      .some((note) => /Dragon Form/i.test(note));
    // Her ultimate rewrites her kit, and that has to be visible in the app.
    expect(dragonForm).toBe(true);
  });
});
