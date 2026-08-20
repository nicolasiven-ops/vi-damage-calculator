interface Props {
  version: string;
  versions: string[];
  offline: boolean;
  loading: boolean;
  error: string | null;
  onVersionChange: (version: string) => void;
  onReload: () => void;
  onReset: () => void;
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
}: Props) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <h1>Schadensrechner</h1>
            <span className="brand-sub">League of Legends · Combo-Simulation</span>
          </div>
        </div>

        <div className="app-header-controls">
          {loading && <span className="tag">lädt …</span>}
          {offline ? (
            <span className="tag danger" title={error ?? undefined}>
              Offline — Snapshot {version}
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
          <button className="btn subtle" onClick={onReload}>
            Neu laden
          </button>
          <button className="btn subtle danger" onClick={onReset}>
            Build zurücksetzen
          </button>
        </div>
      </div>

      {offline && (
        <div className="app-banner">
          <strong>Data Dragon nicht erreichbar.</strong> {error} — der Rechner läuft mit einem
          minimalen Offline-Snapshot: Vis Basiswerte sind vorhanden, Items und Runen nicht. Sobald
          die Verbindung steht, „Neu laden“ drücken.
        </div>
      )}
    </header>
  );
}
