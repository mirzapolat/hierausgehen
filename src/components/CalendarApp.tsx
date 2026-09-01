'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AggregateResult, CalendarEvent } from '@/lib/events/types';
import { dedupeEvents } from '@/lib/events/normalize';
import {
  type ViewMode,
  addDays,
  addMonths,
  clampDay,
  coverageRange,
  isSameMonth,
  loadRange,
} from '@/lib/calendar';
import { useSettings } from '@/lib/settings/context';
import { AgendaList } from './AgendaList';
import { DetailPanel } from './DetailPanel';
import { HorizontalCalendar } from './HorizontalCalendar';
import { MonthScrollView } from './MonthScrollView';
import { MonthView } from './MonthView';
import { PullToRefresh } from './PullToRefresh';
import { ResizeHandle } from './ResizeHandle';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';
import { Close } from './icons';

interface Props {
  initialData: AggregateResult;
  initialRange: { from: string; to: string };
  initialCityId: string;
  initialAnchor: string;
}

const LAYOUT_STORAGE_KEY = 'hierausgehen.layout.v1';

interface LayoutPrefs {
  view: ViewMode;
  disabledSources: string[];
  availableOnly: boolean;
  disabledCategories: string[];
  sidebarWidth: number;
  detailWidth: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
}

const defaultLayout: LayoutPrefs = {
  view: 'month',
  disabledSources: [],
  availableOnly: false,
  disabledCategories: [],
  sidebarWidth: 228,
  detailWidth: 336,
  sidebarCollapsed: false,
  detailCollapsed: false,
};

