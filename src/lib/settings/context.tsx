'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { DEFAULT_CITY_ID, cityById, nearestCityId, resolveCity, type GeoPoint } from '@/lib/cities';
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

/**
 * 'pending'  – noch nicht entschieden (Server, erster Durchlauf, Standortabfrage)
 * 'known'    – die Stadt steht fest
 * 'ask'      – weder gemerkt noch geortet: die Oberfläche muss fragen
 */
export type CityStatus = 'pending' | 'known' | 'ask';

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Die geltende Stadt – nie `null`, solange nichts feststeht die Standardstadt. */
  cityId: string;
  cityStatus: CityStatus;
  /** Stadt festlegen; damit ist die Frage beantwortet. */
  chooseCity: (id: string) => void;
  /** Standort aktiv erfragen (fragt nach Erlaubnis) und die nächste Stadt setzen. */
  locateCity: () => Promise<boolean>;
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

  const update = useCallback((patch: Partial<Settings>) => writeSettings(patch), []);

  /* ---------------------------- Stadtauswahl ---------------------------- */

  /**
   * Der Reihe nach: zuletzt geöffnete Stadt (bzw. Deeplink), dann der Standort
   * – aber nur, wenn er ohnehin schon freigegeben ist. Fehlt beides, fragt der
   * Kalender in einer eigenen Ansicht nach, statt stillschweigend München zu
   * zeigen. Der Standort wird also nie von sich aus abgefragt; das Fenster des
   * Browsers erscheint erst, wenn jemand darum bittet.
   */
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    // Bewusst nur beim Öffnen: danach entscheidet, wer die Stadt umstellt.
    const urlCityId = new URLSearchParams(window.location.search).get('city');
    const choice = resolveCity({ urlCityId, storedCityId: settings.cityId });
    if (choice.status === 'known') {
      update({ cityId: choice.cityId });
      return;
    }

    let cancelled = false;
    void positionIfPermitted().then((point) => {
      if (cancelled) return;
      if (point) update({ cityId: nearestCityId(point) });
      else setAsking(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cityId = settings.cityId ?? DEFAULT_CITY_ID;
  const cityStatus: CityStatus = settings.cityId ? 'known' : asking ? 'ask' : 'pending';

  const chooseCity = useCallback(
    (id: string) => {
      setAsking(false);
      update({ cityId: id });
    },
    [update],
  );

  /** Auf Zuruf: hier darf der Browser nach der Erlaubnis fragen. */
  const locateCity = useCallback(async () => {
    const point = await currentPosition();
    if (!point) return false;
    setAsking(false);
    update({ cityId: nearestCityId(point) });
    return true;
  }, [update]);

  const timeZone = settings.timeZone === 'auto' ? cityById(cityId).timeZone : settings.timeZone;

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      cityId,
      cityStatus,
      chooseCity,
      locateCity,
      timeZone,
      format: createFormatter({ locale: settings.locale, timeZone, hour12: settings.hour12 }),
      t: (key, params) => translate(settings.locale, key, params),
      term: (value) => translateTerm(settings.locale, value),
    }),
    [settings, update, cityId, cityStatus, chooseCity, locateCity, timeZone],
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

/**
 * Standort nur lesen, wenn er bereits freigegeben ist – sonst `null`. Kennt der
 * Browser die Permissions-API nicht, gilt das als „nicht freigegeben": lieber
 * fragen als ungefragt ein Berechtigungsfenster aufziehen.
 */
async function positionIfPermitted(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.permissions) {
    return null;
  }
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    if (permission.state !== 'granted') return null;
  } catch {
    return null;
  }
  return currentPosition();
}

function currentPosition(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        console.info('[settings] Standort fuer Stadtauswahl nicht verfuegbar', error.message);
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 8000 },
    );
  });
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings ausserhalb von SettingsProvider verwendet');
  return context;
}
