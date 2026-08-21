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
import {
  describeValidation,
  fetchChampionGameData,
  validateGameData,
  type ValidationReport,
} from '../data/gamedata';
import type { ChampionGameData } from '../data/bin';
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
            : 'Data Dragon could not be loaded.';
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

/**
 * How the ability formulas for this champion turned out.
 *
 * `ready` means they were loaded *and* passed the cross-check against Data
 * Dragon. `rejected` means they loaded but disagreed with Data Dragon about a
 * cooldown or a cost, which points at a changed array convention — the data is
 * dropped in that case, because numbers that are off by one rank are worse than
 * a maintained constant that says it is one.
 */
export interface GameDataStatus {
  state: 'idle' | 'loading' | 'ready' | 'rejected' | 'failed';
  /** The CommunityDragon patch path the data came from. */
  patch: string | null;
  /** One line for the UI, always set once loading finished. */
  message: string;
  report: ValidationReport | null;
}

/**
 * Just the presentational facts about a champion: portrait, title, abilities.
 *
 * Deliberately not `useChampionDetail`: that one also pulls the champion's spell
 * formulas from CommunityDragon and cross-checks them, which is exactly what the
 * *target* does not need. Nothing about the target is simulated from its own
 * formulas — it only gets hit — so fetching them would be a download and a
 * validation run in exchange for nothing.
 */
export function useChampionProfile(
  version: string | null,
  locale: string,
  championId: string,
): { profile: DDragonChampionDetail | null; loading: boolean } {
  const [profile, setProfile] = useState<DDragonChampionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!version || !championId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    fetchChampionDetail(version, locale, championId)
      .then((detail) => {
        if (!cancelled) setProfile(detail);
      })
      .catch(() => {
        // A missing portrait is not worth an error state; the panel falls back
        // to the champion summary it already has.
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [version, locale, championId]);

  return { profile, loading };
}

export interface ChampionDetailState {
  detail: DDragonChampionDetail | null;
  spellById: Record<string, DDragonSpell | undefined>;
  loading: boolean;
  error: string | null;
  /** Riot's own spell formulas, or null when unavailable or rejected. */
  gameData: ChampionGameData | null;
  gameDataStatus: GameDataStatus;
}

const IDLE_GAME_DATA: GameDataStatus = {
  state: 'idle',
  patch: null,
  message: 'Game data was not loaded.',
  report: null,
};

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
    gameData: null,
    gameDataStatus: IDLE_GAME_DATA,
  });

  useEffect(() => {
    if (!version || offline) {
      setState({
        detail: null,
        spellById: {},
        loading: false,
        error: null,
        gameData: null,
        gameDataStatus: {
          ...IDLE_GAME_DATA,
          message: offline
            ? 'Offline mode: maintained constants only.'
            : IDLE_GAME_DATA.message,
        },
      });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    async function run(): Promise<void> {
      let spellById: Record<string, DDragonSpell | undefined> = {};
      try {
        const detail = await fetchChampionDetail(version!, locale, championId);
        if (cancelled) return;
        spellById = {};
        for (const spell of detail.spells ?? []) spellById[spell.id] = spell;
        // Render the champion as soon as Data Dragon is in. The formulas arrive
        // a moment later and upgrade the numbers from constants to game data.
        setState({
          detail,
          spellById,
          loading: false,
          error: null,
          gameData: null,
          gameDataStatus: {
            state: 'loading',
            patch: null,
            message: 'Loading game data …',
            report: null,
          },
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setState({
          detail: null,
          spellById: {},
          loading: false,
          error:
            err instanceof DDragonError
              ? err.message
              : `Champion data for ${championId} could not be loaded.`,
          gameData: null,
          gameDataStatus: IDLE_GAME_DATA,
        });
        return;
      }

      try {
        const { data, note } = await fetchChampionGameData(version!, championId);
        if (cancelled) return;
        const report = validateGameData(data, spellById);
        const summary = [note, describeValidation(report)].filter(Boolean).join(' ');
        setState((prev) => ({
          ...prev,
          gameData: report.ok ? data : null,
          gameDataStatus: {
            state: report.ok ? 'ready' : 'rejected',
            patch: data.patch,
            message: summary,
            report,
          },
        }));
      } catch (err: unknown) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          gameData: null,
          gameDataStatus: {
            state: 'failed',
            patch: null,
            message:
              err instanceof DDragonError
                ? `${err.message} — falling back to maintained constants.`
                : 'Game data could not be loaded — falling back to maintained constants.',
            report: null,
          },
        }));
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [version, locale, championId, offline]);

  return state;
}
