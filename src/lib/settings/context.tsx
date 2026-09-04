'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { cityById, nearestCityId } from '@/lib/cities';
import { type MessageKey, translate, translateTerm } from '@/lib/i18n';
import { createFormatter, type Formatter } from '@/lib/format';
import {
  type Settings,
  type ThemePreference,
  getServerSnapshot,
  getSnapshot,
  subscribe,
  writeSettings,
} from './store';

export type { Settings, ThemePreference };
export { defaultSettings, SETTINGS_STORAGE_KEY } from './store';

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Aufgelöste Zeitzone (nie 'auto'). */
  timeZone: string;
  format: Formatter;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /**
   * Veranstaltungsart oder Ordner anzeigen. Die Daten bleiben kanonisch
   * deutsch – gefiltert und gespeichert wird weiter danach.
   */
  term: (value: string) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Server und erster Client-Durchlauf sehen die Standardwerte, danach zieht
  // der Store die gespeicherten nach – ohne Effekt und ohne Hydrationskonflikt.
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const locationRequested = useRef(false);

  const update = useCallback((patch: Partial<Settings>) => writeSettings(patch), []);

  useEffect(() => {
    if (settings.citySelection !== 'automatic' || locationRequested.current) return;
    if (!navigator.geolocation) return;

    const params = new URLSearchParams(window.location.search);
    if (params.has('city')) return;

    locationRequested.current = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const cityId = nearestCityId({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        update({ cityId });
      },
      (error) => {
        console.info('[settings] Standort fuer Stadtauswahl nicht verfuegbar', error.message);
      },
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 5000 },
    );
  }, [settings.citySelection, update]);

  const timeZone =
    settings.timeZone === 'auto' ? cityById(settings.cityId).timeZone : settings.timeZone;

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      timeZone,
      format: createFormatter({ locale: settings.locale, timeZone, hour12: settings.hour12 }),
      t: (key, params) => translate(settings.locale, key, params),
      term: (value) => translateTerm(settings.locale, value),
    }),
    [settings, update, timeZone],
  );

  return (
    <SettingsContext.Provider value={value}>
      <ThemeSync theme={settings.theme} locale={settings.locale} />
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Schreibt Erscheinungsbild und Sprache an das <html>-Element – der einzige
 * Ort, an dem die Einstellungen ein externes System berühren.
 */
function ThemeSync({ theme, locale }: { theme: ThemePreference; locale: string }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.lang = locale;
  }, [theme, locale]);

  return null;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings ausserhalb von SettingsProvider verwendet');
  return context;
}
