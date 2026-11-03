'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  startOfWeek,
} from '@/lib/calendar';

import { track } from '@/lib/analytics';
import { cityById, isKnownCityId } from '@/lib/cities';
import { pageTitle } from '@/lib/site';
import { eventsOnDay, sourceColor, sourceName } from '@/lib/events/display';
import type { FeedFilter } from '@/lib/events/filter';
import { seriesRuns } from '@/lib/events/series';
import { SeriesProvider } from '@/lib/series-context';
import { defaultLayout, readLayoutPrefs, saveLayoutPrefs, spacePrefs } from '@/lib/layoutPrefs';
import { useSavedEvents } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { useCalendarShortcuts } from '@/lib/useCalendarShortcuts';
import { useEventData } from '@/lib/useEventData';
import { useEventFilters } from '@/lib/useEventFilters';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import { ActiveFilters } from './ActiveFilters';
import { DayAgenda } from './AgendaList';
import { CityIntroScreen } from './CityIntroScreen';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { saveChoices } from './SaveButton';
import { DetailPanel } from './DetailPanel';
import { HorizontalCalendar } from './HorizontalCalendar';
import { MonthScrollView } from './MonthScrollView';
import { COMPACT_HEAD, COMPACT_ROW, MonthView, monthWeeks } from './MonthView';
import { SearchField } from './SearchField';
import { ResizeHandle } from './ResizeHandle';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { Sidebar } from './Sidebar';
import { BottomSheet } from './BottomSheet';
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

