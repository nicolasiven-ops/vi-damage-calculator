/**
 * The jungle companions, and what they leave you with.
 *
 * The pet itself is an item you feed until it is consumed; what remains is a
 * permanent buff, and it is the buff that belongs in a damage calculator. Red is
 * the one that matters most: Scorchclaw's Slash puts a burn worth 5% of the
 * target's maximum health on your next hit, which against a 3,000-health target
 * is 150 true damage the calculator would otherwise pretend does not exist.
 *
 * Riot ships none of these numbers as data — the item descriptions carry no
 * values and the buffs live in the compiled spell scripts — so they come from
 * the wiki's own tooltips, quoted in the comments below, and the notes panel
 * says as much.
 *
 * Two stated assumptions, both of which the notes panel repeats:
 *  - The Ember stacks are full when the combo starts. They fill at 3 per half
 *    second to 100, and killing a large monster fills them instantly, so a
 *    jungler who walks into a fight from a camp has them. Starting from zero
 *    would mean the burn never fires inside a ten-second combo, which is the
 *    wrong default for a tool about the fight.
 *  - Mosstomper's shield is up at the start, for the same reason: it refreshes
 *    after a camp or ten seconds out of combat.
 */

import type { SimContext } from '../engine/context';
import type { ItemRuntime } from './itemEffects';
import type { HitInfo } from './runes';
import { byLevel } from './summoners';

/** What a pet's buff does, once the pet has been fed to its last evolution. */
export interface PetEffect {
  /** The Primal Smite id this pet grants, which is how it is picked. */
  summonerId: string;
  pet: string;
  /** One line for the notes panel: what is modelled and what is assumed. */
  note: string;
  /** Applied once, before the combo starts. */
  onStart?(ctx: SimContext): void;
  createRuntime?(): ItemRuntime;
}

/*
 * "Gain 3 Ember stacks every 0.5 seconds, up to 100. Killing a large monster
 * grants maximum stacks. When fully stacked, your next damaging basic attack or
 * instance of ability damage against an enemy champion consumes all stacks to
 * burn them […] dealing bonus true damage equal to 5% of the target's maximum
 * health over 4 seconds and slowing them by 30% decaying over 2 seconds."
 *
 * The wiki's own footnote gives the tick rate as 1.25% of maximum health per
 * second over four seconds, which is what is scheduled here.
 */
const BURN_FRACTION = 0.05;
const BURN_SECONDS = 4;

const SCORCHCLAW: PetEffect = {
  summonerId: 'SummonerSmiteAvatarOffensive',
  pet: 'Scorchclaw',
  note: "Scorchclaw's Slash: the next hit burns for 5% of the target's maximum health over 4 s. Counted as fully stacked at the start; the 30% decaying slow is recorded but changes no number.",
  createRuntime() {
    let spent = false;
    /** Both an attack and ability damage qualify; the first one takes it. */
    const consume = (ctx: SimContext, hit: HitInfo): void => {
      if (spent) return;
      if (ctx.target.unitType !== 'champion') return;
      if (!hit.isAbilityDamage && hit.sourceKind !== 'attack') return;
      spent = true;

      const perSecond = (ctx.target.maxHealth * BURN_FRACTION) / BURN_SECONDS;
      for (let tick = 1; tick <= BURN_SECONDS; tick += 1) {
        ctx.scheduleDamage({
          afterSeconds: tick,
          sourceId: 'pet:scorchclaw',
          sourceLabel: `Scorchclaw's Slash (${tick}/${BURN_SECONDS})`,
          sourceKind: 'summoner',
          type: 'true',
          amount: perSecond,
          notes: ['1.25% of maximum health per second'],
        });
      }
      ctx.applyCrowdControl({ label: 'Slowed 30%', durationSeconds: 2 });
    };
    return {
      onHitLanded(ctx, hit) {
        consume(ctx, hit);
      },
    };
  },
};

/*
 * "Gain a 200 − 360 (based on level) shield that lasts until broken and
 * refreshes after killing a monster camp or 10 seconds without combat."
 */
const MOSSTOMPER: PetEffect = {
  summonerId: 'SummonerSmiteAvatarDefensive',
  pet: 'Mosstomper',
  note: "Mosstomper's Courage: a 200–360 shield by level, counted as up when the combo starts. Nothing damages you here, so it is never spent.",
  onStart(ctx) {
    ctx.grantShield({
      amount: byLevel({ atLevel1: 200, atLevel18: 360 }, ctx.stats.level),
      // It lasts until broken, and nothing here breaks it.
      durationSeconds: 999,
      label: "Mosstomper's Courage",
    });
  },
};

/*
 * "While in a brush, gain 30% bonus movement speed […] killing a large monster
 * grants you 45% bonus movement speed decaying over 1.5 seconds."
 */
const GUSTWALKER: PetEffect = {
  summonerId: 'SummonerSmiteAvatarUtility',
  pet: 'Gustwalker',
  note: "Gustwalker's Gait: movement speed in brush. Nothing about it reaches a damage number, and the simulation has no map to enter brush on.",
};

export const PET_EFFECTS: PetEffect[] = [SCORCHCLAW, MOSSTOMPER, GUSTWALKER];

export function petEffectFor(summonerId: string): PetEffect | undefined {
  return PET_EFFECTS.find((entry) => entry.summonerId === summonerId);
}

/** The pet buffs a loadout brings, in the order the spells were picked. */
export function petEffects(summonerIds: string[]): PetEffect[] {
  return summonerIds
    .map((id) => petEffectFor(id))
    .filter((entry): entry is PetEffect => entry !== undefined);
}
