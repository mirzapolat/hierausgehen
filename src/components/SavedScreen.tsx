'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { SavedEventsResponse } from '@/app/api/events/saved/route';
import { cityById } from '@/lib/cities';
import { displayAvailability, sourceColor, sourceName } from '@/lib/events/display';
import { seriesKey } from '@/lib/events/series';
import type { CalendarEvent, EventPerformance } from '@/lib/events/types';
import { useSavedEvents, type SavedReason } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import { AvailabilityDot } from './AvailabilityDot';
import { BackToCalendar } from './BackToCalendar';
import { BottomSheet } from './BottomSheet';
import { DetailPanel } from './DetailPanel';
import { Calendar, Close, Search } from './icons';
import { SaveButton } from './SaveButton';

type Item = SavedEventsResponse['items'][number];

/** Gleiche Kurve wie im Kalender. */
const MOTION_MS = 200;

/**
 * Die Merkliste als eigene Seite: alle gemerkten Termine nach Tagen, über
 * alle Städte. Die Liste liegt im Browser (`lib/saved.ts`); die Termine dazu
 * – auch die, die eine gemerkte Reihe oder Suche findet – kommen aus dem
 * täglichen Datenstand (`/api/events/saved`).
 *
 * Ein Klick auf einen Termin öffnet die Details gleich hier: am Schreibtisch
 * als Spalte rechts, auf dem Telefon als Sheet.
 */