/** So weit (px) scrollt die Tagesliste, bevor der Monat auf die Woche einklappt. */
const COLLAPSE_AFTER = 24;

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
  /** Mobil: die Suche ist aufgeklappt (mit Inhalt bleibt sie es ohnehin). */
  const [searchOpen, setSearchOpen] = useState(false);
  /** Mobil: der Monat ist auf die Woche des gewählten Tages eingeklappt. */
  const [monthCollapsed, setMonthCollapsed] = useState(false);

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
  // Die Zeiträume eines Blätterschritts vor und zurück liegen schon bereit,
  // bevor jemand wischt: der Wechsel wartet dann nicht aufs Netz.
  const prefetch = useMemo(
    () => [loadRange(addMonths(anchor, 1), coverage), loadRange(addMonths(anchor, -1), coverage)],
    [anchor, coverage],
  );

  const data = useEventData({ initialCityId, initialRange, initialData, cityId, range, prefetch });

  /**
   * Wohin ein laufendes Wischen führt, noch bevor die Seite eingerastet ist.
   * Titel und Zähler folgen ihm sofort; der Anker selbst wechselt erst mit
   * `step`, wenn der Pager zur Ruhe gekommen ist.
   */
  const [previewAnchor, setPreviewAnchor] = useState<string | null>(null);
  const displayAnchor = previewAnchor ?? anchor;
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
  const { events, onlySource, setQuery, restore: restoreFilters, space: filterSpace } = filters;

  /** Reihen im ungefilterten Bestand – wie lange etwas noch läuft, hängt nicht am Filter. */
  const runs = useMemo(() => seriesRuns(data.events), [data.events]);

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

  /* --------------------- Einstellungen und Deeplinks --------------------- */

  // Deeplink und gemerkte Einstellungen lassen sich erst nach der Hydration
  // lesen – der Server kennt weder URL-Parameter des Browsers noch localStorage.
  // Deshalb hier bewusst Zustand aus einem Effekt heraus setzen, genau einmal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const urlCity = params.get('city');
    const startupCityId = urlCity && isKnownCityId(urlCity) ? urlCity : (settings.cityId ?? initialCityId);
    const stored = readLayoutPrefs();
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
  // von Hand nachziehen – in derselben Form, die der Server liefert
  // (`pageTitle`): ein offener Termin vorn, sonst die Stadt.
  const selectedTitle = events.find((event) => event.id === selectedEventId)?.title;
  useEffect(() => {
    if (!restored) return;
    document.title = pageTitle(selectedTitle ?? t('tabCity', { city: cityById(cityId).name }));
  }, [restored, cityId, selectedTitle, t]);

  useEffect(() => {
    if (!restored) return;
    if (restoredSpaceCityId === cityId) return;

    const storedSpace = spacePrefs(readLayoutPrefs(), cityId);
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

  // Was an diesem Tag beginnt, dahinter Mehrtägiges, das an ihm noch läuft.
  const dayEvents = useMemo(
    () => eventsOnDay(events, selectedDay, format),
    [events, selectedDay, format],
  );
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
      setPreviewAnchor(null);
      const amount = isDayView(view) ? direction : view === 'week' ? direction * 7 : 0;
      if (amount) setSelectedDay((current) => clampDay(addDays(current, amount), navRange));
    },
    [anchor, view, navRange, canStep, steppedAnchor],
  );

  /** Vom Pager: die Seite in diese Richtung ist schon mehr als halb im Bild. */
  const previewStep = useCallback(
    (direction: -1 | 0 | 1) => {
      setPreviewAnchor(direction && canStep(direction) ? steppedAnchor(anchor, direction) : null);
    },
    [anchor, canStep, steppedAnchor],
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

  /**
   * Unterhalb von `lg` gibt es keinen Umschalter: die Haltung des Geräts
   * wählt die Ansicht. Hochkant der Monat mit der Tagesliste darunter, quer
   * die Woche als Raster wie am Schreibtisch. Auch ein Deeplink mit anderer
   * Ansicht landet so in der passenden.
   */
  const compact = useMediaQuery('(max-width: 63.999rem)');
  const landscape = useMediaQuery('(orientation: landscape)');
  useEffect(() => {
    if (!restored || !compact) return;
    const wanted: ViewMode = landscape ? 'week' : 'month';
    // Folgt einer äusseren Grösse (der Media Query), wie die Effekte oben.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view !== wanted) changeView(wanted);
  }, [restored, compact, landscape, view, changeView]);

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
      setTimeout(focus, MOTION_MS + 20);
    } else {
      // Auf dem Telefon klappt die Suche über dem Kalender auf.
      setSearchOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(focus));
    }
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
    onSaveSelected: () => {
      if (selectedEvent) savedEvents.toggle(selectedEvent);
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
      ...saveChoices(event, savedEvents, t, cityId),
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
        onSelect: () => onlySource(event.sourceId),
      },
      {
        key: 'title',
        label: t('menuOnlyTitle'),
        icon: <Filter className="h-3.5 w-3.5" />,
        onSelect: () => setQuery(event.title),
      },
    ];
  }, [menu, linkCopied, copyLink, selectEvent, onlySource, setQuery, data.definitions, savedEvents, cityId, t]);

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

  /**
   * Mobil: Scrollt die Tagesliste nach unten, klappt der Monat auf die Woche
   * ein; ganz oben angekommen, wieder auf. Eingeklappt wird nur, wenn die
   * Liste danach noch scrollen kann – sonst stünde sie gleich wieder oben,
   * und der Monat spränge hin und her.
   */
  const agendaScroller = useRef<HTMLDivElement>(null);
  /** Wochen des angezeigten Monats – vier bis sechs, je nachdem wie er fällt. */
  const monthRows = useMemo(() => monthWeeks(anchor).length, [anchor]);
  const onAgendaScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    if (monthCollapsed) {
      if (element.scrollTop <= 0) setMonthCollapsed(false);
      return;
    }
    const room = element.scrollHeight - element.clientHeight;
    if (element.scrollTop > COLLAPSE_AFTER && room > (monthRows - 1) * COMPACT_ROW + COLLAPSE_AFTER) setMonthCollapsed(true);
  };

  /**
   * Mobil: der Griff unter dem Monat lässt sich ziehen, wie der des Sheets.
   * Nach oben klappt der Monat auf die Woche ein, nach unten wieder auf; das
   * Raster folgt dabei dem Finger (`gripProgress`, 0 = Monat, 1 = Woche).
   * Losgelassen rastet es ein: mit dem Schwung des Fingers, sonst nach der
   * halben Strecke. Ein Tippen schaltet wie bisher um.
   */
  const [gripProgress, setGripProgress] = useState<number | null>(null);
  const grip = useRef({ startY: 0, start: 0, lastY: 0, lastTime: 0, velocity: 0, dragging: false });
  const collapseRange = (monthRows - 1) * COMPACT_ROW;

  const onGripStart = (e: React.TouchEvent) => {
    const y = e.touches[0].clientY;
    grip.current = {
      startY: y,
      start: monthCollapsed ? 1 : 0,
      lastY: y,
      lastTime: e.timeStamp,
      velocity: 0,
      dragging: false,
    };
  };

  const onGripMove = (e: React.TouchEvent) => {
    const g = grip.current;
    const y = e.touches[0].clientY;
    if (!g.dragging && Math.abs(y - g.startY) < 4) return;
    g.dragging = true;
    const elapsed = e.timeStamp - g.lastTime;
    if (elapsed > 0) g.velocity = 0.7 * ((y - g.lastY) / elapsed) + 0.3 * g.velocity;
    g.lastY = y;
    g.lastTime = e.timeStamp;
    setGripProgress(Math.min(1, Math.max(0, g.start - (y - g.startY) / collapseRange)));
  };

  const onGripEnd = (e: React.TouchEvent) => {
    const g = grip.current;
    if (!g.dragging) return;
    // Kein Klick hinterher, der würde gleich wieder umschalten.
    e.preventDefault();
    g.dragging = false;
    const velocity = e.timeStamp - g.lastTime > 80 ? 0 : g.velocity;
    const progress = gripProgress ?? g.start;
    const collapse = velocity < -0.3 ? true : velocity > 0.3 ? false : progress > 0.5;
    setMonthCollapsed(collapse);
    setGripProgress(null);
    if (!collapse) agendaScroller.current?.scrollTo({ top: 0 });
  };

  /** Wie weit der Monat gerade eingeklappt ist, gezogen oder eingerastet. */
  const collapseProgress = gripProgress ?? (monthCollapsed ? 1 : 0);

  // Ein anderer Monat bringt das ganze Raster zurück – seine Woche wäre sonst geraten.
  const anchorMonth = anchor.slice(0, 7);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonthCollapsed(false);
  }, [anchorMonth]);

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
      onContextMenu={openMenu}
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
                  relatedIds={relatedIds}
                />
              </div>
            )}

            {/* Mobile */}
            {view === 'month' && (
              <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                {/* Wischen blättert den Monat – wie in Tages- und Wochenansicht.
                    Wer die Liste darunter liest, braucht vom Monat nur noch
                    die Woche: das Raster klappt beim Scrollen auf sie ein. */}
                <div
                  // Während des Ziehens folgt die Höhe dem Finger ohne Übergang.
                  className={`shrink-0 overflow-hidden ${gripProgress === null ? `${motion} transition-[height]` : ''}`}
                  style={{ height: COMPACT_HEAD + (monthRows - collapseProgress * (monthRows - 1)) * COMPACT_ROW }}
                >
                  <SwipePager
                    anchor={anchor}
                    pageAnchor={(offset) => addMonths(anchor, offset)}
                    onStep={step}
                    onPreview={previewStep}
                    // Eingeklappt gehört die Geste der Woche, nicht dem Monat.
                    canStep={monthCollapsed ? () => false : canStep}
                    label={t('month')}
                    className="flex h-full scroll-hidden"
                  >
                    {(pageAnchor) => (
                      <MonthView
                        compact
                        collapsed={monthCollapsed}
                        collapseProgress={gripProgress ?? undefined}
                        anchor={pageAnchor}
                        events={events}
                        definitions={data.definitions}
                        selectedDay={selectedDay}
                        selectedEventId={selectedEventId}
                        onSelectDay={selectDay}
                        onSelectEvent={selectEvent}
                        relatedIds={relatedIds}
                      />
                    )}
                  </SwipePager>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMonthCollapsed((collapsed) => !collapsed);
                    if (monthCollapsed) agendaScroller.current?.scrollTo({ top: 0 });
                  }}
                  onTouchStart={onGripStart}
                  onTouchMove={onGripMove}
                  onTouchEnd={onGripEnd}
                  onTouchCancel={onGripEnd}
                  aria-label={monthCollapsed ? t('monthExpand') : t('monthCollapse')}
                  aria-expanded={!monthCollapsed}
                  // Gut zu treffen wie der Griff des Sheets: ein breiter
                  // Streifen, sichtbar nur als Linie. `touch-none`, damit der
                  // Browser die Geste nicht selbst als Bildlauf nimmt.
                  className="grid h-6 shrink-0 touch-none place-items-center hairline-b"
                >
                  <span className="h-[5px] w-10 rounded-full bg-[var(--line-strong)]" />
                </button>
                <div
                  ref={agendaScroller}
                  onScroll={onAgendaScroll}
                  className="min-h-0 flex-1 overflow-y-auto scroll-quiet pb-safe"
                >
                  <DayAgenda
                    events={dayEvents}
                    definitions={data.definitions}
                    selectedId={selectedEventId}
                    onSelect={selectEvent}
                    emptyLabel={t('noEventsDay')}
                    day={selectedDay}
                    relatedIds={relatedIds}
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
                cityId={cityId}
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
        <BottomSheet shown={sheet.shown} onClose={() => setSheetOpen(false)} closeLabel={t('close')}>
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
            inSheet
            revealPerformances={revealPerformances}
            cityId={cityId}
          />
        </BottomSheet>
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
    </SeriesProvider>
  );
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'day' || value === 'week' || value === 'month' || value === 'map';
}
