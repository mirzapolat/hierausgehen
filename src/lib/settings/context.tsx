'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { cityById } from '@/lib/cities';
import { type MessageKey, translate } from '@/lib/i18n';
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
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Server und erster Client-Durchlauf sehen die Standardwerte, danach zieht
  // der Store die gespeicherten nach – ohne Effekt und ohne Hydrationskonflikt.
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback((patch: Partial<Settings>) => writeSettings(patch), []);

  const timeZone =
    settings.timeZone === 'auto' ? cityById(settings.cityId).timeZone : settings.timeZone;

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      timeZone,
      format: createFormatter({ locale: settings.locale, timeZone, hour12: settings.hour12 }),
      t: (key, params) => translate(settings.locale, key, params),
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