export function CalendarApp({ initialData, initialRange, initialCityId, initialAnchor }: Props) {
  const { settings, update, format, t } = useSettings();

  const [view, setView] = useState<ViewMode>(defaultLayout.view);
  const [anchor, setAnchor] = useState<string>(initialAnchor);
  const [selectedDay, setSelectedDay] = useState<string>(anchor);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  /** Erzwingt bei erneutem „Heute" ein Zentrieren, auch wenn das Datum gleich bleibt. */
  const [calendarFocusKey, setCalendarFocusKey] = useState(0);

  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [availableOnly, setAvailableOnly] = useState(false);
  /** Solo ist absichtlich flüchtig: es überlebt kein Neuladen. */
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [disabledCategories, setDisabledCategories] = useState<Set<string>>(new Set());
  /** Solo für Veranstaltungsarten – wie das Quellen-Solo bewusst flüchtig. */
  const [categorySolo, setCategorySolo] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState(defaultLayout);

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadingSources, setLoadingSources] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const cityId = settings.cityId;
  const cache = useRef(new Map<string, AggregateResult>([[key(initialCityId, initialRange), initialData]]));
  /**
   * Erst wenn URL und Speicher gelesen sind, darf zurückgeschrieben werden.
   * Bewusst State und kein Ref: der Schreib-Effekt liefe sonst noch im selben
   * Durchlauf mit den Anfangswerten und würde den Deeplink überschreiben.
   */
  const [restored, setRestored] = useState(false);

  /* --------------------- Einstellungen und Deeplinks --------------------- */

  // Deeplink und gemerkte Einstellungen lassen sich erst nach der Hydration
  // lesen – der Server kennt weder URL-Parameter des Browsers noch localStorage.
  // Deshalb hier bewusst Zustand aus einem Effekt heraus setzen, genau einmal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    let stored: Partial<LayoutPrefs> = {};
    try {
      stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as Partial<LayoutPrefs>;
    } catch {
      // Unlesbare Werte ignorieren.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout({ ...defaultLayout, ...stored });
    if (stored.disabledSources) setDisabled(new Set(stored.disabledSources));
    if (typeof stored.availableOnly === 'boolean') setAvailableOnly(stored.availableOnly);
    if (stored.disabledCategories) setDisabledCategories(new Set(stored.disabledCategories));

    // Die URL hat Vorrang vor dem, was zuletzt lokal gemerkt wurde.
    const urlView = params.get('view');
    if (urlView === 'day' || urlView === 'week' || urlView === 'month') setView(urlView);
    else if (stored.view) setView(stored.view);

    const urlDate = params.get('date');
    const wanted = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : format.today();
    // Auch ein alter Link führt nur in den Zeitraum, den der Server vorhält.
    const startDay = clampDay(wanted, coverageRange(format.today()));
    setAnchor(startDay);
    setSelectedDay(startDay);

    const urlEvent = params.get('event');
    if (urlEvent) setSelectedEventId(urlEvent);

    const urlCity = params.get('city');
    if (urlCity && urlCity !== settings.cityId) update({ cityId: urlCity });

    setRestored(true);
    // Absichtlich nur beim Mounten – danach schreibt der Effekt unten zurück.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    params.set('city', cityId);
    params.set('view', view);
    params.set('date', anchor);
    if (selectedEventId) params.set('event', selectedEventId);
    window.history.replaceState(null, '', `?${params}`);
  }, [restored, cityId, view, anchor, selectedEventId]);

  useEffect(() => {
    if (!restored) return;
    try {
      const prefs: LayoutPrefs = {
        ...layout,
        view,
        disabledSources: [...disabled],
        availableOnly,
        disabledCategories: [...disabledCategories],
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Privater Modus – nicht kritisch.
    }
  }, [restored, layout, view, disabled, availableOnly, disabledCategories]);

  /* ------------------------------- Laden -------------------------------- */

  /**
   * Der Server erhebt zwölf Monate im Voraus; weiter kommt der Kalender nicht.
   * Alles, was den Anker verschiebt, geht durch `clampDay`.
   */
  const coverage = useMemo(() => coverageRange(format.today()), [format]);

  const range = useMemo(() => loadRange(anchor, coverage), [anchor, coverage]);

  const load = useCallback(
    async (target: { from: string; to: string }, city: string, force = false) => {
      const cacheKey = key(city, target);
      if (!force && cache.current.has(cacheKey)) {
        setData(cache.current.get(cacheKey)!);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ from: target.from, to: target.to, city });
        if (force) params.set('refresh', '1');
        const res = await fetch(`/api/events?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as AggregateResult;
        cache.current.set(cacheKey, next);
        setData(next);
      } catch (error) {
        console.error('[calendar] Laden fehlgeschlagen', error);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(range, cityId);
  }, [range, cityId, load]);

  const reloadSource = useCallback(
    async (sourceId: string) => {
      setLoadingSources((current) => new Set(current).add(sourceId));
      try {
        const params = new URLSearchParams({
          from: range.from,
          to: range.to,
          city: cityId,
          sources: sourceId,
          refresh: '1',
          retry: 'source',
        });
        const res = await fetch(`/api/events?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as AggregateResult;

        setData((current) => {
          const merged = mergeSourceResult(current, next);
          cache.current.set(key(cityId, range), merged);
          return merged;
        });
      } catch (error) {
        console.error(`[calendar] Quelle "${sourceId}" neu laden fehlgeschlagen`, error);
      } finally {
        setLoadingSources((current) => {
          const next = new Set(current);
          next.delete(sourceId);
          return next;
        });
      }
    },
    [cityId, range],
  );

  /* ------------------------------ Filtern ------------------------------- */

  // Solo hat Vorrang vor der dauerhaften Auswahl, verändert sie aber nicht.
  const enabled = useMemo(
    () => new Set(data.definitions.filter((d) => !disabled.has(d.id)).map((d) => d.id)),
    [data.definitions, disabled],
  );
  const visibleSources = solo.size > 0 ? solo : enabled;

  /** Gattungen, die im geladenen Zeitraum vorkommen – ohne die Ticket- und Textfilter. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of data.events) {
      if (!visibleSources.has(event.sourceId)) continue;
      const name = event.category ?? '';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, settings.locale));
  }, [data.events, visibleSources, settings.locale]);

  // Solo hat Vorrang vor der Pillen-Auswahl, verändert sie aber nicht.
  const enabledCategories = useMemo(
    () =>
      categorySolo.size > 0
        ? new Set(categories.map((c) => c.name).filter((name) => categorySolo.has(name)))
        : new Set(categories.map((c) => c.name).filter((name) => !disabledCategories.has(name))),
    [categories, disabledCategories, categorySolo],
  );

  const events = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(settings.locale);
    return data.events.filter((event) => {
      if (!visibleSources.has(event.sourceId)) return false;
      const category = event.category ?? '';
      if (categorySolo.size > 0 ? !categorySolo.has(category) : disabledCategories.has(category))
        return false;
      if (availableOnly && !['available', 'limited'].includes(event.availability)) return false;
      if (!needle) return true;
      return [event.title, event.subtitle, event.description, event.venue.name, event.category]
        .filter(Boolean)
        .some((field) => field!.toLocaleLowerCase(settings.locale).includes(needle));
    });
  }, [
    data.events,
    visibleSources,
    disabledCategories,
    categorySolo,
    availableOnly,
    query,
    settings.locale,
  ]);

  const dayEvents = useMemo(
    () => events.filter((event) => format.localDay(event.start) === selectedDay),
    [events, selectedDay, format],
  );
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
  );

  /* ------------------------------ Aktionen ------------------------------ */

  /** Wohin ein Schritt führt – auf den abgedeckten Zeitraum begrenzt. */
  const steppedAnchor = useCallback(
    (current: string, direction: -1 | 1) => {
      const raw =
        view === 'day'
          ? addDays(current, direction)
          : view === 'week'
            ? addDays(current, direction * 7)
            : addMonths(current, direction);
      return clampDay(raw, coverage);
    },
    [view, coverage],
  );

  const canStep = useCallback(
    (direction: -1 | 1) => {
      const next = steppedAnchor(anchor, direction);
      return view === 'month' ? !isSameMonth(next, anchor) : next !== anchor;
    },
    [anchor, view, steppedAnchor],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      if (!canStep(direction)) return;
      setAnchor(steppedAnchor(anchor, direction));
      const amount = view === 'day' ? direction : view === 'week' ? direction * 7 : 0;
      if (amount) setSelectedDay((current) => clampDay(addDays(current, amount), coverage));
    },
    [anchor, view, coverage, canStep, steppedAnchor],
  );

  const goToday = useCallback(() => {
    const now = format.today();
    setAnchor(now);
    setSelectedDay(now);
    setSelectedEventId(undefined);
    setCalendarFocusKey((current) => current + 1);
  }, [format]);

  const selectDay = useCallback(
    (day: string) => {
      const target = clampDay(day, coverage);
      setAnchor(target);
      setSelectedDay(target);
      setSelectedEventId(undefined);
    },
    [coverage],
  );

  const selectEvent = useCallback(
    (event: CalendarEvent) => {
      const day = clampDay(format.localDay(event.start), coverage);
      setAnchor(day);
      setSelectedDay(day);
      setSelectedEventId(event.id);
      setSheetOpen(true);
      setLayout((current) => ({ ...current, detailCollapsed: false }));
    },
    [format, coverage],
  );

  // Tastatur: Pfeile blättern, t = heute, d/w/m = Ansicht.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't') goToday();
      else if (e.key === 'd') setView('day');
      else if (e.key === 'w') setView('week');
      else if (e.key === 'm') setView('month');
      else if (e.key === 'Escape') {
        setFiltersOpen(false);
        setSheetOpen(false);
        setSelectedEventId(undefined);
        setSolo(new Set());
        setCategorySolo(new Set());
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, goToday]);

  const refresh = useCallback(() => load(range, cityId, true), [load, range, cityId]);

  const sidebar = (
    <Sidebar
      definitions={data.definitions}
      status={data.sources}
      enabled={enabled}
      onToggleSource={(id) =>
        setDisabled((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      onToggleGroup={(ids, on) =>
        setDisabled((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (on) next.delete(id);
            else next.add(id);
          }
          return next;
        })
      }
      solo={solo}
      onSolo={(ids) =>
        setSolo((current) => {
          const same = current.size === ids.length && ids.every((id) => current.has(id));
          return same || ids.length === 0 ? new Set() : new Set(ids);
        })
      }
      reloadingSources={loadingSources}
      onReloadSource={reloadSource}
      categories={categories}
      enabledCategories={enabledCategories}
      onToggleCategory={(name) => {
        // Bei aktivem Solo führt ein Klick zunächst dorthin zurück, wo man war.
        if (categorySolo.size > 0) {
          setCategorySolo(new Set());
          return;
        }
        setDisabledCategories((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
      }}
      categorySolo={categorySolo}
      onCategorySolo={(name) =>
        setCategorySolo((current) =>
          current.size === 1 && current.has(name) ? new Set() : new Set([name]),
        )
      }
      onShowAllCategories={() => {
        setCategorySolo(new Set());
        setDisabledCategories(new Set());
      }}
      availableOnly={availableOnly}
      onAvailableOnlyChange={setAvailableOnly}
      query={query}
      onQueryChange={setQuery}
    />
  );

  return (
    <PullToRefresh disabled={filtersOpen || sheetOpen} refreshing={loading} onRefresh={refresh}>
      <div className="flex h-full flex-col overflow-hidden">
        <Toolbar
          view={view}
          anchor={anchor}
          loading={loading}
          cityId={cityId}
          onCityChange={(id) => update({ cityId: id })}
          onViewChange={setView}
          onStep={step}
          canStepBack={canStep(-1)}
          canStepForward={canStep(1)}
          onToday={goToday}
          onRefresh={() => void refresh()}
          onOpenFilters={() => setFiltersOpen(true)}
          activeFilterCount={
            disabled.size +
            solo.size +
            categorySolo.size +
            disabledCategories.size +
            (availableOnly ? 1 : 0) +
            (query ? 1 : 0)
          }
          sidebarCollapsed={layout.sidebarCollapsed}
          detailCollapsed={layout.detailCollapsed}
          onToggleSidebar={() =>
            setLayout((c) => ({ ...c, sidebarCollapsed: !c.sidebarCollapsed }))
          }
          onToggleDetail={() => setLayout((c) => ({ ...c, detailCollapsed: !c.detailCollapsed }))}
        />

        <div className="flex min-h-0 flex-1">
          {/* Filter – links, ab lg dauerhaft sichtbar und in der Breite verstellbar */}
          {!layout.sidebarCollapsed && (
            <>
              <aside
                className="hidden min-h-0 shrink-0 bg-[var(--chrome)] hairline-r lg:block"
                style={{ width: layout.sidebarWidth }}
              >
                {sidebar}
              </aside>
              <ResizeHandle
                side="left"
                className="hidden lg:block"
                width={layout.sidebarWidth}
                onChange={(width) => setLayout((c) => ({ ...c, sidebarWidth: width }))}
              />
            </>
          )}

          {/* Kalender */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {view !== 'month' && (
              <HorizontalCalendar
                key={calendarFocusKey}
                mode={view}
                anchor={anchor}
                events={events}
                definitions={data.definitions}
                selectedDay={selectedDay}
                selectedEventId={selectedEventId}
                onSelectDay={selectDay}
                onSelectEvent={selectEvent}
                onStep={step}
                canStep={canStep}
              />
            )}

            {view === 'month' && (
              <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
                <MonthScrollView
                  anchor={anchor}
                  events={events}
                  definitions={data.definitions}
                  selectedDay={selectedDay}
                  selectedEventId={selectedEventId}
                  onSelectDay={selectDay}
                  onSelectEvent={selectEvent}
                  onAnchorChange={setAnchor}
                  coverage={coverage}
                  focusKey={calendarFocusKey}
                />
              </div>
            )}

            {/* Mobile */}
            {view === 'month' && (
              <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                <div className="h-[288px] shrink-0 hairline-b">
                  <MonthView
                    compact
                    anchor={anchor}
                    events={events}
                    definitions={data.definitions}
                    selectedDay={selectedDay}
                    selectedEventId={selectedEventId}
                    onSelectDay={selectDay}
                    onSelectEvent={selectEvent}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
                  <AgendaList
                    events={dayEvents}
                    definitions={data.definitions}
                    selectedId={selectedEventId}
                    onSelect={selectEvent}
                    emptyLabel={t('noEventsDay')}
                  />
                </div>
              </div>
            )}
          </main>

          {/* Details – rechts */}
          {!layout.detailCollapsed && (
            <>
              <ResizeHandle
                side="right"
                className="hidden lg:block"
                width={layout.detailWidth}
                min={260}
                max={520}
                onChange={(width) => setLayout((c) => ({ ...c, detailWidth: width }))}
              />
              <aside
                className="hidden min-h-0 shrink-0 hairline-l lg:block"
                style={{ width: layout.detailWidth }}
              >
                <DetailPanel
                  day={selectedDay}
                  dayEvents={dayEvents}
                  event={selectedEvent}
                  definitions={data.definitions}
                  onSelectEvent={selectEvent}
                  onBackToDay={() => setSelectedEventId(undefined)}
                />
              </aside>
            </>
          )}
        </div>

      {/* Mobile: Filter als Overlay */}
      {filtersOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('closeFilters')}
            onClick={() => setFiltersOpen(false)}
            className="absolute inset-0"
            style={{ background: 'var(--overlay)' }}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col bg-[var(--chrome)]"
            style={{ boxShadow: 'var(--shadow-overlay)' }}
          >
            <div className="flex h-12 shrink-0 items-center justify-between px-4 hairline-b">
              <span className="text-[13px] font-semibold">{t('filters')}</span>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label={t('close')}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted"
              >
                <Close />
              </button>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </div>
        </div>
      )}

      {/* Mobile: Detail als Sheet */}
      {sheetOpen && selectedEvent && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0"
            style={{ background: 'var(--overlay)' }}
          />
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden
                       rounded-t-[var(--radius-sheet)] bg-[var(--chrome)]"
            style={{
              boxShadow: 'var(--shadow-overlay)',
              height: 'min(88dvh, calc(100dvh - env(safe-area-inset-top) - 8px))',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <DetailPanel
                day={selectedDay}
                dayEvents={dayEvents}
                event={selectedEvent}
                definitions={data.definitions}
                onSelectEvent={selectEvent}
                onBackToDay={() => {
                  setSelectedEventId(undefined);
                  setSheetOpen(false);
                }}
                onClose={() => setSheetOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </PullToRefresh>
  );
}

function key(cityId: string, range: { from: string; to: string }): string {
  return `${cityId}_${range.from}_${range.to}`;
}

function mergeSourceResult(current: AggregateResult, next: AggregateResult): AggregateResult {
  const sourceIds = new Set(next.sources.map((source) => source.sourceId));
  const statuses = new Map(current.sources.map((source) => [source.sourceId, source]));
  for (const source of next.sources) statuses.set(source.sourceId, source);

  return {
    definitions: current.definitions,
    sources: current.sources.map((source) => statuses.get(source.sourceId) ?? source),
    events: dedupeEvents([
      ...current.events.filter((event) => !sourceIds.has(event.sourceId)),
      ...next.events,
    ]).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'de')),
  };
}
