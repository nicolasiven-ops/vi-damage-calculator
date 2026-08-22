/**
 * The log of what changed and what it did.
 *
 * Kept apart from the panel that shows it and from the app that fills it, because
 * the interesting rule lives here: an entry is only worth keeping if the build
 * actually moved. Every render of this app re-simulates, and most renders change
 * a focused step or a hovered row rather than the build — so the log's job is
 * mostly to say "nothing happened" and stay quiet.
 *
 * Entries hold the whole build they describe, which is what makes a click able to
 * put it back. That is memory only: a session that survives a reload is a
 * different feature, and not obviously a better one — a log that remembers
 * yesterday's experiments is a log nobody reads.
 */

import { describeBuildChange } from './changes';
import type { BuildState } from './build';

export interface ChangeLogEntry {
  id: number;
  /** What moved, in words: "Serrated Dirk in", "Q rank 4 → 5". */
  label: string;
  /** The build after the change, so a click can restore it. */
  build: BuildState;
  before: number;
  after: number;
  delta: number;
  killedBefore: boolean;
  killedAfter: boolean;
}

export interface ChangeLogState {
  entries: ChangeLogEntry[];
  nextId: number;
}

export const EMPTY_CHANGE_LOG: ChangeLogState = { entries: [], nextId: 1 };

/**
 * How many entries to keep.
 *
 * Enough to cover a session's worth of experiments, few enough that the panel
 * stays readable without scrolling into last hour's work.
 */
const LIMIT = 40;

export interface RecordArgs {
  log: ChangeLogState;
  previous: { build: BuildState; damage: number; killed: boolean };
  current: { build: BuildState; damage: number; killed: boolean };
  nameOf: (itemId: string) => string;
}

/**
 * Add an entry if the build moved, and return the log unchanged if it did not.
 *
 * Returning the same object matters: React re-renders on a new reference, and a
 * log that produced one on every simulation would loop.
 */
export function recordChange({ log, previous, current, nameOf }: RecordArgs): ChangeLogState {
  const label = describeBuildChange(previous.build, current.build, nameOf);
  if (!label) return log;

  const entry: ChangeLogEntry = {
    id: log.nextId,
    label,
    build: current.build,
    before: previous.damage,
    after: current.damage,
    delta: current.damage - previous.damage,
    killedBefore: previous.killed,
    killedAfter: current.killed,
  };

  return {
    entries: [entry, ...log.entries].slice(0, LIMIT),
    nextId: log.nextId + 1,
  };
}

/** The build one entry describes, for putting it back. */
export function buildOf(log: ChangeLogState, id: number): BuildState | null {
  return log.entries.find((entry) => entry.id === id)?.build ?? null;
}
