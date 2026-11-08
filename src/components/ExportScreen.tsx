'use client';

import { useState } from 'react';
import { track } from '@/lib/analytics';
import { useSettings } from '@/lib/settings/context';
import { BackToCalendar } from './BackToCalendar';
import { Checkbox } from './Checkbox';

/**
 * Auswahl der Städte für den CSV-Export – voreingestellt alle, denn der
 * Endpunkt ohne Parameter meint denselben ganzen Bestand.
 */
export function ExportScreen({ cities }: { cities: { id: string; name: string }[] }) {
  const { t } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cities.map((city) => city.id)));

  const chosen = cities.filter((city) => selected.has(city.id)).map((city) => city.id);
  const href = `/api/events/export?${chosen.map((id) => `city=${encodeURIComponent(id)}`).join('&')}`;
  const allChosen = chosen.length === cities.length;
  const nothingChosen = chosen.length === 0;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        <BackToCalendar />
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('exportTitle')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="mx-auto w-full max-w-[560px] px-5 py-8">
          <p className="mb-8 text-[13px] leading-relaxed text-muted">{t('exportLead')}</p>

          <section className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                {t('exportCities')}
              </h2>
              <button
                type="button"
                onClick={() => setSelected(new Set(allChosen ? [] : cities.map((city) => city.id)))}
                className="text-[12px] text-muted hover:text-text"
              >
                {allChosen ? t('exportNone') : t('exportAll')}
              </button>
            </div>
            <ul>
              {cities.map((city) => (
                <li key={city.id} className="hairline-b">
                  <label className="flex cursor-pointer items-center gap-3 py-2.5 text-[13px] text-text">
                    <Checkbox
                      state={selected.has(city.id) ? 'on' : 'off'}
                      label={city.name}
                      onChange={() => toggle(city.id)}
                    />
                    {city.name}
                  </label>
                </li>
              ))}
            </ul>
          </section>

          {/* Kein <Link>: die CSV kommt von der API, sie ist keine Seite. */}
          <a
            href={nothingChosen ? undefined : href}
            download
            aria-disabled={nothingChosen}
            onClick={(event) => {
              if (nothingChosen) {
                event.preventDefault();
                return;
              }
              track('csv-export', { cities: chosen.join(','), count: chosen.length });
            }}
            className={`flex h-9 items-center justify-center rounded-[var(--radius-md)] text-[13px] font-medium
                        transition-colors ${
                          nothingChosen
                            ? 'cursor-not-allowed bg-[var(--chrome)] text-faint'
                            : 'bg-[var(--accent)] text-white hover:opacity-90'
                        }`}
          >
            {t('exportDownload')}
          </a>
          {nothingChosen && (
            <p className="mt-3 text-[11px] leading-relaxed text-faint">{t('exportNothingSelected')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
