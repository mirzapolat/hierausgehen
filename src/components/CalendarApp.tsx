'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AggregateResult, CalendarEvent, EventPerformance } from '@/lib/events/types';
import { addDays, addMonths, clampDay, loadRange, startOfWeek } from '@/lib/calendar';

import { track } from '@/lib/analytics';
import { eventsOnDay } from '@/lib/events/display';
import type { FeedFilter } from '@/lib/events/filter';
import { seriesRuns } from '@/lib/events/series';
import { SeriesProvider } from '@/lib/series-context';
import { defaultLayout } from '@/lib/layoutPrefs';
import { useSavedEvents } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { useAppPersistence } from '@/lib/useAppPersistence';
import { useCalendarNavigation } from '@/lib/useCalendarNavigation';
import { useCalendarShortcuts } from '@/lib/useCalendarShortcuts';
import { useEventData } from '@/lib/useEventData';
import { useEventFilters } from '@/lib/useEventFilters';
import { ActiveFilters } from './ActiveFilters';
import { AnnouncementDialog } from './AnnouncementDialog';
import { CityIntroScreen } from './CityIntroScreen';
import { DesktopColumn } from './DesktopColumns';
import { DetailPanel } from './DetailPanel';
import { HorizontalCalendar } from './HorizontalCalendar';
import { MobileEventSheet } from './MobileEventSheet';
import { MobileFilters } from './MobileFilters';
import { MobileMonth } from './MobileMonth';
import { MonthScrollView } from './MonthScrollView';
import { MOTION_MS } from './motion';
import { SearchField } from './SearchField';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';
import { useEventMenu } from './useEventMenu';

/**
 * Die Karte bringt Leaflet und dessen Stilvorlage mit. Beides wird erst
 * geladen, wenn jemand die Ansicht zum ersten Mal öffnet – wer nur den
 * Kalender benutzt, lädt es nie.
 */
const MapView = dynamic(() => import('./MapView').then((module) => module.MapView), {
  ssr: false,
});

interface Props {
  initialData: AggregateResult;
  initialRange: { from: string; to: string };
  initialCityId: string;
  initialAnchor: string;
}

/**
 * Setzt Kalender, Spalten und Overlays zusammen.
 *
 * Wo man im Kalender steht, regelt `useCalendarNavigation`; was beim Start
 * zurückgeholt und danach gemerkt wird, `useAppPersistence`. Die mobilen
 * Teile (`MobileMonth`, `MobileFilters`, `MobileEventSheet`) und die Spalten
 * am Schreibtisch (`DesktopColumn`) sind eigene Komponenten; hier bleibt, was
 * sie miteinander verbindet.
 */
