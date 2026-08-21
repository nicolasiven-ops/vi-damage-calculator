/**
 * The user's build: everything they configure, in one serialisable object.
 *
 * Persisted to localStorage so a reload does not throw away a combo, and
 * encodable into the URL so a build can be shared as a link.
 */

import { DEFAULT_TIMINGS, type ComboStep, type CritMode, type TargetConfig, type TimingConfig } from '../engine/types';
import type { AbilitySlot } from '../engine/types';
import type { StatBlock } from '../model/stats';

/**
 * Items and runes: one side of the fight, kitted out.
 *
 * Extracted because both sides need it. The attacker keeps these fields
 * inline on the build for continuity; the target carries its own copy.
 */
export interface LoadoutState {
  /** Six item slots; empty string means the slot is free. */
  itemIds: string[];
  keystoneId: number | null;
  primaryTreeId: number | null;
  primaryRuneIds: (number | null)[];
  secondaryTreeId: number | null;
  secondaryRuneIds: (number | null)[];
  shardIds: (number | null)[];
  /**
   * The two summoner spells, by Data Dragon id.
   *
   * Only the ones the engine models do anything (Ignite and Smite today); the
   * rest are carried so the combo bar can offer what you actually took, and the
   * notes panel can say which of them the simulation ignores.
   */
  summonerIds: (string | null)[];
}

/**
 * Data Dragon tree ids. Stable for years, and pre-selecting two of them means
 * the rune panel always has its rows — no empty state that is half the height
 * of the filled one and knocks the two columns out of step.
 */
const DOMINATION = 8100;
const PRECISION = 8000;

/**
 * The rune fields of an empty loadout: no runes picked, both paths still chosen.
 *
 * Reset means "clear my picks", not "leave the panel without a page to show" —
 * a pathless rune panel is half the height of a filled one, which is exactly the
 * state the pre-selected trees exist to prevent.
 */
export function emptyRunes(): Pick<
  LoadoutState,
  'keystoneId' | 'primaryTreeId' | 'primaryRuneIds' | 'secondaryTreeId' | 'secondaryRuneIds' | 'shardIds'
> {
  return {
    keystoneId: null,
    primaryTreeId: DOMINATION,
    primaryRuneIds: [null, null, null],
    secondaryTreeId: PRECISION,
    secondaryRuneIds: [null, null],
    shardIds: [null, null, null],
  };
}

export function emptyLoadout(): LoadoutState {
  return {
    itemIds: ['', '', '', '', '', ''],
    ...emptyRunes(),
    summonerIds: [null, null],
  };
}

/** Where the target values come from. */
export type TargetMode = 'custom' | 'champion';

/**
 * The target, plus what each mode remembers.
 *
 * `target` is the one the engine reads. The other fields are the two modes'
 * own state, kept side by side so switching restores what that mode last held
 * instead of inheriting the other one's numbers under the other one's name —
 * picking Thresh and then switching to Custom used to leave "Thresh" in the
 * heading with no preset behind it.
 */
export interface TargetState {
  target: TargetConfig;
  targetMode: TargetMode;
  /** Which champion the target follows in champion mode. */
  targetChampionId: string;
  /** The target as custom mode last had it. */
  customTarget: TargetConfig;
  /** Which preset custom mode last loaded, empty when typed by hand. */
  customPresetId: string;
  /**
   * The target own items and runes.
   *
   * Only their stat contributions apply: a target does not proc anything in
   * this simulation, it only gets hit.
   */
  targetLoadout: LoadoutState;
}

/** The attacker's own gear stays inline on the build, where it always was. */
export interface BuildState extends TargetState, LoadoutState {
  championId: string;
  level: number;
  ranks: Record<AbilitySlot, number>;

