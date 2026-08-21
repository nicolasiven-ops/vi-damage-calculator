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

export const SMITES: SmiteModel[] = [
  {
    id: 'SummonerSmite',
    label: 'Smite',
    monsterDamage: 900,
    championDamage: null,
  },
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