export function CalendarApp({ initialData, initialRange, initialCityId, initialAnchor }: Props) {
  const { settings, cityStatus, chooseCity, format, t, term } = useSettings();

  const [layout, setLayout] = useState(defaultLayout);
  const revealDetail = useCallback(() => setLayout((current) => ({ ...current, detailCollapsed: false })), []);

  const nav = useCalendarNavigation({ initialAnchor, revealDetail });
  const {
    restored,
    view,
    anchor,
    displayAnchor,
    selectedDay,
    selectedEventId,
    setSelectedEventId,
    coverage,
    navRange,
    fromToday,
    canStep,
    step,
    previewStep,
    goToDay,
    goToday,
    selectDay,
    showEvent,
    changeView,
  } = nav;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Zähler: jede Erhöhung zeigt die neueste Ankündigung noch einmal. */
  const [newsRequest, setNewsRequest] = useState(0);
  /** Während des Ziehens folgt die Spalte sofort statt animiert. */
  const [resizing, setResizing] = useState(false);
  /** Zähler: jede Erhöhung rollt die weiteren Termine im Detail ins Bild. */
  const [revealPerformances, setRevealPerformances] = useState(0);
  /** Zähler: jede Erhöhung holt die Auswahl in den sichtbaren Bereich. */
  const [revealSelection, setRevealSelection] = useState(0);
  /** Mobil: die Suche ist aufgeklappt (mit Inhalt bleibt sie es ohnehin). */
  const [searchOpen, setSearchOpen] = useState(false);

  /**
   * Der Deeplink gewinnt beim Start – und zwar sofort.
   *
   * `settings` kommt aus `localStorage` und steht beim Hydrieren noch auf den
   * Standardwerten; `useAppPersistence` zieht die Stadt aus der URL erst danach
   * nach. Bis dahin gilt, was der Server gerendert hat: er hat `?city=` bereits
   * gelesen. Ohne diese Zeile zeigt ein Reload von `?city=glasgow` zuerst
   * München – und bleibt dort, wenn das Nachziehen ins Leere läuft.
   */
  const cityId = restored && settings.cityId ? settings.cityId : initialCityId;

  /* ------------------------------- Daten ------------------------------- */

  const range = useMemo(() => loadRange(anchor, coverage), [anchor, coverage]);
  // Die Zeiträume eines Blätterschritts vor und zurück liegen schon bereit,
  // bevor jemand wischt: der Wechsel wartet dann nicht aufs Netz.
  const prefetch = useMemo(
    () => [loadRange(addMonths(anchor, 1), coverage), loadRange(addMonths(anchor, -1), coverage)],
    [anchor, coverage],
  );
  const data = useEventData({ initialCityId, initialRange, initialData, cityId, range, prefetch });

  const savedEvents = useSavedEvents(cityId);
  const filters = useEventFilters({
    events: data.events,
    definitions: data.definitions,
    locale: settings.locale,
    term,
    isSaved: savedEvents.isSaved,
    minutesOfDay: format.minutesOfDay,
    timeOfDayStarts: settings.timeOfDayStarts,
  });
  const { events, onlySource, setQuery } = filters;

  /** Reihen im ungefilterten Bestand – wie lange etwas noch läuft, hängt nicht am Filter. */
  const runs = useMemo(() => seriesRuns(data.events), [data.events]);

  // Was an diesem Tag beginnt, dahinter Mehrtägiges, das an ihm noch läuft.
  const dayEvents = useMemo(() => eventsOnDay(events, selectedDay, format), [events, selectedDay, format]);
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
  );
  /**
   * Die übrigen Termine derselben Produktion, solange ein Termin offen ist –
   * Monat und Woche heben sie hervor. Ähnlich heisst hier: die Quelle selbst
   * führt sie als weitere Aufführungen, nicht bloss ein gleicher Titel.
   */
  const relatedIds = useMemo<ReadonlySet<string> | undefined>(
    () =>
      selectedEvent?.relatedPerformances?.length
        ? new Set(selectedEvent.relatedPerformances.map((performance) => performance.id))
        : undefined,
    [selectedEvent],
  );

  useAppPersistence({
    nav,
    cityId,
    initialCityId,
    layout,
    setLayout,
    restoreFilters: filters.restore,
    filterSpace: filters.space,
    selectedTitle: selectedEvent?.title,
  });

  /**
   * Was die Filter im angezeigten Zeitraum übrig lassen – für die Zeile der
   * aktiven Filter. Gezählt wird, was in diesem Zeitraum beginnt.
   */
  const filterSummary = useMemo(() => {
    const anchor = displayAnchor;
    const [from, to, label] =
      view === 'month'
        ? [`${anchor.slice(0, 7)}-01`, `${anchor.slice(0, 7)}-31`, t('inMonth', { month: format.monthName(anchor) })]
        : view === 'week'
          ? [
              startOfWeek(anchor),
              addDays(startOfWeek(anchor), 6),
              t('inRange', {
                from: format.dayNumeric(startOfWeek(anchor)),
                to: format.dayNumeric(addDays(startOfWeek(anchor), 6)),
              }),
            ]
          : [selectedDay, selectedDay, t('onDay', { day: format.dayNumeric(selectedDay) })];
    const count = events.filter((event) => {
      const day = format.localDay(event.start);
      return day >= from && day <= to;
    }).length;
    return `${count === 1 ? t('resultCountOne') : t('resultCount', { count })} ${label}`;
  }, [view, displayAnchor, selectedDay, events, format, t]);

  /**
   * Die Filter der Seite als Kalender-Abo (siehe `events/filter.ts`): wer
   * gerade nur Kino sieht, will vermutlich Kino abonnieren. Die Merkliste
   * nicht – sie lebt nur auf diesem Gerät.
   */
  const feedFilter = useMemo<FeedFilter>(
    () => ({
      sources: filters.sourcesFiltered ? [...filters.visible] : undefined,
      categories: filters.selectedCategories.size > 0 ? [...filters.selectedCategories] : undefined,
      ticketsOnly: filters.availableOnly,
      freeOnly: filters.freeOnly,
      timesOfDay: filters.timesOfDay,
      timeOfDayStarts: settings.timeOfDayStarts,
      query: filters.query,
    }),
    [
      filters.sourcesFiltered,
      filters.visible,
      filters.selectedCategories,
      filters.availableOnly,
      filters.freeOnly,
      filters.timesOfDay,
      settings.timeOfDayStarts,
      filters.query,
    ],
  );

  /**
   * Wann die rechte Spalte überhaupt etwas zu sagen hat.
   *
   * Tag und Woche zeigen die Termine des Tages schon im Kalender – die Spalte
   * daneben würde dieselbe Liste ein zweites Mal zeigen. Dort steht sie
   * deshalb nur für einen einzelnen Termin, sonst gar nicht. Monat und Karte
   * haben keine solche Liste; da bleibt sie die Tagesübersicht.
   */
  const detailShowsDay = view === 'month' || view === 'map';
  const detailAvailable = detailShowsDay || Boolean(selectedEvent);
  const detailOpen = detailAvailable && !layout.detailCollapsed;

  /* ------------------------------ Termine ------------------------------ */

  const openEvent = useCallback(
    (event: CalendarEvent) => {
      showEvent(event.id, event.start);
      setSheetOpen(true);
      revealDetail();
    },
    [showEvent, revealDetail],
  );

  /**
   * Der Weg, den ein Klick nimmt – und der einzige, der gezählt wird.
   * `stepEvent` blättert mit den Pfeiltasten durch dieselbe Liste; jeder
   * Tastendruck als geöffnete Veranstaltung wäre eine Zahl ohne Aussage.
   */
  const selectEvent = useCallback(
    (event: CalendarEvent) => {
      openEvent(event);
      track('event-open', { source: event.sourceId, category: event.category });
    },
    [openEvent],
  );

  const selectPerformance = useCallback(
    (performance: EventPerformance) => {
      const event = events.find((candidate) => candidate.id === performance.id);
      if (event) {
        selectEvent(event);
        return;
      }

      showEvent(performance.id, performance.start);
      setSheetOpen(true);
      revealDetail();

      // Weitere Termine gehören zur gerade gezeigten Veranstaltung, also auch
      // zu deren Quelle. Liegt keine vor, wird ohne die Angabe gezählt.
      track(
        'event-open',
        selectedEvent ? { source: selectedEvent.sourceId, category: selectedEvent.category } : undefined,
      );
    },
    [events, selectEvent, selectedEvent, showEvent, revealDetail],
  );

  /**
   * Die gefilterten Termine in Anzeigereihenfolge – die Kette, an der sich
   * Pfeil hoch und runter entlanghangeln, über Tagesgrenzen hinweg.
   */
  const ordered = useMemo(
    () =>
      [...events].sort(
        (a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, settings.locale),
      ),
    [events, settings.locale],
  );

  const stepEvent = useCallback(
    (direction: -1 | 1) => {
      if (ordered.length === 0) return;
      const index = ordered.findIndex((event) => event.id === selectedEventId);

      // Ohne Auswahl beim gewählten Tag einsteigen statt am Anfang des Zeitraums.
      if (index === -1) {
        const atDay = ordered.findIndex((event) => format.localDay(event.start) >= selectedDay);
        openEvent(ordered[atDay === -1 ? ordered.length - 1 : atDay]);
      } else {
        const next = index + direction;
        if (next < 0 || next >= ordered.length) return;
        // Auch mit der Tastatur nicht zurück hinter den frühesten Tag der Ansicht.
        if (format.localDay(ordered[next].start) < navRange.from) return;
        openEvent(ordered[next]);
      }
      setRevealSelection((current) => current + 1);
    },
    [ordered, selectedEventId, selectedDay, openEvent, format, navRange],
  );

  // Eine mit der Tastatur gewählte Veranstaltung muss auch zu sehen sein.
  useEffect(() => {
    if (!revealSelection || !selectedEventId) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector(`[data-event-id="${CSS.escape(selectedEventId)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealSelection, selectedEventId]);

  const eventShareUrl = useCallback(
    (event: CalendarEvent) => {
      const params = new URLSearchParams({
        city: cityId,
        view,
        date: clampDay(format.localDay(event.start), coverage),
        event: event.id,
      });
      return `?${params}`;
    },
    [cityId, view, format, coverage],
  );

  const eventLink = useCallback(
    (event: CalendarEvent) => new URL(eventShareUrl(event), window.location.href).toString(),
    [eventShareUrl],
  );

  // Die allgemeine Teilen-Aktion bleibt beim Stadtkalender. Ein offenes Event
  // gehört nur in den Link des Teilen-Knopfs in dessen Detailansicht.
  const websiteShareUrl = `/?city=${encodeURIComponent(cityId)}`;

  const showPerformances = useCallback(() => setRevealPerformances((current) => current + 1), []);
  const menu = useEventMenu({
    events,
    definitions: data.definitions,
    savedEvents,
    cityId,
    eventLink,
    onSelectEvent: selectEvent,
    onShowPerformances: showPerformances,
    onOnlySource: onlySource,
    onOnlyTitle: setQuery,
  });

  /* -------------------------- Tastatur und Suche -------------------------- */

  /** Suchfeld fokussieren – notfalls erst die Filterspalte dafür einblenden. */
  const focusSearch = useCallback(() => {
    const focus = () => {
      const input = [...document.querySelectorAll<HTMLInputElement>('[data-search-input]')]
        // Eine eingeklappte Spalte ist null Pixel breit; dort wird nicht gesucht.
        .find((candidate) => candidate.getBoundingClientRect().width > 0);
      input?.focus();
      input?.select();
      return !!input;
    };
    if (focus()) return;
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setLayout((current) => ({ ...current, sidebarCollapsed: false }));
      setTimeout(focus, MOTION_MS + 20);
    } else {
      // Auf dem Telefon klappt die Suche über dem Kalender auf.
      setSearchOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(focus));
    }
  }, []);

  /** Alles zumachen, was sich über etwas anderes gelegt hat. */
  const { close: closeMenu } = menu;
  const dismiss = useCallback(() => {
    closeMenu();
    setShortcutsOpen(false);
    setFiltersOpen(false);
    setSheetOpen(false);
  }, [closeMenu]);

  const toggleSidebar = () => setLayout((c) => ({ ...c, sidebarCollapsed: !c.sidebarCollapsed }));
  const toggleDetail = () => setLayout((c) => ({ ...c, detailCollapsed: !c.detailCollapsed }));

  useCalendarShortcuts({
    menuOpen: menu.open,
    shortcutsOpen,
    onEscape: () => {
      dismiss();
      setSelectedEventId(undefined);
    },
    onToggleSidebar: toggleSidebar,
    onToggleDetail: () => {
      // In Tag und Woche ohne gewählten Termin gibt es nichts aufzuklappen.
      if (detailAvailable) toggleDetail();
    },
    onStep: step,
    onStepEvent: stepEvent,
    onToday: goToday,
    onView: changeView,
    onOpenSelected: () => {
      if (selectedEvent) window.open(selectedEvent.url, '_blank', 'noopener,noreferrer');
    },
    onSaveSelected: () => {
      if (selectedEvent) savedEvents.toggle(selectedEvent);
    },
    onSearch: focusSearch,
    onToggleShortcuts: () => setShortcutsOpen((open) => !open),
  });

  /* ------------------------------- Anzeige ------------------------------ */

  const sidebar = (
    <Sidebar
      definitions={data.definitions}
      status={data.sources}
      selectedSources={filters.selectedSources}
      onToggleSourceGroup={filters.toggleSourceGroup}
      onToggleSource={filters.toggleSourceInGroup}
      onClearSources={() => filters.clearSources()}
      categories={filters.categories}
      selectedCategories={filters.selectedCategories}
      onToggleCategory={filters.toggleCategory}
      onClearCategories={() => filters.clearCategories()}
      availableOnly={filters.availableOnly}
      onAvailableOnlyChange={filters.setAvailableOnly}
      freeOnly={filters.freeOnly}
      onFreeOnlyChange={filters.setFreeOnly}
      savedOnly={filters.savedOnly}
      onSavedOnlyChange={filters.setSavedOnly}
      savedCount={filters.savedCount}
      timesOfDay={filters.timesOfDay}
      onToggleTimeOfDay={filters.toggleTimeOfDay}
      query={filters.query}
      onQueryChange={setQuery}
    />
  );

  /** Was jede Ansicht vom gewählten Tag und Termin wissen muss. */
  const selection = {
    events,
    definitions: data.definitions,
    selectedDay,
    selectedEventId,
    onSelectDay: selectDay,
    onSelectEvent: selectEvent,
  };

  // Solange die Stadt nicht feststeht, hat der Kalender nichts zu zeigen:
  // Kopfzeile, Quellen und Termine gehörten sonst zu einer geratenen Stadt.
  if (cityStatus === 'ask') return <CityIntroScreen />;

  return (
    <SeriesProvider runs={runs}>
      {/* Quer gehalten ragen Notch und Rundungen seitlich ins Bild; der Abstand
          ist am Schreibtisch null. */}
      <div
        className="flex h-full flex-col overflow-hidden bg-[var(--chrome)]"
        style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
        onContextMenu={menu.openMenu}
      >
        <Toolbar
          view={view}
          anchor={displayAnchor}
          cityId={cityId}
          shareUrl={websiteShareUrl}
          feedFilter={feedFilter}
          onCityChange={chooseCity}
          onViewChange={changeView}
          onStep={step}
          canStepBack={!restored || canStep(-1)}
          canStepForward={!restored || canStep(1)}
          onToday={goToday}
          onPickDay={goToDay}
          selectedDay={selectedDay}
          coverage={fromToday}
          // Der Zieh-Griff steht 1 px breit zwischen Spalte und Fläche; der
          // Rand der Fläche ist auf beiden Seiten gleich und hebt sich auf.
          leftInset={layout.sidebarCollapsed ? 0 : layout.sidebarWidth + 1}
          rightInset={detailOpen ? layout.detailWidth + 1 : 0}
          animateInsets={!resizing}
          onOpenFilters={() => setFiltersOpen(true)}
          onOpenSearch={focusSearch}
          activeFilterCount={filters.activeFilterCount}
          sidebarCollapsed={layout.sidebarCollapsed}
          detailCollapsed={!detailOpen}
          canToggleDetail={detailAvailable}
          onToggleSidebar={toggleSidebar}
          onToggleDetail={toggleDetail}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenNews={() => setNewsRequest((current) => current + 1)}
        />

        {/* Ab lg ist die Zeile ein Rahmen im Chrome-Ton, auf dem die
            Hauptfläche mit etwas Abstand schwebt. */}
        <div className="flex min-h-0 flex-1 lg:bg-[var(--chrome)]">
          {/* Filter – links, ab lg dauerhaft sichtbar und in der Breite verstellbar. */}
          <DesktopColumn
            side="left"
            open={!layout.sidebarCollapsed}
            width={layout.sidebarWidth}
            onWidthChange={(width) => setLayout((c) => ({ ...c, sidebarWidth: width }))}
            resizing={resizing}
            onResizingChange={setResizing}
            className="bg-[var(--chrome)]"
          >
            {sidebar}
          </DesktopColumn>

          {/* Kalender */}
          {/* Die Hauptfläche reicht bis an die untere Kante; Abstand zum
              Home-Indikator halten die Listen darin selbst (`pb-safe`). */}
          <main
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--canvas)]
                       lg:m-2 lg:rounded-[var(--radius-lg)] lg:border lg:border-line
                       lg:shadow-[var(--shadow-float)]"
          >
            {/* Mobile: die Suche steht über dem Kalender statt in den Filtern –
                aber erst auf Abruf über die Lupe, und solange sie etwas
                sucht. Die 12 px ringsum sind Platz für den Schein des
                Suchfelds – `main` beschneidet, was darüber hinausgeht. */}
            {(searchOpen || filters.query) && (
              <div className="shrink-0 px-3 py-3 hairline-b lg:hidden">
                <SearchField
                  query={filters.query}
                  onQueryChange={setQuery}
                  autoFocus={searchOpen && !filters.query}
                  onBlur={() => setSearchOpen(false)}
                />
              </div>
            )}

            <ActiveFilters filters={filters} definitions={data.definitions} summary={filterSummary} />

            {(view === 'day' || view === 'week') && (
              <HorizontalCalendar
                key={nav.focusKey}
                mode={view}
                anchor={anchor}
                {...selection}
                onStep={step}
                onPreview={previewStep}
                canStep={canStep}
                relatedIds={relatedIds}
              />
            )}

            {view === 'map' && (
              <>
                <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
                  <MapView
                    day={selectedDay}
                    events={dayEvents}
                    definitions={data.definitions}
                    cityId={cityId}
                    selectedEventId={selectedEventId}
                    onSelectEvent={selectEvent}
                  />
                </div>
                {/* Schmale Geräte bekommen die Karte (noch) nicht – dort ist
                    zu wenig Platz für Pins, Ortskarte und Spalten. Statt einer
                    gestauchten Karte lieber die Tagesliste. */}
                <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                  <HorizontalCalendar
                    key={nav.focusKey}
                    mode="day"
                    anchor={anchor}
                    {...selection}
                    onStep={step}
                    canStep={canStep}
                  />
                </div>
              </>
            )}

            {view === 'month' && (
              <>
                <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
                  <MonthScrollView
                    anchor={anchor}
                    {...selection}
                    onAnchorChange={nav.setAnchor}
                    coverage={fromToday}
                    focusKey={nav.focusKey}
                    relatedIds={relatedIds}
                  />
                </div>
                <MobileMonth
                  anchor={anchor}
                  {...selection}
                  dayEvents={dayEvents}
                  relatedIds={relatedIds}
                  onStep={step}
                  onPreview={previewStep}
                  canStep={canStep}
                />
              </>
            )}
          </main>

          {/* Details – rechts, mit derselben Bewegung wie die Filterspalte */}
          <DesktopColumn
            side="right"
            open={detailOpen}
            width={layout.detailWidth}
            min={260}
            max={520}
            onWidthChange={(width) => setLayout((c) => ({ ...c, detailWidth: width }))}
            resizing={resizing}
            onResizingChange={setResizing}
          >
            <DetailPanel
              day={selectedDay}
              dayEvents={dayEvents}
              event={selectedEvent}
              shareUrl={selectedEvent ? eventShareUrl(selectedEvent) : undefined}
              definitions={data.definitions}
              onSelectEvent={selectEvent}
              onSelectPerformance={selectPerformance}
              onBackToDay={() => setSelectedEventId(undefined)}
              revealPerformances={revealPerformances}
              cityId={cityId}
            />
          </DesktopColumn>
        </div>

        <MobileFilters
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          activeFilterCount={filters.activeFilterCount}
          onReset={filters.reset}
        >
          {sidebar}
        </MobileFilters>

        <MobileEventSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          event={selectedEvent}
          day={selectedDay}
          dayEvents={dayEvents}
          definitions={data.definitions}
          shareUrl={eventShareUrl}
          onSelectEvent={selectEvent}
          onSelectPerformance={selectPerformance}
          onBackToDay={() => {
            setSelectedEventId(undefined);
            setSheetOpen(false);
          }}
          revealPerformances={revealPerformances}
          cityId={cityId}
        />

        {menu.element}

        <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        {/* Neuigkeiten beim Start, sobald der Kalender steht (siehe `lib/announcements.ts`). */}
        <AnnouncementDialog enabled={restored} reopen={newsRequest} />
      </div>
    </SeriesProvider>
  );
}
