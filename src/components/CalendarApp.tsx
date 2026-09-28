'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AggregateResult, CalendarEvent, EventPerformance } from '@/lib/events/types';
import {
  type ViewMode,
  addDays,
  addMonths,
  clampDay,
  coverageRange,
  navigationFloor,
  navigationRange,
  isDayView,
  isSameMonth,
  loadRange,
} from '@/lib/calendar';

import { track } from '@/lib/analytics';
import { cityById, isKnownCityId } from '@/lib/cities';
import { sourceColor, sourceName } from '@/lib/events/display';
import { defaultLayout, readLayoutPrefs, saveLayoutPrefs, spacePrefs } from '@/lib/layoutPrefs';
import { useSettings } from '@/lib/settings/context';
import { useCalendarShortcuts } from '@/lib/useCalendarShortcuts';
import { useEventData } from '@/lib/useEventData';
import { useEventFilters } from '@/lib/useEventFilters';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import { AgendaList } from './AgendaList';
import { CityIntroScreen } from './CityIntroScreen';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { DetailPanel } from './DetailPanel';
import { HorizontalCalendar } from './HorizontalCalendar';
import { MonthScrollView } from './MonthScrollView';
import { MonthView } from './MonthView';
import { SearchField } from './SearchField';
import { ResizeHandle } from './ResizeHandle';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { Sidebar } from './Sidebar';
import { SwipePager } from './SwipePager';
import { Toolbar } from './Toolbar';
import { Calendar, Check, Close, External, Filter, Link as LinkIcon } from './icons';

/**
 * Die Karte bringt Leaflet und dessen Stilvorlage mit. Beides wird erst
 * geladen, wenn jemand die Ansicht zum ersten Mal öffnet – wer nur den
 * Kalender benutzt, lädt es nie.
 */
const MapView = dynamic(() => import('./MapView').then((module) => module.MapView), {
  ssr: false,
});

/** Dauer der Spalten- und Overlay-Bewegungen; identisch zu den Klassen unten. */
const MOTION_MS = 200;

interface Props {
  initialData: AggregateResult;
  initialRange: { from: string; to: string };
  initialCityId: string;
  initialAnchor: string;
}

/**
 * Womit die Seite aufgeht – und zwar jedes Mal gleich: die zuletzt benutzte
 * Ansicht wird bewusst nicht gemerkt. Wer die Seite öffnet, will zuerst
 * wissen, was läuft, nicht wo er zuletzt war. Ein Link mit `?view=` sticht das.
 *
 * Auf jedem Gerät ist das der Monat: er zeigt auf einen Blick, wann überhaupt
 * etwas los ist, und rechts steht, was am gewählten Tag läuft.
 */
const DEFAULT_VIEW: ViewMode = 'month';

