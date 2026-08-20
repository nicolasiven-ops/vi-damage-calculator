/**
 * Loads a patch's worth of Data Dragon and keeps it in React state.
 *
 * Failure is a first-class outcome here: if the CDN cannot be reached the hook
 * resolves to the offline bundle and reports why, rather than leaving the app
 * in a permanent spinner.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  DDragonError,
  DEFAULT_LOCALE,
  fetchChampionDetail,
  fetchVersions,
  loadPatchBundle,
  offlineBundle,
} from '../data/ddragon';
import type { DDragonChampionDetail, DDragonSpell, PatchBundle } from '../data/types';

export interface PatchData {
  bundle: PatchBundle | null;
  versions: string[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  setVersion: (version: string) => void;
  selectedVersion: string | null;
}

export function usePatchData(locale: string = DEFAULT_LOCALE): PatchData {
  const [bundle, setBundle] = useState<PatchBundle | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const available = await fetchVersions();
        if (cancelled) return;
        setVersions(available);
        const version = selectedVersion ?? available[0]!;
        const loaded = await loadPatchBundle(version, locale);
        if (cancelled) return;
        setBundle(loaded);
        setSelectedVersion(loaded.version);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof DDragonError
            ? err.message
            : 'Data Dragon konnte nicht geladen werden.';
        setError(message);
        setBundle(offlineBundle());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // `selectedVersion` is intentionally read but not tracked: changing it goes
    // through `setVersion`, which bumps the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const setVersion = useCallback((version: string) => {
    setSelectedVersion(version);
    setNonce((value) => value + 1);
  }, []);

  return { bundle, versions, loading, error, reload, setVersion, selectedVersion };
}

export interface ChampionDetailState {
  detail: DDragonChampionDetail | null;
  spellById: Record<string, DDragonSpell | undefined>;
  loading: boolean;
  error: string | null;
}

export function useChampionDetail(
  version: string | null,
  locale: string,
  championId: string,
  offline: boolean,
): ChampionDetailState {
  const [state, setState] = useState<ChampionDetailState>({
    detail: null,
    spellById: {},
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!version || offline) {
      setState({ detail: null, spellById: {}, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetchChampionDetail(version, locale, championId)
      .then((detail) => {
        if (cancelled) return;
        const spellById: Record<string, DDragonSpell | undefined> = {};
        for (const spell of detail.spells ?? []) spellById[spell.id] = spell;
        setState({ detail, spellById, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          detail: null,
          spellById: {},
          loading: false,
          error:
            err instanceof DDragonError
              ? err.message
              : `Championdaten für ${championId} konnten nicht geladen werden.`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [version, locale, championId, offline]);

  return state;
}
