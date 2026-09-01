import { DEFAULT_CITY_ID, isKnownCityId } from '@/lib/cities';
import type { Locale } from '@/lib/i18n';

export type ThemePreference = 'light' | 'dark' | 'system';
export type CitySelectionMode = 'automatic' | 'manual';

export interface Settings {
  cityId: string;
  citySelection: CitySelectionMode;
  theme: ThemePreference;
  locale: Locale;
  /** 12-Stunden-Anzeige statt 24 Stunden. */
  hour12: boolean;
  /** 'auto' folgt der Zeitzone der Stadt, sonst eine IANA-Zone. */
  timeZone: 'auto' | string;
}

export const defaultSettings: Settings = {
  cityId: DEFAULT_CITY_ID,
  citySelection: 'automatic',
  theme: 'system',
  locale: 'de',
  hour12: false,
  timeZone: 'auto',
};

export const SETTINGS_STORAGE_KEY = 'hierausgehen.settings.v1';

/**
 * Kleiner Store über `localStorage`, gelesen mit `useSyncExternalStore`.
 *
 * Damit gibt es keinen Effekt, der nach dem Mounten Zustand nachzieht: der
 * Server rendert die Standardwerte, der Browser liefert beim ersten Lesen
 * bereits die gespeicherten. Nebenbei ziehen andere Tabs automatisch nach.
 */

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: Settings = defaultSettings;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', notifyOnForeignChange);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', notifyOnForeignChange);
  };
}

function notifyOnForeignChange(event: StorageEvent) {
  if (event.key === null || event.key === SETTINGS_STORAGE_KEY) notify();
}

function notify() {
  for (const listener of listeners) listener();
}

export function getSnapshot(): Settings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return cachedValue;
  }

  // Identität nur bei echter Änderung wechseln, sonst rendert React endlos.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = defaultSettings;
    if (raw) {
      try {
        cachedValue = normalizeSettings(JSON.parse(raw) as Partial<Settings>);
      } catch {
        // Unlesbare Einstellungen: bei den Standardwerten bleiben.
      }
    }
  }
  return cachedValue;
}

export function getServerSnapshot(): Settings {
  return defaultSettings;
}

export function writeSettings(patch: Partial<Settings>): void {
  const next = normalizeSettings({ ...getSnapshot(), ...patch });
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Privater Modus: die Änderung gilt dann nur für diese Sitzung.
    cachedRaw = null;
  }
  cachedValue = next;
  cachedRaw = JSON.stringify(next);
  notify();
}

function normalizeSettings(value: Partial<Settings>): Settings {
  const next = { ...defaultSettings, ...value };
  if (!isKnownCityId(next.cityId)) next.cityId = DEFAULT_CITY_ID;
  if (next.citySelection !== 'automatic' && next.citySelection !== 'manual') {
    next.citySelection = defaultSettings.citySelection;
  }
  return next;
}
