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
                    <>
                      <div className="patch-diff-head">
                        <span className="mono">
                          {Math.round(comparison.damageThen).toLocaleString('en-US')}
                        </span>
                        <span aria-hidden="true">→</span>
                        <span className="mono strong">
                          {Math.round(comparison.damageNow).toLocaleString('en-US')}
                        </span>
                        <span
                          className={`patch-delta ${
                            comparison.damageNow >= comparison.damageThen ? 'up' : 'down'
                          }`}
                        >
                          {comparison.damageNow >= comparison.damageThen ? '+' : '−'}
                          {Math.abs(
                            Math.round(comparison.damageNow - comparison.damageThen),
                          ).toLocaleString('en-US')}
                        </span>
                      </div>

                      {comparison.killedThen !== comparison.killedNow && (
                        <p
                          className={`patch-verdict ${comparison.killedNow ? 'good' : 'bad'}`}
                        >
                          {comparison.killedNow
                            ? 'This combo kills now and did not before.'
                            : 'This combo killed before and does not now.'}
                        </p>
                      )}

                      {comparison.changes.length === 0 ? (
                        <p className="field-hint">
                          No value this build uses changed between the two patches.
                        </p>
                      ) : (
                        <ul className="patch-changes">
                          {comparison.changes.map((change) => (
                            <li key={`${change.slot}-${change.label}`}>
                              <b>
                                {change.slot} · {change.label}
                              </b>
                              <span className="mono">
                                {change.from} → {change.to}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
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
