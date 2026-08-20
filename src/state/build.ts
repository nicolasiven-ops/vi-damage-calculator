/**
 * The user's build: everything they configure, in one serialisable object.
 *
 * Persisted to localStorage so a reload does not throw away a combo, and
 * encodable into the URL so a build can be shared as a link.
 */

import { DEFAULT_TIMINGS, type ComboStep, type CritMode, type TargetConfig, type TimingConfig } from '../engine/types';
import type { AbilitySlot } from '../engine/types';
import type { StatBlock } from '../model/stats';

export interface BuildState {
  championId: string;
  level: number;
  ranks: Record<AbilitySlot, number>;
  /** Six item slots; empty string means the slot is free. */
  itemIds: string[];
  keystoneId: number | null;
  primaryTreeId: number | null;
  primaryRuneIds: (number | null)[];
  secondaryTreeId: number | null;
  secondaryRuneIds: (number | null)[];
  shardIds: (number | null)[];
  target: TargetConfig;
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
  name: 'Ziel',
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
    primaryTreeId: null,
    primaryRuneIds: [null, null, null],
    secondaryTreeId: null,
    secondaryRuneIds: [null, null],
    shardIds: [null, null, null],
    target: { ...DEFAULT_TARGET },
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
    target: { ...base.target, ...(stored.target ?? {}) },
    timings: { ...base.timings, ...(stored.timings ?? {}) },
    manualStats: stored.manualStats ?? {},
    // Regenerate uids so drag & drop keys stay unique after a reload.
    combo: combo.map((entry) => ({ ...entry, uid: newUid() })),
  };
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
export function activeRuneIds(build: BuildState): number[] {
  return [
    build.keystoneId,
    ...build.primaryRuneIds,
    ...build.secondaryRuneIds,
  ].filter((id): id is number => typeof id === 'number');
}

export function activeShardIds(build: BuildState): number[] {
  return build.shardIds.filter((id): id is number => typeof id === 'number');
}

export function activeItemIds(build: BuildState): string[] {
  return build.itemIds.filter((id) => id !== '');
}
