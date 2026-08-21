import type { ReactNode } from 'react';
import { SelectMenu } from './components/SelectMenu';

interface Props {
  version: string;
  versions: string[];
  offline: boolean;
  loading: boolean;
  error: string | null;
  onVersionChange: (version: string) => void;
  onReload: () => void;
  onReset: () => void;
  /**
   * The patch comparison, next to the patch it compares against.
   *
   * Lazy on purpose: `comparison` is null until someone asks, because the answer
   * costs a second champion file and a second bin file.
   */
  /** The patches worth offering as a comparison: recent ones, newest first. */
  comparableVersions?: string[];
  comparison?: {
    patch: string;
    damageThen: number;
    damageNow: number;
    killedThen: boolean;
    killedNow: boolean;
    changes: { slot: string; label: string; from: string; to: string }[];
    loading: boolean;
  } | null;
  onCompare?: (version: string | null) => void;
  /**
   * The build's config tabs, rendered inside the header row.
   *
   * They share the row rather than taking their own, because everything here is
   * pinned to the top of the screen and pays for its height out of the analysis.
   */
  tabs?: ReactNode;
}

export function AppHeader({
  version,
  versions,
  offline,
  loading,
  error,
  onVersionChange,
  onReload,
  onReset,
  comparableVersions,
  comparison,
  onCompare,
  tabs,
}: Props) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <h1>Damage Calculator</h1>
            <span className="brand-sub">League of Legends · combo simulation</span>
          </div>
        </div>

        {/*
         * The two rooms next to the calculator.
         *
         * The workshop is where a feature is argued out before anyone builds it;
         * the roadmap is what is actually next. Both are static pages, so they
         * are plain links rather than routes — nothing about them needs the app
         * to be running.
         */}
        <nav className="site-links" aria-label="Pages">
          <a className="site-link" href="workshop.html">
            Workshop
          </a>
          <a className="site-link" href="roadmap.html">
            Roadmap
          </a>
        </nav>

        {tabs}

        <div className="app-header-controls">
          {loading && <span className="tag">loading …</span>}
          {offline ? (
            <span className="tag danger" title={error ?? undefined}>
              Offline — snapshot {version}
            </span>
          ) : (
            <label className="patch-select">
              <span className="field-label">Patch</span>
              <select
                value={version}
                onChange={(event) => onVersionChange(event.target.value)}
                disabled={versions.length === 0}
              >
                {versions.slice(0, 40).map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/*
            * What the patch did to this build.
            *
            * The same combo, the same items, the champion's own numbers from the
            * older files — so the difference is the patch and nothing else.
            */}
          {comparableVersions && comparableVersions.length > 0 && onCompare && (
            <div className="patch-diff">
              <button
                className={`btn subtle${comparison ? ' active' : ''}`}
                onClick={() => onCompare(comparison ? null : comparableVersions[0]!)}
                title="Play the same combo on an older patch and compare"
              >
                {comparison ? `vs ${comparison.patch}` : 'Compare patch'}
              </button>

              {comparison && (
                <div className="patch-diff-pop">
                  {/*
                    * Which patch to compare against is the feature, not a
                    * detail: "what did they do to my champion" is a question
                    * about a particular patch, usually the one being complained
                    * about.
                    */}
                  <SelectMenu
                    value={comparison.patch}
                    options={comparableVersions.map((entry) => ({ id: entry, label: entry }))}
                    onChange={(entry) => onCompare(entry)}
                    ariaLabel="Patch to compare against"
                    searchable
                    searchPlaceholder="Patch …"
                  />

                  {comparison.loading ? (
                    <p className="field-hint">Loading {comparison.patch} …</p>
                  ) : (
                    <table className="patch-table">
                      {/*
                        * Columns, not arrows: with two patches and a difference,
                        * "145 → 120 → 130" is unreadable, and per-rank values
                        * carry an arrow of their own. Naming the two patches in
                        * the header says once what every row then means.
                        */}
                      <thead>
                        <tr>
                          <th />
                          <th className="mono">{comparison.patch}</th>
                          <th className="mono">{version}</th>
                          <th>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="is-total">
                          <th scope="row">Combo damage</th>
                          <td className="mono">
                            {Math.round(comparison.damageThen).toLocaleString('en-US')}
                          </td>
                          <td className="mono strong">
                            {Math.round(comparison.damageNow).toLocaleString('en-US')}
                          </td>
                          <td
                            className={`mono patch-delta ${
                              comparison.damageNow >= comparison.damageThen ? 'up' : 'down'
                            }`}
                          >
                            {signed(comparison.damageNow - comparison.damageThen)}
                          </td>
                        </tr>

                        {comparison.changes.map((change) => (
                          <tr key={`${change.slot}-${change.label}`}>
                            <th scope="row">
                              <span className={`patch-slot slot-${change.slot.toLowerCase()}`}>
                                {change.slot}
                              </span>
                              {change.label}
                            </th>
                            <td className="mono">{plain(change.from)}</td>
                            <td className="mono">{plain(change.to)}</td>
                            <td className="mono patch-delta">{valueDelta(change.from, change.to)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {!comparison.loading &&
                    comparison.killedThen !== comparison.killedNow && (
                      <p className={`patch-verdict ${comparison.killedNow ? 'good' : 'bad'}`}>
                        {comparison.killedNow
                          ? 'This combo kills now and did not before.'
                          : 'This combo killed before and does not now.'}
                      </p>
                    )}

                  {!comparison.loading && comparison.changes.length === 0 && (
                    <p className="field-hint">
                      No value this build uses changed between the two patches.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button className="btn subtle" onClick={onReload} title="Reload patch data">
            Reload
          </button>
          <button className="btn subtle danger" onClick={onReset} title="Reset build">
            Reset
          </button>
        </div>
      </div>

      {offline && (
        <div className="app-banner">
          <strong>Data Dragon unreachable.</strong> {error} — the calculator is running on a
          minimal offline snapshot: Vi's base stats are there, items and runes are not. Press
          “Reload” once the connection is back.
        </div>
      )}
    </header>
  );
}

/** A number with its sign, for a change column. Zero stays "±0". */
function signed(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')}`;
}

/**
 * A per-rank value reads "80% → 160%" — an arrow that would collide with the
 * table's own reading. Inside a column, a range is a range.
 */
function plain(value: string): string {
  return value.replace(/ → /g, ' – ');
}

/**
 * The change between two printed values, when it can be told honestly.
 *
 * Both sides are strings the champion module wrote, so this parses the numbers
 * back out rather than pretending to know their shape. A per-rank list changed
 * by the same amount at every rank is one number; changed unevenly it is the
 * range of the changes; anything this cannot line up gets a dash rather than a
 * guess.
 */
function valueDelta(from: string, to: string): string {
  const left = [...from.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const right = [...to.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (left.length === 0 || left.length !== right.length) return '—';

  const unit = from.includes('%') && to.includes('%') ? '%' : '';
  const deltas = right.map((value, index) => value - (left[index] ?? 0));
  const round = (value: number): string => {
    const fixed = Math.abs(value) < 10 ? Number(value.toFixed(2)) : Math.round(value);
    return `${fixed > 0 ? '+' : fixed < 0 ? '−' : '±'}${Math.abs(fixed)}${unit}`;
  };

  const first = deltas[0]!;
  if (deltas.every((value) => Math.abs(value - first) < 0.005)) return round(first);
  const low = Math.min(...deltas);
  const high = Math.max(...deltas);
  return `${round(low)} … ${round(high)}`;
}
