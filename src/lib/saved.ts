import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CalendarEvent } from './events/types.ts';

/**
 * Die Merkliste: Termine, die sich jemand vormerkt. Sie liegt nur auf diesem
 * Gerät (`localStorage`) – kein Konto, nichts verlässt den Browser.
 *
 * Gemerkt wird die ID samt Beginn. Der Beginn erlaubt, Vergangenes von selbst
 * aufzuräumen, ohne die Termine dafür laden zu müssen.
 */

export const SAVED_STORAGE_KEY = 'hierausgehen.saved.v1';

export interface SavedEntry {
  id: string;
  /** Beginn des Termins, ISO-8601 wie am `CalendarEvent`. */
  start: string;
  /** Ende, falls bekannt – Mehrtägiges bleibt bis dahin gemerkt. */
  end?: string;
}

/** So lange bleibt ein vergangener Termin noch auf der Liste. */
const KEEP_AFTER_MS = 24 * 60 * 60 * 1000;

/** Unlesbares fällt weg, Vergangenes nach einem Tag, Doppeltes einmal. */
export function normalizeSaved(value: unknown, now: Date = new Date()): SavedEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SavedEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, start, end } = entry as Partial<SavedEntry>;
    if (typeof id !== 'string' || typeof start !== 'string' || seen.has(id)) continue;
    const last = Date.parse(typeof end === 'string' ? end : start);
    if (Number.isFinite(last) && last + KEEP_AFTER_MS < now.getTime()) continue;
    seen.add(id);
    out.push(typeof end === 'string' ? { id, start, end } : { id, start });
  }
  return out;
}

/** Merken oder vergessen – je nachdem, was gerade gilt. */
export function toggleSaved(
  entries: SavedEntry[],
  event: Pick<CalendarEvent, 'id' | 'start' | 'end'>,
): SavedEntry[] {
  if (entries.some((entry) => entry.id === event.id)) {
    return entries.filter((entry) => entry.id !== event.id);
  }
  return [...entries, event.end ? { id: event.id, start: event.start, end: event.end } : { id: event.id, start: event.start }];
}

/* ------------------------------ Speicher ------------------------------ */

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: SavedEntry[] = [];
const EMPTY: SavedEntry[] = [];

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

function read(): SavedEntry[] {
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
      cachedValue = raw ? normalizeSaved(JSON.parse(raw)) : [];
    } catch {
      cachedValue = [];
    }
  }
  return cachedValue;
}

function write(entries: SavedEntry[]) {
  try {
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Privater Modus – die Liste gilt dann nur bis zum Neuladen.
    cachedValue = entries;
  }
  notify();
}

/** Die Merkliste als Hook: Menge der IDs und ein Schalter je Termin. */
export function useSavedEvents() {
  const entries = useSyncExternalStore(subscribe, read, () => EMPTY);
  const ids = useMemo<ReadonlySet<string>>(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const toggle = useCallback((event: Pick<CalendarEvent, 'id' | 'start' | 'end'>) => {
    write(toggleSaved(read(), event));
  }, []);
  /** Mehrere auf einmal vergessen – etwa, was nicht mehr im Programm steht. */
  const remove = useCallback((drop: Iterable<string>) => {
    const gone = new Set(drop);
    write(read().filter((entry) => !gone.has(entry.id)));
  }, []);
  return { ids, toggle, remove };
}