  combo: ComboStep[];
  critMode: CritMode;
  timings: TimingConfig;
  manualStats: Partial<StatBlock>;
}

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `s${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function step(action: ComboStep['action'], chargeSeconds?: number): ComboStep {
  return chargeSeconds === undefined
    ? { uid: newUid(), action }
    : { uid: newUid(), action, chargeSeconds };
}

export const DEFAULT_TARGET: TargetConfig = {
  name: 'Target',
  level: 11,
  maxHealth: 2100,
  currentHealthPercent: 1,
  armor: 90,
  magicResist: 50,
  flatDamageReduction: 0,
  percentDamageReduction: 0,
  bonusHealth: 0,
  unitType: 'champion',
};

export function defaultBuild(): BuildState {
  return {
    championId: 'Vi',
    level: 11,
    ranks: { P: 1, Q: 5, W: 4, E: 3, R: 2 },
    itemIds: ['', '', '', '', '', ''],
    keystoneId: null,
    primaryTreeId: DOMINATION,
    primaryRuneIds: [null, null, null],
    secondaryTreeId: PRECISION,
    secondaryRuneIds: [null, null],
    shardIds: [null, null, null],
    summonerIds: ['SummonerFlash', 'SummonerDot'],
    target: { ...DEFAULT_TARGET },
    /*
     * A real champion by default, not a typed number.
     *
     * Champion mode is the mode that answers a question people have — "does this
     * kill her" — and it fills in armour, health and growth from the patch
     * instead of asking for three numbers before it can say anything.
     */
    targetMode: 'champion',
    targetChampionId: 'Ahri',
    customTarget: { ...DEFAULT_TARGET },
    customPresetId: '',
    targetLoadout: emptyLoadout(),
    // The classic Vi engage: charged Q in, ult, then E-weave for the W proc.
    combo: [
      step({ kind: 'ability', slot: 'Q' }, 1.25),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'E' }),
      step({ kind: 'attack' }),
      step({ kind: 'ability', slot: 'R' }),
      step({ kind: 'attack' }),
    ],
    critMode: 'expected',
    timings: { ...DEFAULT_TIMINGS },
    manualStats: {},
  };
}

/* ------------------------------------------------------------- persistence */

const STORAGE_KEY = 'vidmg:build:v1';

export function loadBuild(): BuildState {
  const fallback = defaultBuild();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BuildState>;
    return mergeBuild(fallback, parsed);
  } catch {
    return fallback;
  }
}

export function saveBuild(build: BuildState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  } catch {
    // Storage unavailable (private mode); the app works fine without it.
  }
}

/**
 * Merge stored state onto the defaults so a build saved by an older version
 * never leaves a required field undefined.
 */
function mergeBuild(base: BuildState, stored: Partial<BuildState>): BuildState {
  const combo = Array.isArray(stored.combo)
    ? stored.combo.filter((entry) => entry && typeof entry === 'object' && entry.action)
    : base.combo;

  return {
    ...base,
    ...stored,
    ranks: { ...base.ranks, ...(stored.ranks ?? {}) },
    itemIds: normaliseSlots(stored.itemIds, 6, ''),
    primaryRuneIds: normaliseSlots(stored.primaryRuneIds, 3, null),
    secondaryRuneIds: normaliseSlots(stored.secondaryRuneIds, 2, null),
    shardIds: normaliseSlots(stored.shardIds, 3, null),
    summonerIds: inheritedSlots(stored.summonerIds, base.summonerIds),
    target: { ...base.target, ...(stored.target ?? {}) },
    targetMode: stored.targetMode ?? base.targetMode,
    targetChampionId: stored.targetChampionId ?? base.targetChampionId,
    customTarget: { ...base.customTarget, ...(stored.customTarget ?? {}) },
    customPresetId: stored.customPresetId ?? base.customPresetId,
    targetLoadout: mergeLoadout(base.targetLoadout, stored.targetLoadout),
    timings: { ...base.timings, ...(stored.timings ?? {}) },
    manualStats: stored.manualStats ?? {},
    // Regenerate uids so drag & drop keys stay unique after a reload.
    combo: combo.map((entry) => ({ ...entry, uid: newUid() })),
  };
}

function mergeLoadout(base: LoadoutState, stored?: Partial<LoadoutState>): LoadoutState {
  return {
    ...base,
    ...(stored ?? {}),
    itemIds: normaliseSlots(stored?.itemIds, 6, ''),
    primaryRuneIds: normaliseSlots(stored?.primaryRuneIds, 3, null),
    secondaryRuneIds: normaliseSlots(stored?.secondaryRuneIds, 2, null),
    shardIds: normaliseSlots(stored?.shardIds, 3, null),
    summonerIds: inheritedSlots(stored?.summonerIds, base.summonerIds),
  };
}

/**
 * Like `normaliseSlots`, but an absent field keeps the default rather than
 * becoming empty.
 *
 * Summoner spells arrived after builds were already being stored, and every one
 * of those builds has no `summonerIds` at all. Normalising that to two empty
 * slots would take Ignite off the combo palette of a build that was saved when
 * Ignite was simply always there — a feature landing should not silently remove
 * something from an existing build. An explicitly emptied slot is a real choice
 * and is kept as one, because then the array exists.
 */
function inheritedSlots<T>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from({ length: fallback.length }, (_, index) => (value as T[])[index] ?? null) as T[];
}

function normaliseSlots<T>(value: unknown, length: number, filler: T): T[] {
  const source = Array.isArray(value) ? (value as T[]) : [];
  return Array.from({ length }, (_, index) => source[index] ?? filler);
}

/* ------------------------------------------------------------------ sharing */

export function encodeBuild(build: BuildState): string {
  const json = JSON.stringify(build);
  return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  ));
}

export function decodeBuild(encoded: string): BuildState | null {
  try {
    const binary = atob(encoded);
    const json = decodeURIComponent(
      [...binary].map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    return mergeBuild(defaultBuild(), JSON.parse(json) as Partial<BuildState>);
  } catch {
    return null;
  }
}

/** Rune ids actually in play, for the engine. */
export function activeRuneIds(loadout: LoadoutState): number[] {
  return [
    loadout.keystoneId,
    ...loadout.primaryRuneIds,
    ...loadout.secondaryRuneIds,
  ].filter((id): id is number => typeof id === 'number');
}

export function activeShardIds(loadout: LoadoutState): number[] {
  return loadout.shardIds.filter((id): id is number => typeof id === 'number');
}

/** The summoner spells actually taken, in slot order. */
export function activeSummonerIds(loadout: LoadoutState): string[] {
  return loadout.summonerIds.filter((id): id is string => typeof id === 'string' && id !== '');
}

export function activeItemIds(loadout: LoadoutState): string[] {
  return loadout.itemIds.filter((id) => id !== '');
}
