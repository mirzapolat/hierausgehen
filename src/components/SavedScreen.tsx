'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { SavedEventsResponse } from '@/app/api/events/saved/route';
import { cityById } from '@/lib/cities';
import { displayAvailability, sourceColor, sourceName } from '@/lib/events/display';
import type { CalendarEvent } from '@/lib/events/types';
import { returnPath } from '@/lib/return-path';
import { useSavedEvents } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { AvailabilityDot } from './AvailabilityDot';
import { Bookmark, ChevronLeft } from './icons';

/**
 * Die Merkliste als eigene Seite: alle gemerkten Termine nach Tagen, über
 * alle Städte. Die IDs liegen im Browser (`lib/saved.ts`); die Termine dazu
 * kommen aus dem täglichen Datenstand (`/api/events/saved`).
 */
export function SavedScreen() {
  const { cityId, format, t, term } = useSettings();
  const router = useRouter();
  const saved = useSavedEvents();
  // Auf dem Server ist die Liste immer leer – „noch nichts gemerkt“ erst im Browser sagen.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);

  // Sortiert, damit dieselbe Liste dieselbe Anfrage ergibt.
  const key = useMemo(() => [...saved.ids].sort().join(','), [saved.ids]);
  const [result, setResult] = useState<{ key: string; data?: SavedEventsResponse; failed?: boolean }>();

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch(`/api/events/saved?id=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<SavedEventsResponse>;
      })
      .then((data) => setResult({ key, data }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, failed: true });
      });
    return () => controller.abort();
  }, [key]);

  // Was eben vergessen wurde, verschwindet sofort – ohne auf die neue
  // Antwort zu warten. Bis dahin gilt die letzte.
  const data = result?.data;
  const items = useMemo(
    () => (data?.items ?? []).filter((item) => saved.ids.has(item.event.id)),
    [data, saved.ids],
  );
  const missing = (data?.missing ?? []).filter((id) => saved.ids.has(id));
  const loading = Boolean(key) && !data && !result?.failed;
  const failed = result?.failed && result.key === key;
  const multipleCities = new Set(items.map((item) => item.cityId)).size > 1;
  const definitions = data?.definitions ?? [];

  const days = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const day = format.localDay(item.event.start);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return [...map];
  }, [items, format]);

  const open = (cityOfEvent: string, event: CalendarEvent) => {
    const params = new URLSearchParams({
      city: cityOfEvent,
      view: 'month',
      date: format.localDay(event.start),
      event: event.id,
    });
    router.push(`/?${params}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        {/* Zurück an die Stelle, von der aus die Merkliste geöffnet wurde. */}
        <Link
          href="/"
          onClick={(e) => {
            e.preventDefault();
            router.push(returnPath(cityId));
          }}
          className="-ml-1 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px]
                     text-muted hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t('backToCalendar')}
        </Link>
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('savedTitle')}</h1>
        {hydrated && saved.ids.size > 0 && (
          <span className="text-[12px] tabular-nums text-faint">{saved.ids.size}</span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="mx-auto w-full max-w-[640px] px-4 py-6 lg:px-5 lg:py-8">
          <p className="px-1 text-[12px] leading-relaxed text-muted">{t('savedLead')}</p>

          {hydrated && !key && <Notice>{t('savedEmpty')}</Notice>}
          {loading && <Notice>{t('savedLoading')}</Notice>}
          {failed && <Notice>{t('savedError')}</Notice>}

          {days.map(([day, list]) => (
            <section key={day} className="mt-6">
              <h2
                className={`px-1 pb-1.5 text-[13px] font-semibold ${
                  day === format.today() ? 'text-accent' : 'text-text'
                }`}
              >
                {format.dayLong(day)}
              </h2>
              <ul className="flex flex-col divide-y divide-[var(--line)] border-y border-line">
                {list.map(({ cityId: eventCity, event }) => {
                  const color = sourceColor(definitions, event.sourceId);
                  return (
                    <li
                      key={event.id}
                      style={{ '--row-mark': color } as CSSProperties}
                      className="row-hover flex items-start hover:bg-[var(--chrome)]"
                    >
                      <button
                        type="button"
                        onClick={() => open(eventCity, event)}
                        title={t('savedInCalendar')}
                        className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-3 text-left"
                      >
                        <span className="w-[64px] shrink-0 pt-[1px] text-[12px] tabular-nums text-muted">
                          {event.allDay ? t('allDay') : format.time(event.start)}
                        </span>
                        <span
                          aria-hidden="true"
                          className="mt-[5px] h-[13px] w-[2px] shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text">
                            {event.title}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                            <AvailabilityDot value={displayAvailability(event)} />
                            <span className="truncate">
                              {[
                                event.venue.name,
                                sourceName(definitions, event.sourceId),
                                event.category ? term(event.category) : undefined,
                                multipleCities ? cityById(eventCity).name : undefined,
                              ]
                                // Heisst das Haus wie der Ort, steht es nur einmal da.
                                .filter((part, index, all) => part && all.indexOf(part) === index)
                                .join(' · ')}
                            </span>
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => saved.toggle(event)}
                        aria-label={t('unsave')}
                        title={t('unsave')}
                        className="m-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)]
                                   text-accent hover:bg-[var(--canvas)]"
                      >
                        <Bookmark filled className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {missing.length > 0 && (
            <div className="mt-6 flex items-center gap-3 px-1 text-[12px] text-muted">
              <span>{t('savedMissing', { count: missing.length })}</span>
              <button
                type="button"
                onClick={() => saved.remove(missing)}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-text hover:bg-[var(--chrome)]"
              >
                {t('savedRemoveMissing')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 px-1 text-[13px] text-faint">{children}</p>;
}

/** Für `useSyncExternalStore`: nur die Frage, ob schon im Browser gerendert wird. */
const noSubscribe = () => () => {};
