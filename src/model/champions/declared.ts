/**
 * Champions declared rather than written.
 *
 * Vi is written: a charged dash, a stacking third-hit passive, an empowered attack
 * with ammo and a shield keyed to ability damage do not survive being expressed as
 * data. Most kits do not need that. What a duel needs from Graves is that his Q
 * hurts by the amount Riot says it hurts, on his cooldown, at his rank — and that
 * is four fields and a lookup, not four hundred lines.
 *
 * So a declaration names, per ability: the spell in Riot's own bin, the
 * calculation inside it that holds the damage, and the damage type. Every number
 * then comes from `mSpellCalculations` at run time — the same source, the same
 * evaluator and the same "GAME DATA" badge the app already uses for Vi. There is
 * no table of hand-typed damage in this file, and that is the point: a declaration
 * cannot rot, because it does not contain a value. When Riot changes a number the
 * app changes with it; when Riot *renames* a calculation the ability reports itself
 * unreadable instead of quietly dealing a stale amount.
 *
 * What a declaration cannot express is stated per champion in `gaps`, and shown in
 * the interface. That list is long on purpose. A duel decided by half a kit is a
 * duel nobody should trust, and the honest way to ship ten champions is to be
 * exact about which half is missing.
 */

import type { AbilitySlot } from '../../engine/types';
import type { DamageType } from '../../engine/types';
import { statLookup } from '../spellcalc';
import { calcFormula, calcValue, type ChampionModule, type ChampionModuleContext } from './types';

/** One ability, as far as data can take it. */
export interface DeclaredAbility {
  slot: AbilitySlot;
  /** Data Dragon's spell id, for the icon and the name. */
  ddragonId: string;
  name: string;
  maxRank: number;
  /** The spell object in Riot's bin, e.g. `GravesQLineSpell`. */
  spell: string;
  /** The calculation inside it that holds the damage, e.g. `TotalDamage`. */
  calc: string;
  type: DamageType;
  /**
   * How long the cast occupies the fight.
   *
   * Riot publishes no cast times anywhere machine-readable, so this is the one
   * number a declaration has to state itself. A quarter second is the ordinary
   * point-and-click cast; anything materially longer is given its own value and
   * named in the notes.
   */
  castSeconds?: number;
  /** What this ability does beyond its damage, and is therefore missing. */
  notes: string[];
}

export interface ChampionDeclaration {
  championId: string;
  displayName: string;
  abilities: DeclaredAbility[];
  /** What the whole kit does that no declaration reaches. */
  gaps: string[];
}

const DEFAULT_CAST = 0.25;

/**
 * A module from a declaration.
 *
 * The runtime is one function: resolve the ability's own formula against the stats
 * the simulation is holding, and deal that. Everything else the engine already
 * does for every champion — cooldowns from Data Dragon, mitigation, on-hit
 * effects, the timeline.
 */
export function declaredModule(declaration: ChampionDeclaration): ChampionModule {
  const bySlot = new Map(declaration.abilities.map((ability) => [ability.slot, ability]));

  return {
    championId: declaration.championId,
    displayName: declaration.displayName,
    /* No constants to review: every number is read from the patch being viewed. */
    constantsReviewedPatch: 'game data only',
    abilities: declaration.abilities.map((ability) => ({
      slot: ability.slot,
      ddragonId: ability.ddragonId,
      name: ability.name,
      maxRank: ability.maxRank,
      castable: true,
      modelNotes: [...ability.notes, ...declaration.gaps],
    })),

    createRuntime(ctx: ChampionModuleContext) {
      return {
        castAbility(slot, sim) {
          const ability = bySlot.get(slot);
          if (!ability) {
            sim.warn(`${declaration.displayName} has no ${slot} in this app.`);
            return;
          }
          const rank = sim.rank(slot);
          const resolved = calcValue(
            ctx,
            ability.spell,
            ability.calc,
            rank,
            statLookup(sim.stats),
            /*
             * No fallback worth having. A declaration carries no numbers, so when
             * the formula cannot be read the honest amount is zero and the warning
             * says which formula — a made-up number here would be indistinguishable
             * from a real one in every part of the interface.
             */
            0,
          );

          if (resolved.source !== 'gamedata' || resolved.value <= 0) {
            sim.warn(
              `${ability.name}: ${ability.spell}.${ability.calc} could not be read from the game data — counted as no damage.`,
            );
            return;
          }

          sim.dealDamage({
            sourceId: slot,
            sourceLabel: `${ability.name} (${slot})`,
            sourceKind: 'ability',
            type: ability.type,
            amount: resolved.value,
            isAbilityDamage: true,
            notes: [`${ability.spell}.${ability.calc}`],
          });
        },

        castDuration(slot) {
          const seconds = bySlot.get(slot)?.castSeconds ?? DEFAULT_CAST;
          return { seconds, parts: [{ label: 'cast', seconds }] };
        },
      };
    },

    describeValues(ctx, ranks) {
      return declaration.abilities.flatMap((ability) => {
        const rank = Math.max(1, ranks[ability.slot] ?? 1);
        const formula = calcFormula(ctx, ability.spell, ability.calc, rank);
        return [
          {
            slot: ability.slot,
            label: `${ability.name} damage`,
            value: formula ?? 'unreadable',
            source: (formula ? 'gamedata' : 'registry') as 'gamedata' | 'registry',
            note: formula
              ? `${ability.spell}.${ability.calc}, ${ability.type} damage`
              : `${ability.spell}.${ability.calc} is missing from this patch's game data.`,
            ...(formula ? { formula } : {}),
          },
        ];
      });
    },
  };
}