export function CalendarApp({ initialData, initialRange, initialCityId, initialAnchor }: Props) {
  const { settings, cityStatus, chooseCity, format, t, term } = useSettings();

  const [view, setView] = useState<ViewMode>(DEFAULT_VIEW);
  const [anchor, setAnchor] = useState<string>(initialAnchor);
  const [selectedDay, setSelectedDay] = useState<string>(anchor);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  /** Erzwingt bei erneutem „Heute" ein Zentrieren, auch wenn das Datum gleich bleibt. */
  const [calendarFocusKey, setCalendarFocusKey] = useState(0);

  const [layout, setLayout] = useState(defaultLayout);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Offenes Kontextmenü samt Zeigerposition; `null` heisst geschlossen. */
  const [menu, setMenu] = useState<{ x: number; y: number; event: CalendarEvent } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  /** Während des Ziehens folgt die Spalte sofort statt animiert. */
  const [resizing, setResizing] = useState(false);
  /** Zähler: jede Erhöhung rollt die weiteren Termine im Detail ins Bild. */
  const [revealPerformances, setRevealPerformances] = useState(0);
  /** Zähler: jede Erhöhung holt die Auswahl in den sichtbaren Bereich. */
  const [revealSelection, setRevealSelection] = useState(0);

  /**
   * Erst wenn URL und Speicher gelesen sind, darf zurückgeschrieben werden.
   * Bewusst State und kein Ref: der Schreib-Effekt liefe sonst noch im selben
   * Durchlauf mit den Anfangswerten und würde den Deeplink überschreiben.
   */
  const [restored, setRestored] = useState(false);
  const [restoredSpaceCityId, setRestoredSpaceCityId] = useState<string>();

  /**
   * Der Deeplink gewinnt beim Start – und zwar sofort.
   *
   * `settings` kommt aus `localStorage` und steht beim Hydrieren noch auf den
   * Standardwerten; der Effekt unten zieht die Stadt aus der URL erst danach
   * nach. Bis dahin gilt, was der Server gerendert hat: er hat `?city=` bereits
   * gelesen. Ohne diese Zeile zeigt ein Reload von `?city=glasgow` zuerst
   * München – und bleibt dort, wenn das Nachziehen ins Leere läuft.
   */
  const cityId = restored && settings.cityId ? settings.cityId : initialCityId;

  /**
   * Der Server erhebt zwölf Monate im Voraus; weiter kommt der Kalender nicht.
   * Alles, was den Anker verschiebt, geht durch `clampDay`.
   */
  const coverageDay = restored ? format.today() : initialAnchor;
  const coverage = useMemo(() => coverageRange(coverageDay), [coverageDay]);
  /**
   * Wohin die gewählte Ansicht blättern darf: nie zurück hinter heute (Tag,
   * Karte), diese Woche (Woche) oder diesen Monat (Monat). Die Erhebung
   * beginnt am Monatsersten – was davor im Monat liegt, bleibt geladen, ist
   * aber kein Ziel mehr.
   */
  const navRange = useMemo(() => navigationRange(view, coverageDay, coverage), [view, coverageDay, coverage]);
  /**
   * Ab heute: der Tagesauswahl bietet keine vergangenen Tage an, und der
   * scrollende Monat am Schreibtisch beginnt mit dieser Woche.
   */
  const fromToday = useMemo(() => navigationRange('day', coverageDay, coverage), [coverageDay, coverage]);
  const range = useMemo(() => loadRange(anchor, coverage), [anchor, coverage]);

  const data = useEventData({ initialCityId, initialRange, initialData, cityId, range });
  const filters = useEventFilters({
    events: data.events,
    definitions: data.definitions,
    locale: settings.locale,
    term,
  });
  const { events, focusSources, setQuery, restore: restoreFilters, space: filterSpace } = filters;

  /* --------------------- Einstellungen und Deeplinks --------------------- */

  // Deeplink und gemerkte Einstellungen lassen sich erst nach der Hydration
  // lesen – der Server kennt weder URL-Parameter des Browsers noch localStorage.
  // Deshalb hier bewusst Zustand aus einem Effekt heraus setzen, genau einmal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const urlCity = params.get('city');
    const startupCityId = urlCity && isKnownCityId(urlCity) ? urlCity : (settings.cityId ?? initialCityId);
    const stored = readLayoutPrefs(startupCityId);
    const storedSpace = spacePrefs(stored, startupCityId);

    // Ein Deeplink ist eine Ansage; ohne ihn entscheidet die Breite des Geräts.
    const urlView = params.get('view');
    const startupView = isViewMode(urlView) ? urlView : DEFAULT_VIEW;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(startupView);
    // Die Karte bringt ihre Tagesübersicht mit – auch aus einem Deeplink heraus.
    setLayout(startupView === 'map' ? { ...stored, detailCollapsed: false } : stored);
    restoreFilters(storedSpace);
    setRestoredSpaceCityId(startupCityId);

    const urlDate = params.get('date');
    const wanted = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : format.today();
    // Auch ein alter Link führt nur in den Zeitraum, den der Server vorhält.
    const startDay = clampDay(
      wanted,
      navigationRange(startupView, format.today(), coverageRange(format.today())),
    );
    setAnchor(startDay);
    setSelectedDay(startDay);

    const urlEvent = params.get('event');
    if (urlEvent) setSelectedEventId(urlEvent);

    // Die Stadt aus der Adresse schreibt der SettingsProvider fest – hier zählt
    // sie nur für die Filter, die zu ihr gehören.
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

  // Der Stadtwechsel lädt die Seite nicht neu; der Titel im Tab muss deshalb
  // von Hand nachziehen, damit er dem entspricht, was der Server geliefert hat.
  useEffect(() => {
    if (!restored) return;
    document.title = `${cityById(cityId).name} ${t('appName')}`;
  }, [restored, cityId, t]);

  useEffect(() => {
    if (!restored) return;
    if (restoredSpaceCityId === cityId) return;

    const storedSpace = spacePrefs(readLayoutPrefs(cityId), cityId);
    restoreFilters(storedSpace);
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedEventId(undefined);
    setRestoredSpaceCityId(cityId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [restored, restoredSpaceCityId, cityId, restoreFilters]);

  useEffect(() => {
    if (!restored || restoredSpaceCityId !== cityId) return;
    saveLayoutPrefs(cityId, layout, filterSpace);
  }, [restored, restoredSpaceCityId, cityId, layout, filterSpace]);

  const dayEvents = useMemo(
    () => events.filter((event) => format.localDay(event.start) === selectedDay),
    [events, selectedDay, format],
  );
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
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

  /* ------------------------------ Aktionen ------------------------------ */

  /** Wohin ein Schritt führt – auf den abgedeckten Zeitraum begrenzt. */
  const steppedAnchor = useCallback(
    (current: string, direction: -1 | 1) => {
      const raw = isDayView(view)
        ? addDays(current, direction)
        : view === 'week'
          ? addDays(current, direction * 7)
          : addMonths(current, direction);
      return clampDay(raw, navRange);
    },
    [view, navRange],
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
      const amount = isDayView(view) ? direction : view === 'week' ? direction * 7 : 0;
      if (amount) setSelectedDay((current) => clampDay(addDays(current, amount), navRange));
    },
    [anchor, view, navRange, canStep, steppedAnchor],
  );

  /** Sprung auf einen Tag aus der Tagesauswahl oder auf heute. */
  const goToDay = useCallback(
    (day: string) => {
      const target = clampDay(day, navRange);
      setAnchor(target);
      setSelectedDay(target);
      setSelectedEventId(undefined);
      setCalendarFocusKey((current) => current + 1);
    },
    [navRange],
  );

  const goToday = useCallback(() => goToDay(format.today()), [goToDay, format]);

  const selectDay = useCallback(
    (day: string) => {
      const target = clampDay(day, navRange);
      setAnchor(target);
      setSelectedDay(target);
      setSelectedEventId(undefined);
      // Einen Tag anzuklicken ist die Frage, was an ihm läuft – die Antwort
      // steht rechts. In Tag und Woche gibt es dort nichts aufzuklappen, dann
      // bleibt das ohne Wirkung (siehe `detailAvailable`).
      setLayout((current) => ({ ...current, detailCollapsed: false }));
    },
    [navRange],
  );

  /**
   * Der Wechsel der Ansicht.
   *
   * Die Karte zeigt einen Tag als Orte und beantwortet damit nur die halbe
   * Frage – was dort läuft, steht in der Spalte daneben. Wer sie öffnet, soll
   * beides sehen, auch wenn die Spalte zuletzt zugeklappt war.
   *
   * Jede Ansicht hat ihren eigenen frühesten Tag: wer im Monat den Ersten
   * gewählt hat und in den Tag wechselt, landet heute statt in der
   * Vergangenheit.
   */
  const changeView = useCallback(
    (next: ViewMode) => {
      const floor = navigationFloor(next, coverageDay);
      setView(next);
      setAnchor((current) => (current < floor ? floor : current));
      setSelectedDay((current) => (current < floor ? floor : current));
      if (next === 'map') setLayout((current) => ({ ...current, detailCollapsed: false }));
    },
    [coverageDay],
  );

  const openEvent = useCallback(
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

      const day = clampDay(format.localDay(performance.start), coverage);
      setAnchor(day);
      setSelectedDay(day);
      setSelectedEventId(performance.id);
      setSheetOpen(true);
      setLayout((current) => ({ ...current, detailCollapsed: false }));

      // Weitere Termine gehören zur gerade gezeigten Veranstaltung, also auch
      // zu deren Quelle. Liegt keine vor, wird ohne die Angabe gezählt.
      track(
        'event-open',
        selectedEvent
          ? { source: selectedEvent.sourceId, category: selectedEvent.category }
          : undefined,
      );
    },
    [events, selectEvent, selectedEvent, format, coverage],
  );

  /* -------------------------- Tastatur und Menü -------------------------- */

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
    } else {
      setFiltersOpen(true);
    }
    setTimeout(focus, MOTION_MS + 20);
  }, []);

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

  const copyLink = useCallback(
    async (event: CalendarEvent) => {
      const url = eventLink(event);
      try {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        return;
      } catch {
        // Ohne Zwischenablage (unsicherer Kontext, verweigerte Freigabe) bleibt
        // das Teilen-Menü des Geräts.
      }
      try {
        await navigator.share?.({ url });
      } catch {
        // Abgebrochenes Teilen ist kein Fehler.
      }
    },
    [eventLink],
  );

  /** Alles zumachen, was sich über etwas anderes gelegt hat. */
  const dismiss = useCallback(() => {
    setMenu(null);
    setShortcutsOpen(false);
    setFiltersOpen(false);
    setSheetOpen(false);
  }, []);

  useCalendarShortcuts({
    menuOpen: Boolean(menu),
    shortcutsOpen,
    onEscape: () => {
      dismiss();
      setSelectedEventId(undefined);
      filters.clearFocus();
    },
    onToggleSidebar: () => setLayout((c) => ({ ...c, sidebarCollapsed: !c.sidebarCollapsed })),
    onToggleDetail: () => {
      // In Tag und Woche ohne gewählten Termin gibt es nichts aufzuklappen.
      if (detailAvailable) setLayout((c) => ({ ...c, detailCollapsed: !c.detailCollapsed }));
    },
    onStep: step,
    onStepEvent: stepEvent,
    onToday: goToday,
    onView: changeView,
    onOpenSelected: () => {
      if (selectedEvent) window.open(selectedEvent.url, '_blank', 'noopener,noreferrer');
    },
    onSearch: focusSearch,
    onToggleShortcuts: () => setShortcutsOpen((open) => !open),
  });

  /**
   * Ein einziger Zuhörer für alle Ansichten: das Menü hängt am Termin im DOM
   * (`data-event-id`), nicht an jeder Liste einzeln.
   */
  const openMenu = useCallback(
    (e: React.MouseEvent) => {
      const element = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-event-id]');
      const event = events.find((candidate) => candidate.id === element?.dataset.eventId);
      if (!element || !event) return;
      e.preventDefault();
      setLinkCopied(false);
      // Über die Tastatur ausgelöst liefern manche Browser keine Zeigerposition.
      const rect = element.getBoundingClientRect();
      const pointed = e.clientX !== 0 || e.clientY !== 0;
      setMenu({ x: pointed ? e.clientX : rect.left, y: pointed ? e.clientY : rect.bottom, event });
    },
    [events],
  );

  const menuItems = useMemo<MenuItem[]>(() => {
    const event = menu?.event;
    if (!event) return [];
    return [
      {
        key: 'link',
        label: linkCopied ? t('menuLinkCopied') : t('menuCopyLink'),
        icon: linkCopied ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />,
        keepOpen: true,
        onSelect: () => void copyLink(event),
      },
      {
        key: 'site',
        label: t('toEvent'),
        icon: <External className="h-3.5 w-3.5" />,
        onSelect: () => window.open(event.url, '_blank', 'noopener,noreferrer'),
      },
      {
        key: 'related',
        label: t('menuRelated'),
        icon: <Calendar className="h-3.5 w-3.5" />,
        disabled: !event.relatedPerformances?.length,
        onSelect: () => {
          selectEvent(event);
          setRevealPerformances((current) => current + 1);
        },
      },
      {
        key: 'source',
        label: t('menuOnlySource', { name: sourceName(data.definitions, event.sourceId) }),
        icon: (
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: sourceColor(data.definitions, event.sourceId) }}
          />
        ),
        onSelect: () => focusSources([event.sourceId], 'menu'),
      },
      {
        key: 'title',
        label: t('menuOnlyTitle'),
        icon: <Filter className="h-3.5 w-3.5" />,
        onSelect: () => setQuery(event.title),
      },
    ];
  }, [menu, linkCopied, copyLink, selectEvent, focusSources, setQuery, data.definitions, t]);

  /* ------------------------------- Anzeige ------------------------------ */

  const filterOverlay = useOverlayTransition(filtersOpen, MOTION_MS);
  const sheet = useOverlayTransition(sheetOpen && !!selectedEvent, MOTION_MS);
  // Beim Zumachen darf die Auswahl schon weg sein – das Sheet zeigt trotzdem
  // bis zum Ende der Bewegung, was zuletzt darin stand.
  const [sheetEvent, setSheetEvent] = useState<CalendarEvent>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedEvent) setSheetEvent(selectedEvent);
  }, [selectedEvent]);

  /** Gleiche Kurve für alle Spalten- und Overlay-Bewegungen. */
  const motion = 'duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]';

  const sidebar = (
    <Sidebar
      definitions={data.definitions}
      status={data.sources}
      enabled={filters.enabled}
      onToggleSource={filters.toggleSource}
      onToggleGroup={filters.toggleGroup}
      solo={filters.solo}
      onSolo={(ids) => focusSources(ids, 'sidebar')}
      categories={filters.categories}
      enabledCategories={filters.enabledCategories}
      onToggleCategory={filters.toggleCategory}
      categorySolo={filters.categorySolo}
      onCategorySolo={filters.focusCategory}
      onShowAllCategories={filters.showAllCategories}
      availableOnly={filters.availableOnly}
      onAvailableOnlyChange={filters.setAvailableOnly}
      freeOnly={filters.freeOnly}
      onFreeOnlyChange={filters.setFreeOnly}
      query={filters.query}
      onQueryChange={setQuery}
    />
  );

  // Solange die Stadt nicht feststeht, hat der Kalender nichts zu zeigen:
  // Kopfzeile, Quellen und Termine gehörten sonst zu einer geratenen Stadt.
  if (cityStatus === 'ask') return <CityIntroScreen />;

  return (
    <div className="flex h-full flex-col overflow-hidden" onContextMenu={openMenu}>
        <Toolbar
          view={view}
          anchor={anchor}
          cityId={cityId}
          shareUrl={websiteShareUrl}
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
          activeFilterCount={filters.activeFilterCount}
          sidebarCollapsed={layout.sidebarCollapsed}
          detailCollapsed={!detailOpen}
          canToggleDetail={detailAvailable}
          onToggleSidebar={() =>
            setLayout((c) => ({ ...c, sidebarCollapsed: !c.sidebarCollapsed }))
          }
          onToggleDetail={() => setLayout((c) => ({ ...c, detailCollapsed: !c.detailCollapsed }))}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />

        {/* Ab lg ist die Zeile ein Rahmen im Chrome-Ton, auf dem die
            Hauptfläche mit etwas Abstand schwebt. */}
        <div className="flex min-h-0 flex-1 lg:bg-[var(--chrome)]">
          {/* Filter – links, ab lg dauerhaft sichtbar und in der Breite verstellbar.
              Zum Einklappen läuft die Breite auf null; der Inhalt behält seine
              eigene und wird beschnitten, statt sich dabei zu stauchen. */}
          <aside
            className={`hidden min-h-0 shrink-0 overflow-hidden bg-[var(--chrome)] lg:block
                        ${resizing ? '' : `transition-[width] ${motion}`}`}
            style={{ width: layout.sidebarCollapsed ? 0 : layout.sidebarWidth }}
            inert={layout.sidebarCollapsed}
          >
            <div className="h-full" style={{ width: layout.sidebarWidth }}>
              {sidebar}
            </div>
          </aside>
          {!layout.sidebarCollapsed && (
            <ResizeHandle
              side="left"
              className="hidden lg:block"
              width={layout.sidebarWidth}
              onChange={(width) => setLayout((c) => ({ ...c, sidebarWidth: width }))}
              onDragChange={setResizing}
            />
          )}

          {/* Kalender */}
          {/* Ohne Fussleiste hält die Hauptfläche selbst Abstand zum Home-Indikator. */}
          <main
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--canvas)]
                       lg:m-2 lg:rounded-[var(--radius-lg)] lg:border lg:border-line
                       lg:shadow-[var(--shadow-float)]"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Mobile: die Suche steht über dem Kalender statt in den Filtern.
                Die 12 px ringsum sind Platz für den Schein des Suchfelds –
                `main` beschneidet, was darüber hinausgeht. */}
            <div className="shrink-0 px-3 py-3 hairline-b lg:hidden">
              <SearchField query={filters.query} onQueryChange={setQuery} />
            </div>

            {(view === 'day' || view === 'week') && (
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
                    key={calendarFocusKey}
                    mode="day"
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
                </div>
              </>
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
                  coverage={fromToday}
                  focusKey={calendarFocusKey}
                />
              </div>
            )}

            {/* Mobile */}
            {view === 'month' && (
              <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                {/* Wischen blättert den Monat – wie in Tages- und Wochenansicht. */}
                <SwipePager
                  anchor={anchor}
                  pageAnchor={(offset) => addMonths(anchor, offset)}
                  onStep={step}
                  canStep={canStep}
                  label={t('month')}
                  className="flex h-[288px] shrink-0 scroll-hidden hairline-b"
                >
                  {(pageAnchor) => (
                    <MonthView
                      compact
                      anchor={pageAnchor}
                      events={events}
                      definitions={data.definitions}
                      selectedDay={selectedDay}
                      selectedEventId={selectedEventId}
                      onSelectDay={selectDay}
                      onSelectEvent={selectEvent}
                    />
                  )}
                </SwipePager>
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

          {/* Details – rechts, mit derselben Bewegung wie die Filterspalte */}
          {detailOpen && (
            <ResizeHandle
              side="right"
              className="hidden lg:block"
              width={layout.detailWidth}
              min={260}
              max={520}
              onChange={(width) => setLayout((c) => ({ ...c, detailWidth: width }))}
              onDragChange={setResizing}
            />
          )}
          <aside
            className={`hidden min-h-0 shrink-0 overflow-hidden lg:block
                        ${resizing ? '' : `transition-[width] ${motion}`}`}
            style={{ width: detailOpen ? layout.detailWidth : 0 }}
            inert={!detailOpen}
          >
            <div className="h-full" style={{ width: layout.detailWidth }}>
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
              />
            </div>
          </aside>
        </div>

      {/* Mobile: Filter als Overlay, das von links hereinfährt */}
      {filterOverlay.mounted && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('closeFilters')}
            onClick={() => setFiltersOpen(false)}
            className={`absolute inset-0 transition-opacity ${motion}
                        ${filterOverlay.shown ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'var(--overlay)' }}
          />
          <div
            className={`absolute inset-y-0 left-0 flex w-[88%] max-w-[360px] flex-col bg-[var(--chrome)]
                        transition-transform ${motion}
                        ${filterOverlay.shown ? 'translate-x-0' : '-translate-x-full'}`}
            style={{ boxShadow: 'var(--shadow-overlay)' }}
          >
            <div className="flex h-14 shrink-0 items-center gap-2 px-3 pl-4 hairline-b">
              <span className="text-[15px] font-semibold">{t('filters')}</span>
              {filters.activeFilterCount > 0 && (
                <span
                  className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent-soft)]
                             px-1.5 text-[11px] font-medium tabular-nums text-accent"
                >
                  {filters.activeFilterCount}
                </span>
              )}
              {/* Ein Weg zurück auf den unberührten Bestand – auf dem Finger
                  ist das Einsammeln einzelner Filter sonst mühsam. */}
              {filters.activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={filters.reset}
                  className="ml-auto rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] text-muted
                             hover:bg-[var(--canvas)] hover:text-text"
                >
                  {t('resetFilters')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label={t('close')}
                className={`grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-muted
                            hover:bg-[var(--canvas)] hover:text-text
                            ${filters.activeFilterCount > 0 ? '' : 'ml-auto'}`}
              >
                <Close />
              </button>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </div>
        </div>
      )}

      {/* Mobile: Detail als Sheet, das von unten aufsteigt */}
      {sheet.mounted && sheetEvent && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setSheetOpen(false)}
            className={`absolute inset-0 transition-opacity ${motion}
                        ${sheet.shown ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'var(--overlay)' }}
          />
          <div
            className={`absolute inset-x-0 bottom-0 flex flex-col overflow-hidden
                        rounded-t-[var(--radius-sheet)] bg-[var(--chrome)]
                        transition-transform ${motion}
                        ${sheet.shown ? 'translate-y-0' : 'translate-y-full'}`}
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
                event={sheetEvent}
                shareUrl={eventShareUrl(sheetEvent)}
                definitions={data.definitions}
                onSelectEvent={selectEvent}
                onSelectPerformance={selectPerformance}
                onBackToDay={() => {
                  setSelectedEventId(undefined);
                  setSheetOpen(false);
                }}
                onClose={() => setSheetOpen(false)}
                revealPerformances={revealPerformances}
              />
            </div>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          label={t('eventOptions')}
          onClose={() => setMenu(null)}
        />
      )}

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'day' || value === 'week' || value === 'month' || value === 'map';
}
