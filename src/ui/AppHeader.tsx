import type { ReactNode } from 'react';

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
