/**
 * What the engine knows about summoner spells.
 *
 * Data Dragon names them and dates their cooldown, and that is all — no damage,
 * no duration, nothing a simulation can act on. So the numbers live here, in one
 * table per spell family, and both the engine and the UI read them: the engine
 * to resolve a cast, the UI to badge a pick honestly rather than implying every
 * choice reaches the simulation.
 *
 * Levelled values are given as their level-1 and level-18 ends, because that is
 * how Riot writes them ("20 − 160") and how they interpolate: evenly across the
 * seventeen levels between.
 */

/** A value that grows evenly from level 1 to level 18. */
export interface LevelledValue {
  atLevel1: number;
  atLevel18: number;
}

export function byLevel(value: LevelledValue, level: number): number {
  const clamped = Math.max(1, Math.min(18, level));
  return value.atLevel1 + (value.atLevel18 - value.atLevel1) * ((clamped - 1) / 17);
}

/** Ignite: true damage in five ticks, one a second. */
export const IGNITE = {
  id: 'SummonerDot',
  label: 'Ignite',
  ticks: 5,
  total: { atLevel1: 70, atLevel18: 410 } satisfies LevelledValue,
};

/**
 * The Smite family.
 *
 * They share one cast and differ in what they may hit and for how much: base
 * Smite is a monster-only execute, and the two upgrades a jungler earns can also
 * be pointed at a champion. Kept as a table rather than a chain of `if`s so a
 * new variant is a row, and so the tests can walk every row.
 */
export interface SmiteModel {
  id: string;
  label: string;
  /** Flat true damage to a monster. */
  monsterDamage: number;
  /** True damage to a champion, or null when the spell cannot target one. */
  championDamage: LevelledValue | null;
  /** The part that is not damage, for the notes panel. Empty when there is none. */
  rider?: string;
}

/**
 * The pets that upgrade Smite, and the colour each one paints it.
 *
 * Riot has no Chilling or Challenging Smite any more: those were jungle-item
 * upgrades and the items are gone. What replaced them is the jungle companion —
 * grow it, finish the quest, and Smite becomes Primal Smite. The three pets are
 * three colours and three unrelated passives; the Smite they grant is the same
 * Smite, which is why they share one damage profile here.
 *
 * The ids are Riot's own spell names for the upgraded forms. They are absent
 * from Data Dragon entirely — the picker gets them from this table.
 */
export interface PrimalSmiteVariant {
  id: string;
  /** Pet name, which is how players tell the three apart. */
  pet: string;
  /** What players call it. */
  colour: 'red' | 'blue' | 'green';
  /** CommunityDragon icon file for this pet's Smite. */
  iconFile: string;
  /** The pet's own passive, which is not the Smite and is not simulated. */
  petPassive: string;
}

export const PRIMAL_SMITES: PrimalSmiteVariant[] = [
  {
    id: 'SummonerSmiteAvatarOffensive',
    pet: 'Scorchclaw',
    colour: 'red',
    iconFile: '1101_smite.png',
    petPassive: 'burn and slow on your next attack or ability',
  },
  {
    id: 'SummonerSmiteAvatarUtility',
    pet: 'Gustwalker',
    colour: 'blue',
    iconFile: '1102_smite.png',
    petPassive: 'move speed on entering brush',
  },
  {
    id: 'SummonerSmiteAvatarDefensive',
    pet: 'Mosstomper',
    colour: 'green',
    iconFile: '1103_smite.png',
    petPassive: 'a shield out of combat',
  },
];

/**
 * Numbers, and where they come from.
 *
 * Riot ships these as unresolved placeholders — `{{ smitebasedamage }}`,
 * `@spell.SummonerSmite:SecondPVPDamage@` — so no value in this table came out
 * of a Riot file, unlike every ability value in the app. They are the community
 * wiki's, which is the only published source, and the notes panel says so.
 */
export const SMITES: SmiteModel[] = [
  {
    id: 'SummonerSmite',
    label: 'Smite',
    monsterDamage: 600,
    championDamage: null,
  },
  ...PRIMAL_SMITES.map((variant) => ({
    id: variant.id,
    label: `Primal Smite (${variant.pet})`,
    monsterDamage: 1400,
    // Flat, and small: the old Challenging Smite's 20–160 belonged to an item
    // that no longer exists.
    championDamage: { atLevel1: 40, atLevel18: 40 },
    rider: `20% slow for 2 s, and the pet's own ${variant.petPassive} — neither is modelled`,
  })),
];

export function smiteById(id: string): SmiteModel | undefined {
  return SMITES.find((entry) => entry.id === id);
}

/**
 * Spells the simulation actually resolves when they appear in a combo.
 *
 * Derived from the tables above rather than listed again, so a spell cannot be
 * badged "simulated" in the sidebar while the engine skips it.
 */
export const SIMULATED_SUMMONERS = new Set([IGNITE.id, ...SMITES.map((entry) => entry.id)]);

/**
 * Why the rest are not simulated. Wording matters here: a shield or a slow is
 * absent because it is unmodelled work, not because it is irrelevant.
 */
const REASONS: Record<string, string> = {
  SummonerFlash: 'Reine Positionierung — ohne Karte kein Effekt auf den Schaden.',
  SummonerHaste: 'Ghost: Bewegungstempo, das die Simulation nicht abbildet.',
  SummonerBarrier: 'Schild auf dich selbst — eingehender Schaden wird nicht simuliert.',
  SummonerHeal: 'Heilung und Bewegungstempo auf dich selbst, nicht modelliert.',
  SummonerBoost: 'Cleanse: entfernt Effekte, die die Simulation nicht kennt.',
  SummonerExhaust: 'Senkt Schaden und Tempo des Ziels — noch nicht modelliert.',
  SummonerTeleport: 'Verändert nur, wo du stehst.',
};

export function isSummonerSimulated(id: string): boolean {
  return SIMULATED_SUMMONERS.has(id);
}

/** A sentence for the notes panel, or null when the spell is simulated. */
export function summonerGap(id: string): string | null {
  if (isSummonerSimulated(id)) return null;
  return REASONS[id] ?? 'Wird in der Simulation übersprungen.';
}

/**
 * The unmodelled half of a spell that is otherwise simulated.
 *
 * Challenging Smite's damage is a number the engine can deal; the mark it leaves
 * is not. Saying so belongs next to the pick, not in a commit message.
 */
export function summonerRider(id: string): string | null {
  return smiteById(id)?.rider ?? null;
}
