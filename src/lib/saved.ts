import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Locale } from './i18n.ts';
import {
  EMPTY_STATE,
  SAVED_STORAGE_KEY,
  hasSearch,
  inSeries,
  normalizeSaved,
  saveEvent,
  saveSearch,
  savedReasons,
  unsaveEvent,
  unsaveSearch,
  type SavableEvent,
  type SaveScope,
  type SavedState,
} from './saved-state.ts';

/**
 * Die Merkliste im Browser: Speicher und Hook. Was gemerkt ist und wie es
 * sich ändert, steht in `saved-state.ts` – rein und auch auf dem Server
 * nutzbar.
 */

export type { SavableEvent, SaveScope, SavedReason, SavedState } from './saved-state.ts';

/* ------------------------------ Speicher ------------------------------ */

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: SavedState = EMPTY_STATE;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', onForeignChange);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onForeignChange);
  };
}

function onForeignChange(event: StorageEvent) {
  if (event.key === null || event.key === SAVED_STORAGE_KEY) notify();
}

function notify() {
  for (const listener of listeners) listener();
}

function read(): SavedState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVED_STORAGE_KEY);
  } catch {
    return cachedValue;
  }
  // Identität nur bei echter Änderung wechseln, sonst rendert React endlos.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = raw ? normalizeSaved(JSON.parse(raw)) : EMPTY_STATE;
    } catch {
      cachedValue = EMPTY_STATE;
    }
  }
  return cachedValue;
}

function write(state: SavedState) {
  try {
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Privater Modus – die Liste gilt dann nur bis zum Neuladen.
    cachedValue = state;
  }
  notify();
}

/**
 * Die Merkliste als Hook. `cityId` ist die Stadt der Termine, die geprüft
 * werden – gemerkte Suchen gelten nur dort.
 */
export function useSavedEvents(cityId?: string) {
  const state = useSyncExternalStore(subscribe, read, () => EMPTY_STATE);
  const reasons = useCallback(
    (event: SavableEvent, city: string | undefined = cityId) => savedReasons(state, event, city),
    [state, cityId],
  );
  const isSaved = useCallback(
    (event: SavableEvent, city: string | undefined = cityId) => savedReasons(state, event, city).length > 0,
    [state, cityId],
  );
  const partOfSeries = useCallback((event: SavableEvent) => inSeries(state, event), [state]);
  const save = useCallback(
    (event: SavableEvent, scope: 'event' | 'series' = 'event', city: string | undefined = cityId) => {
      write(saveEvent(read(), event, scope, city));
    },
    [cityId],
  );
  const unsave = useCallback(
    (event: SavableEvent, scope: SaveScope = { kind: 'event' }, city: string | undefined = cityId) => {
      write(unsaveEvent(read(), event, scope, city));
    },
    [cityId],
  );
  /** Merken oder vergessen – nur dieser Termin. */
  const toggle = useCallback(
    (event: SavableEvent, city: string | undefined = cityId) => {
      const current = read();
      write(
        savedReasons(current, event, city).length > 0
          ? unsaveEvent(current, event, { kind: 'event' }, city)
          : saveEvent(current, event, 'event', city),
      );
    },
    [cityId],
  );
  const searchSaved = useCallback(
    (query: string, city: string) => hasSearch(state, query, city),
    [state],
  );
  const toggleSearch = useCallback((query: string, city: string, locale: Locale) => {
    const current = read();
    write(hasSearch(current, query, city) ? unsaveSearch(current, query, city) : saveSearch(current, query, city, locale));
  }, []);
  /** Eine gemerkte Reihe vergessen, auch ohne einen ihrer Termine zur Hand. */
  const forgetSeries = useCallback((key: string) => {
    const current = read();
    write({ ...current, series: current.series.filter((entry) => entry.key !== key) });
  }, []);
  /** Mehrere auf einmal vergessen – etwa, was nicht mehr im Programm steht. */
  const remove = useCallback((drop: Iterable<string>) => {
    const gone = new Set(drop);
    const current = read();
    write({ ...current, events: current.events.filter((entry) => !gone.has(entry.id)) });
  }, []);
  /** Einträge insgesamt – eine Reihe oder Suche zählt einmal. */
  const count = state.events.length + state.series.length + state.searches.length;
  return useMemo(
    () => ({
      state,
      count,
      reasons,
      isSaved,
      partOfSeries,
      save,
      unsave,
      toggle,
      searchSaved,
      toggleSearch,
      forgetSeries,
      remove,
    }),
    [state, count, reasons, isSaved, partOfSeries, save, unsave, toggle, searchSaved, toggleSearch, forgetSeries, remove],
  );
}
