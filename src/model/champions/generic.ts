/**
 * A champion nobody has modelled yet.
 *
 * Every method on the runtime contract is optional, so "no kit" is a legal module:
 * basic attacks, items and runes all work, and an ability press is refused by name
 * rather than silently dealing nothing.
 *
 * It exists for the duel. Vi is the only champion with a real module, and waiting
 * for a hundred and seventy more before anyone can fight back would be the wrong
 * order to build this in. What an unmodelled champion does here is the honest
 * floor of what they do in a game — their attacks, with their gear — and both the
 * module and the display say so, because a duel won against half a kit is not a
 * duel won.
 */

import type { ChampionModule } from './types';

export function genericModule(championId: string, displayName: string): ChampionModule {
  return {
    championId,
    displayName,
    /* Nothing is maintained for this champion, so there is no patch to claim. */
    constantsReviewedPatch: '—',
    abilities: [],
    createRuntime: () => ({}),
    describeValues: () => [],
  };
}
