/**
 * What the engine knows about summoner spells.
 *
 * Data Dragon names them and dates their cooldown, and that is all — no damage,
 * no duration, nothing a simulation can act on. So the numbers live in
 * `engine/simulate.ts` for the two spells that deal damage, and this file is the
 * one place that says which those are. The UI reads it to badge a picked spell
 * honestly instead of implying every choice reaches the simulation.
 */

/** Spells the simulation actually resolves when they appear in a combo. */
export const SIMULATED_SUMMONERS = new Set(['SummonerDot', 'SummonerSmite']);

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
