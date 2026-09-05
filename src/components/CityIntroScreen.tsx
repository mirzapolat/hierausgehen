'use client';

import { useState } from 'react';
import { cities } from '@/lib/cities';
import { useSettings } from '@/lib/settings/context';
import { MapPin } from './icons';

/**
 * Erste Frage beim Öffnen, wenn weder eine gemerkte Stadt noch ein
 * freigegebener Standort vorliegt: die Stadt in voller Breite auswählen.
 * Bewusst kein Overlay über dem Kalender – solange die Stadt offen ist, wäre
 * alles dahinter geraten.
 */
export function CityIntroScreen() {
  const { chooseCity, locateCity, t } = useSettings();
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);

  const askLocation = async () => {
    setLocating(true);
    setFailed(false);
    const found = await locateCity();
    setLocating(false);
    if (!found) setFailed(true);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--chrome)] scroll-quiet">
      <div className="m-auto w-full max-w-[420px] px-6 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          {t('appName')}
        </p>
        <h1 className="mt-5 text-[19px] font-semibold tracking-[-0.01em]">{t('cityIntroTitle')}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('cityIntroLead')}</p>

        <ul className="mt-7 overflow-hidden rounded-[var(--radius-md)] border border-line bg-[var(--canvas)]">
          {cities.map((city, index) => (
            <li key={city.id} className={index > 0 ? 'hairline-t' : undefined}>
              <button
                type="button"
                onClick={() => chooseCity(city.id)}
                className="flex w-full items-baseline gap-3 px-4 py-3 text-left hover:bg-[var(--chrome)]"
              >
                <span className="flex-1 text-[14px] text-text">{city.name}</span>
                <span className="text-[11px] tracking-[0.04em] text-faint">{city.country}</span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={askLocation}
          disabled={locating}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)]
                     border border-line text-[13px] text-muted hover:border-line-strong hover:text-text
                     disabled:text-faint"
        >
          <MapPin className="h-3.5 w-3.5" />
          {locating ? t('useLocationPending') : t('useLocation')}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          {failed ? t('useLocationFailed') : t('cityIntroHint')}
        </p>
      </div>
    </div>
  );
}