export function SavedScreen() {
  const { format, t, term } = useSettings();
  const router = useRouter();
  const saved = useSavedEvents();
  // Auf dem Server ist die Liste immer leer – „noch nichts gemerkt“ erst im Browser sagen.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);

  // Ausnahmen wendet der Browser selbst an – sie gehören nicht in die Anfrage,
  // sonst lädt jedes einzeln entfernte Datum die ganze Liste neu.
  const request = useMemo(() => {
    const { events, series, searches } = saved.state;
    if (events.length + series.length + searches.length === 0) return '';
    return JSON.stringify({
      events,
      series: series.map(({ key, title }) => ({ key, title })),
      searches: searches.map(({ query, cityId, locale }) => ({ query, cityId, locale })),
    });
  }, [saved.state]);
  const [result, setResult] = useState<{ key: string; data?: SavedEventsResponse; failed?: boolean }>();

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    fetch('/api/events/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: request,
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<SavedEventsResponse>;
      })
      .then((data) => setResult({ key: request, data }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: request, failed: true });
      });
    return () => controller.abort();
  }, [request]);

  // Was eben vergessen wurde, verschwindet sofort – ohne auf die neue
  // Antwort zu warten. Bis dahin gilt die letzte.
  const data = result?.data;
  const items = useMemo(
    () => (data?.items ?? []).filter((item) => saved.isSaved(item.event, item.cityId)),
    [data, saved],
  );
  const missing = (data?.missing ?? []).filter((id) => saved.state.events.some((entry) => entry.id === id));
  const loading = Boolean(request) && !data && !result?.failed;
  const failed = result?.failed && result.key === request;
  const multipleCities =
    new Set([...items.map((item) => item.cityId), ...saved.state.searches.map((search) => search.cityId)]).size > 1;
  const definitions = data?.definitions ?? [];

  const days = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const day = format.localDay(item.event.start);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return [...map];
  }, [items, format]);

  /* ----------------------------- Detailspalte ---------------------------- */

  // Der gewählte Termin bleibt stehen, auch wenn er gerade von der Liste
  // genommen wurde – sonst verschwände er mitten im Lesen.
  const [panel, setPanel] = useState<{ day: string; item?: Item }>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet = useOverlayTransition(sheetOpen && Boolean(panel?.item), MOTION_MS);

  const select = (item: Item) => {
    setPanel({ day: format.localDay(item.event.start), item });
    setSheetOpen(true);
  };

  // Escape schliesst die Details, wie im Kalender.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPanel(undefined);
      setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const calendarUrl = (cityOfEvent: string, event: Pick<CalendarEvent, 'id' | 'start'>) => {
    const params = new URLSearchParams({
      city: cityOfEvent,
      view: 'month',
      date: format.localDay(event.start),
      event: event.id,
    });
    return `/calendar?${params}`;
  };

  /** Weitere Termine: steht er hier, dann hier – sonst im Kalender. */
  const selectPerformance = (performance: EventPerformance) => {
    const found = (data?.items ?? []).find((item) => item.event.id === performance.id);
    if (found) select(found);
    else if (panel?.item) router.push(calendarUrl(panel.item.cityId, performance));
  };

  const dayEvents = panel
    ? items.filter((item) => format.localDay(item.event.start) === panel.day).map((item) => item.event)
    : [];
  const selectEvent = (event: CalendarEvent) => {
    const found = items.find((item) => item.event.id === event.id);
    if (found) select(found);
  };

  const detail = (mobile: boolean) =>
    panel && (
      <DetailPanel
        day={panel.day}
        dayEvents={dayEvents}
        event={panel.item?.event}
        cityId={panel.item?.cityId}
        shareUrl={panel.item ? calendarUrl(panel.item.cityId, panel.item.event) : undefined}
        definitions={definitions}
        onSelectEvent={selectEvent}
        onSelectPerformance={selectPerformance}
        onBackToDay={() => (mobile ? setSheetOpen(false) : setPanel({ day: panel.day }))}
        onClose={mobile ? undefined : () => setPanel(undefined)}
        inSheet={mobile}
      />
    );

  /* ------------------------------ Regeln ------------------------------ */

  const rules = useMemo(() => {
    const matchCount = (match: (item: Item, reasons: SavedReason[]) => boolean) =>
      items.filter((item) => match(item, saved.reasons(item.event, item.cityId))).length;
    return [
      ...saved.state.series.map((series) => ({
        key: `series:${series.key}`,
        kind: 'series' as const,
        label: series.title,
        count: matchCount(
          (item, reasons) => seriesKey(item.event) === series.key && reasons.some((r) => r.kind === 'series'),
        ),
        remove: () => saved.forgetSeries(series.key),
      })),
      ...saved.state.searches.map((search) => ({
        key: `search:${search.cityId}:${search.query}`,
        kind: 'search' as const,
        label: multipleCities ? `${search.query} · ${cityById(search.cityId).name}` : search.query,
        count: matchCount(
          (item, reasons) =>
            item.cityId === search.cityId && reasons.some((r) => r.kind === 'search' && r.query === search.query),
        ),
        remove: () => saved.toggleSearch(search.query, search.cityId, search.locale),
      })),
    ];
  }, [saved, items, multipleCities]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        <BackToCalendar />
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('savedTitle')}</h1>
        {hydrated && items.length > 0 && <span className="text-[12px] tabular-nums text-faint">{items.length}</span>}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-quiet">
          <div className="mx-auto w-full max-w-[640px] px-4 pb-6 lg:px-5 lg:pb-8">
            {hydrated && !request && <Notice>{t('savedEmpty')}</Notice>}
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
                  {list.map((item) => {
                    const { cityId: eventCity, event } = item;
                    const color = sourceColor(definitions, event.sourceId);
                    const selected = panel?.item?.event.id === event.id;
                    const via = viaLabel(saved.reasons(event, eventCity), t);
                    return (
                      <li
                        key={event.id}
                        style={{ '--row-mark': color } as CSSProperties}
                        className={`row-hover flex items-start hover:bg-[var(--chrome)] ${
                          selected ? 'bg-[var(--chrome)]' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => select(item)}
                          aria-current={selected || undefined}
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
                            {via && <span className="mt-0.5 block truncate text-[11px] text-faint">{via}</span>}
                          </span>
                        </button>
                        <SaveButton
                          event={event}
                          cityId={eventCity}
                          className={() =>
                            `m-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)]
                             text-accent hover:bg-[var(--canvas)]`
                          }
                        />
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

            {/* Reihen und Suchen sind Regeln, keine Termine – sie stehen
                gesammelt darunter, auch wenn sie gerade nichts finden. */}
            {hydrated && rules.length > 0 && (
              <section className="mt-8">
                <h2 className="px-1 pb-1.5 text-[12px] font-medium text-muted">
                  {[
                    saved.state.series.length > 0 ? t('savedSeriesList') : undefined,
                    saved.state.searches.length > 0 ? t('savedSearches') : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </h2>
                <ul className="flex flex-col divide-y divide-[var(--line)] border-y border-line">
                  {rules.map((rule) => (
                    <li key={rule.key} className="flex items-center gap-3 py-1.5 pl-3">
                      <span className="grid h-3.5 w-3.5 shrink-0 place-items-center text-faint">
                        {rule.kind === 'series' ? (
                          <Calendar className="h-3.5 w-3.5" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text">{rule.label}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-faint">
                        {data ? (rule.count > 0 ? rule.count : t('savedRuleEmpty')) : ''}
                      </span>
                      <button
                        type="button"
                        onClick={rule.remove}
                        aria-label={rule.kind === 'series' ? t('unsaveSeries') : t('unsaveSearch')}
                        title={rule.kind === 'series' ? t('unsaveSeries') : t('unsaveSearch')}
                        className="mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)]
                                   text-muted hover:bg-[var(--chrome)] hover:text-text"
                      >
                        <Close className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        {/* Am Schreibtisch: Details als Spalte rechts. */}
        {panel && (
          <aside className="hidden w-[380px] shrink-0 overflow-hidden hairline-l lg:block">{detail(false)}</aside>
        )}
      </div>

      {/* Telefon: Details als Sheet, das von unten aufsteigt. */}
      {/* Dasselbe Sheet wie im Kalender: mit Griff, zum Herunterwischen. */}
      {sheet.mounted && panel?.item && (
        <BottomSheet shown={sheet.shown} onClose={() => setSheetOpen(false)} closeLabel={t('close')}>
          {detail(true)}
        </BottomSheet>
      )}
    </div>
  );
}

/** Woher der Eintrag kommt – nur, wenn nicht der Termin selbst gemerkt ist. */
function viaLabel(reasons: SavedReason[], t: ReturnType<typeof useSettings>['t']): string | undefined {
  if (reasons.some((reason) => reason.kind === 'event')) return undefined;
  return reasons
    .map((reason) =>
      reason.kind === 'series'
        ? t('savedViaSeries')
        : reason.kind === 'search'
          ? t('savedViaSearch', { query: reason.query })
          : '',
    )
    .filter(Boolean)
    .join(' · ');
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 px-1 text-[13px] text-faint">{children}</p>;
}

/** Für `useSyncExternalStore`: nur die Frage, ob schon im Browser gerendert wird. */
const noSubscribe = () => () => {};
