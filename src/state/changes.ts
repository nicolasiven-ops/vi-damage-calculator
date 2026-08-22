/**
 * What changed between two builds, in words.
 *
 * The ledger needs a label for every entry, and the honest label is the one that
 * names the thing the user actually did: "Serrated Dirk in", "Q to rank 5",
 * "target armour 90 → 60". Deriving it from the two states rather than recording
 * it at the point of the click means nothing has to be threaded through every
 * control — and a change made from anywhere still gets an entry.
 *
 * Returns null when nothing worth logging moved. That case is the common one:
 * this runs on every render, and most renders change the focused step or a
 * transient, not the build.
 */

import type { AbilitySlot } from '../engine/types';
import type { BuildState } from './build';
import { resolveSkills } from '../model/skills';

const SLOTS: AbilitySlot[] = ['P', 'Q', 'W', 'E', 'R'];

const num = (value: number): string => Math.round(value).toLocaleString('en-US');

/** Vi's own maximums, for reading an order back into ranks. */
const RANK_CAPS: Partial<Record<AbilitySlot, number>> = { Q: 5, W: 5, E: 5, R: 3 };

export function describeBuildChange(
  before: BuildState,
  after: BuildState,
  nameOf: (itemId: string) => string,
): string | null {
  const parts: string[] = [];

  if (before.level !== after.level) parts.push(`level ${before.level} → ${after.level}`);

  /*
   * Ranks are read from the order and the level, the same way the app reads them,
   * so the log records what the run actually used — a point held back by a level
   * change shows up as the rank falling, which is exactly what happened.
   */
  const ranksOf = (build: BuildState) =>
    resolveSkills(build.skillOrder, build.level, RANK_CAPS).ranks;
  const ranksBefore = ranksOf(before);
  const ranksAfter = ranksOf(after);
  for (const slot of SLOTS) {
    const from = ranksBefore[slot] ?? 0;
    const to = ranksAfter[slot] ?? 0;
    if (from !== to) parts.push(`${slot} rank ${from} → ${to}`);
  }

  /*
   * Items are compared as multisets, not slot by slot: moving a Long Sword from
   * the third slot to the fifth is not a change to the build, and logging it as
   * one would bury the changes that matter.
   */
  const itemsBefore = before.itemIds.filter(Boolean).sort();
  const itemsAfter = after.itemIds.filter(Boolean).sort();
  if (itemsBefore.join('|') !== itemsAfter.join('|')) {
    const gained = difference(itemsAfter, itemsBefore).map(nameOf);
    const lost = difference(itemsBefore, itemsAfter).map(nameOf);
    if (gained.length > 0) parts.push(`${gained.join(', ')} in`);
    if (lost.length > 0) parts.push(`${lost.join(', ')} out`);
  }

  const runesBefore = runeSignature(before);
  const runesAfter = runeSignature(after);
  if (runesBefore !== runesAfter) parts.push('runes changed');

  const summonersBefore = before.summonerIds.filter(Boolean).join('|');
  const summonersAfter = after.summonerIds.filter(Boolean).join('|');
  if (summonersBefore !== summonersAfter) parts.push('summoners changed');

  if (before.combo.length !== after.combo.length) {
    parts.push(`combo ${before.combo.length} → ${after.combo.length} steps`);
  } else if (comboSignature(before) !== comboSignature(after)) {
    parts.push('combo reordered');
  }

  if (before.critMode !== after.critMode) {
    parts.push(`crits: ${before.critMode} → ${after.critMode}`);
  }

  if (before.targetMode !== after.targetMode) {
    parts.push(`target: ${before.targetMode} → ${after.targetMode}`);
  } else if (before.targetChampionId !== after.targetChampionId) {
    parts.push(`target: ${after.targetChampionId || 'none'}`);
  }

  if (Math.abs(before.target.armor - after.target.armor) > 0.05) {
    parts.push(`target armour ${num(before.target.armor)} → ${num(after.target.armor)}`);
  }
  if (Math.abs(before.target.magicResist - after.target.magicResist) > 0.05) {
    parts.push(`target MR ${num(before.target.magicResist)} → ${num(after.target.magicResist)}`);
  }
  if (Math.abs(before.target.maxHealth - after.target.maxHealth) > 0.5) {
    parts.push(`target health ${num(before.target.maxHealth)} → ${num(after.target.maxHealth)}`);
  }
  if (Math.abs(before.target.currentHealthPercent - after.target.currentHealthPercent) > 0.005) {
    parts.push(
      `target at ${Math.round(before.target.currentHealthPercent * 100)}% → ${Math.round(
        after.target.currentHealthPercent * 100,
      )}%`,
    );
  }
  if (before.target.level !== after.target.level) {
    parts.push(`target level ${before.target.level} → ${after.target.level}`);
  }
  if (before.target.unitType !== after.target.unitType) {
    parts.push(`target is a ${after.target.unitType}`);
  }

  // The target's own gear, without itemising it: it only ever moves stats here.
  if (
    before.targetLoadout.itemIds.filter(Boolean).sort().join('|') !==
    after.targetLoadout.itemIds.filter(Boolean).sort().join('|')
  ) {
    parts.push("target's items changed");
  }

  if (parts.length === 0) return null;
  // Two changes in one render is a reset or a shared link, not two decisions.
  return parts.length > 2 ? `${parts.slice(0, 2).join(' · ')} · +${parts.length - 2} more` : parts.join(' · ');
}

function difference(a: string[], b: string[]): string[] {
  const rest = [...b];
  const out: string[] = [];
  for (const entry of a) {
    const index = rest.indexOf(entry);
    if (index >= 0) rest.splice(index, 1);
    else out.push(entry);
  }
  return out;
}

function runeSignature(build: BuildState): string {
  return [
    build.keystoneId,
    build.primaryTreeId,
    ...build.primaryRuneIds,
    build.secondaryTreeId,
    ...build.secondaryRuneIds,
    ...build.shardIds,
  ].join('|');
}

function comboSignature(build: BuildState): string {
  return build.combo
    .map((step) =>
      step.action.kind === 'ability'
        ? `${step.action.slot}:${step.chargeSeconds ?? ''}`
        : step.action.kind === 'summoner'
          ? step.action.summonerId
          : step.action.kind,
    )
    .join('>');
}
