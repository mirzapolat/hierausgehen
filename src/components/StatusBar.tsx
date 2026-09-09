'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { cities } from '@/lib/cities';
import { useSettings } from '@/lib/settings/context';
import { Checkbox } from './Checkbox';

export function StatusBar({ cityId }: { cityId: string }) {
  const { t } = useSettings();
  const link = 'shrink-0 whitespace-nowrap px-1 py-2 text-[12px] text-faint underline-offset-2 hover:text-muted hover:underline lg:py-1 lg:text-[11px]';

  return (
    <footer
      className="relative flex shrink-0 items-center justify-between gap-4 bg-[var(--chrome)] px-3 py-1 hairline-t lg:px-5 lg:py-2"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex min-w-0 items-center gap-4 lg:gap-5">
        <Link href="/impressum" className={link}>{t('imprint')}</Link>
        <Link href={`/status?city=${encodeURIComponent(cityId)}`} className={link}>{t('status')}</Link>
        <ExportLink />
      </div>
      <nav aria-label="Veranstaltungsübersichten" className="hidden items-center gap-6 lg:flex">
        {cities.map((city) => (
          <Link
            key={city.id}
            href={`/veranstaltungen/${encodeURIComponent(city.id)}`}
            prefetch={false}
            className={link}
          >
            Veranstaltungen {city.name}
          </Link>
        ))}
      </nav>
      <a
        href="https://donate.stripe.com/aFa8wO78f6zndFp2xF0kE03"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('donateTitle')}
        title={t('donateTitle')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-red-500/30
                   bg-red-500/10 text-red-500 transition-colors
                   hover:border-red-500/50 hover:bg-red-500/20 lg:h-7 lg:w-7"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 shrink-0">
          <path d="M12 21s-9-5.5-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-9 12-9 12Z" />
        </svg>
      </a>
    </footer>
  );
}

/**
 * Export als CSV.
 *
 * Bei einer einzigen Stadt gibt es nichts zu wählen und der Link lädt direkt.
 * Sobald es mehrere sind, fragt ein kleines Feld darüber, welche mit sollen –
 * voreingestellt alle, denn der Endpunkt ohne Parameter meint denselben
 * ganzen Bestand.
 */
function ExportLink() {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => allCityIds());
  const panel = useRef<HTMLDivElement>(null);

  // Alles, was das Feld aus dem Zusammenhang reisst, schliesst es.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const link =
    'shrink-0 whitespace-nowrap px-1 py-2 text-[12px] text-faint underline-offset-2 hover:text-muted hover:underline lg:py-1 lg:text-[11px]';

  if (cities.length < 2) {
    return (
      // Kein <Link>: die CSV kommt von der API, sie ist keine Seite.
      <a
        href="/api/events/export"
        download
        title={t('exportCsvTitle')}
        onClick={() => track('csv-export', { cities: cities[0].id, count: 1 })}
        className={link}
      >
        {t('exportCsv')}
      </a>
    );
  }

  const chosen = cities.filter((city) => selected.has(city.id)).map((city) => city.id);
  const href = `/api/events/export?${chosen
    .map((id) => `city=${encodeURIComponent(id)}`)
    .join('&')}`;

  return (
    <div className="contents" ref={panel}>
      <button
        type="button"
        aria-expanded={open}
        title={t('exportCsvTitle')}
        onClick={() => {
          // Beim Öffnen wieder alle: die Voreinstellung ist der ganze Bestand.
          if (!open) setSelected(allCityIds());
          setOpen((value) => !value);
        }}
        className={link}
      >
        {t('exportCsv')}
      </button>

      {open && (
        <div
          className="absolute bottom-full left-3 z-50 mb-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-[var(--radius-md)]
                     border border-line bg-[var(--raised)] p-3"
          style={{ boxShadow: 'var(--shadow-overlay)' }}
        >
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            {t('exportCities')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {cities.map((city) => (
              <li key={city.id}>
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
                  <Checkbox
                    state={selected.has(city.id) ? 'on' : 'off'}
                    label={city.name}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (!next.delete(city.id)) next.add(city.id);
                        return next;
                      })
                    }
                  />
                  {city.name}
                </label>
              </li>
            ))}
          </ul>
          <a
            href={href}
            download
            aria-disabled={selected.size === 0}
            onClick={(event) => {
              if (selected.size === 0) {
                event.preventDefault();
                return;
              }
              track('csv-export', { cities: chosen.join(','), count: chosen.length });
              setOpen(false);
            }}
            className={`mt-3 block rounded-[var(--radius-sm)] px-2 py-1.5 text-center text-[12px]
                        font-medium transition-colors ${
                          selected.size === 0
                            ? 'cursor-not-allowed bg-[var(--chrome)] text-faint'
                            : 'bg-[var(--accent)] text-white hover:opacity-90'
                        }`}
          >
            {t('exportDownload')}
          </a>
        </div>
      )}
    </div>
  );
}

function allCityIds(): Set<string> {
  return new Set(cities.map((city) => city.id));
}

