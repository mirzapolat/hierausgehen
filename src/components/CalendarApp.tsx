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
  isDayView,
  isSameMonth,
  loadRange,
} from '@/lib/calendar';

import { DETAIL_KEY, SIDEBAR_KEY, matchesKey } from '@/lib/keyboard';
import { cityById, isKnownCityId } from '@/lib/cities';
import { sourceColor, sourceName } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
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

const LAYOUT_STORAGE_KEY = 'hierausgehen.layout.v1';

interface CitySpacePrefs {
  disabledSources: string[];
  availableOnly: boolean;
  disabledCategories: string[];
}

interface LayoutPrefs {
  sidebarWidth: number;
  detailWidth: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  /** Dauerhafte Filter pro Stadt-Space. */
  spaces: Record<string, CitySpacePrefs>;
}

const defaultSpacePrefs: CitySpacePrefs = {
  disabledSources: [],
  availableOnly: false,
  disabledCategories: [],
};

/**
 * Womit die Seite aufgeht – und zwar jedes Mal gleich: die zuletzt benutzte
 * Ansicht wird bewusst nicht gemerkt. Wer die Seite öffnet, will zuerst
 * wissen, was läuft, nicht wo er zuletzt war. Ein Link mit `?view=` sticht das.
 *
 * Am Schreibtisch ist das die Woche: dort ist Platz für sieben Spalten mit
 * Titeln. Auf dem Telefon der Monat, weil eine Woche dort auf sieben schmale
 * Streifen zusammenfällt. Die Breite kennt erst der Browser, deshalb steht
 * beim Rendern auf dem Server der Monat und die Woche kommt nach der
 * Hydration – wie Stadt, Datum und Filter auch.
 */
const SSR_VIEW: ViewMode = 'month';
const DESKTOP_QUERY = '(min-width: 1024px)';

function defaultView(): ViewMode {
  return window.matchMedia(DESKTOP_QUERY).matches ? 'week' : 'month';
}

const defaultLayout: LayoutPrefs = {
  sidebarWidth: 228,
  detailWidth: 336,
  sidebarCollapsed: false,
  detailCollapsed: false,
  spaces: {},
};

/** Solange die Daten einer anderen Stadt gehören, zeigt der Kalender nichts. */
const emptyResult: AggregateResult = { events: [], sources: [], definitions: [] };

export function CalendarApp({ initialData, initialRange, initialCityId, initialAnchor }: Props) {
  const { settings, cityStatus, chooseCity, format, t, term } = useSettings();

  const [view, setView] = useState<ViewMode>(SSR_VIEW);
  const [anchor, setAnchor] = useState<string>(initialAnchor);
  const [selectedDay, setSelectedDay] = useState<string>(anchor);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  /** Erzwingt bei erneutem „Heute" ein Zentrieren, auch wenn das Datum gleich bleibt. */
  const [calendarFocusKey, setCalendarFocusKey] = useState(0);

  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [availableOnly, setAvailableOnly] = useState(false);
  /** Quellenfokus ist absichtlich flüchtig: er überlebt kein Neuladen. */
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [disabledCategories, setDisabledCategories] = useState<Set<string>>(new Set());
  /** Fokus für Veranstaltungsarten – wie der Quellenfokus bewusst flüchtig. */
  const [categorySolo, setCategorySolo] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState(defaultLayout);

  /**
   * Der Datenstand trägt seine Stadt mit sich. Nur so zeigen Kopfzeile,
   * Quellenliste und Kalender zwangsläufig dieselbe Stadt: bis die Daten der
   * neuen Stadt da sind, gilt der Kalender als leer, statt kurz die Quellen der
   * alten Stadt unter dem neuen Namen zu zeigen.
   */
  const [loaded, setLoaded] = useState({ cityId: initialCityId, result: initialData });
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

  const cache = useRef(new Map<string, AggregateResult>([[key(initialCityId, initialRange), initialData]]));
  /** Zuletzt angeforderter Datenstand – ältere Antworten laufen ins Leere. */
  const wanted = useRef(key(initialCityId, initialRange));
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
  const data = loaded.cityId === cityId ? loaded.result : emptyResult;

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
    const startupView = isViewMode(urlView) ? urlView : defaultView();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(startupView);
    // Die Karte bringt ihre Tagesübersicht mit – auch aus einem Deeplink heraus.
    setLayout(startupView === 'map' ? { ...stored, detailCollapsed: false } : stored);
    setDisabled(new Set(storedSpace.disabledSources));
    setAvailableOnly(storedSpace.availableOnly);
    setDisabledCategories(new Set(storedSpace.disabledCategories));
    setRestoredSpaceCityId(startupCityId);

    const urlDate = params.get('date');
    const wanted = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : format.today();
    // Auch ein alter Link führt nur in den Zeitraum, den der Server vorhält.
    const startDay = clampDay(wanted, coverageRange(format.today()));
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
    /* eslint-disable react-hooks/set-state-in-effect */
    setDisabled(new Set(storedSpace.disabledSources));
    setAvailableOnly(storedSpace.availableOnly);
    setDisabledCategories(new Set(storedSpace.disabledCategories));
    setSolo(new Set());
    setCategorySolo(new Set());
    setSelectedEventId(undefined);
    setRestoredSpaceCityId(cityId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [restored, restoredSpaceCityId, cityId]);

  useEffect(() => {
    if (!restored || restoredSpaceCityId !== cityId) return;
    try {
      const current = readLayoutPrefs(cityId);
      const prefs: LayoutPrefs = {
        ...current,
        ...layout,
        spaces: {
          ...current.spaces,
          ...layout.spaces,
          [cityId]: {
            disabledSources: [...disabled],
            availableOnly,
            disabledCategories: [...disabledCategories],
          },
        },
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Privater Modus – nicht kritisch.
    }
  }, [restored, restoredSpaceCityId, cityId, layout, disabled, availableOnly, disabledCategories]);

  /* ------------------------------- Laden -------------------------------- */

  /**
   * Der Server erhebt zwölf Monate im Voraus; weiter kommt der Kalender nicht.
   * Alles, was den Anker verschiebt, geht durch `clampDay`.
   */
  const coverageDay = restored ? format.today() : initialAnchor;
  const coverage = useMemo(() => coverageRange(coverageDay), [coverageDay]);

  const range = useMemo(() => loadRange(anchor, coverage), [anchor, coverage]);

  const load = useCallback(
    async (target: { from: string; to: string }, city: string) => {
      const cacheKey = key(city, target);
      wanted.current = cacheKey;
      if (cache.current.has(cacheKey)) {
        setLoaded({ cityId: city, result: cache.current.get(cacheKey)! });
        return;
      }
      try {
        const params = new URLSearchParams({ from: target.from, to: target.to, city });
        const res = await fetch(`/api/events?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as AggregateResult;
        cache.current.set(cacheKey, next);
        // Eine Antwort, die zu spät kommt, gehört nicht mehr auf den Schirm.
        if (wanted.current === cacheKey) setLoaded({ cityId: city, result: next });
      } catch (error) {
        console.error('[calendar] Laden fehlgeschlagen', error);
      }
    },
    [],
  );

  useEffect(() => {
    void load(range, cityId);
  }, [range, cityId, load]);

  /* ------------------------------ Filtern ------------------------------- */

  // Quellenfokus hat Vorrang vor der dauerhaften Auswahl, verändert sie aber nicht.
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
      // Bei gleicher Anzahl alphabetisch nach dem angezeigten Namen.
      .sort((a, b) => b.count - a.count || term(a.name).localeCompare(term(b.name), settings.locale));
  }, [data.events, visibleSources, settings.locale, term]);

  // Kategorienfokus hat Vorrang vor der Pillen-Auswahl, verändert sie aber nicht.
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
      // Auch der Wortlaut der Quelle ist durchsuchbar: wer "Live Music" tippt,
      // soll das Konzert finden, das im Kalender "Konzert" heisst.
      return [
        event.title,
        event.subtitle,
        event.description,
        event.venue.name,
        event.category,
        // Auch in der eingestellten Sprache: wer "Concert" tippt, sucht nicht
        // nach dem deutschen Schlüssel, der am Termin steht.
        event.category ? term(event.category) : undefined,
        event.categoryLabel,
      ]
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
    term,
  ]);

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
      const amount = isDayView(view) ? direction : view === 'week' ? direction * 7 : 0;
      if (amount) setSelectedDay((current) => clampDay(addDays(current, amount), coverage));
    },
    [anchor, view, coverage, canStep, steppedAnchor],
  );

  /** Sprung auf heute, morgen oder übermorgen. */
  const goToDay = useCallback(
    (offset: number) => {
      const target = clampDay(addDays(format.today(), offset), coverage);
      setAnchor(target);
      setSelectedDay(target);
      setSelectedEventId(undefined);
      setCalendarFocusKey((current) => current + 1);
    },
    [format, coverage],
  );

  const goToday = useCallback(() => goToDay(0), [goToDay]);

  const selectDay = useCallback(
    (day: string) => {
      const target = clampDay(day, coverage);
      setAnchor(target);
      setSelectedDay(target);
      setSelectedEventId(undefined);
      // Einen Tag anzuklicken ist die Frage, was an ihm läuft – die Antwort
      // steht rechts. In Tag und Woche gibt es dort nichts aufzuklappen, dann
      // bleibt das ohne Wirkung (siehe `detailAvailable`).
      setLayout((current) => ({ ...current, detailCollapsed: false }));
    },
    [coverage],
  );

  /**
   * Der Wechsel der Ansicht.
   *
   * Die Karte zeigt einen Tag als Orte und beantwortet damit nur die halbe
   * Frage – was dort läuft, steht in der Spalte daneben. Wer sie öffnet, soll
   * beides sehen, auch wenn die Spalte zuletzt zugeklappt war.
   */
  const changeView = useCallback((next: ViewMode) => {
    setView(next);
    if (next === 'map') setLayout((current) => ({ ...current, detailCollapsed: false }));
  }, []);

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
    },
    [events, selectEvent, format, coverage],
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
        selectEvent(ordered[atDay === -1 ? ordered.length - 1 : atDay]);
      } else {
        const next = index + direction;
        if (next < 0 || next >= ordered.length) return;
        selectEvent(ordered[next]);
      }
      setRevealSelection((current) => current + 1);
    },
    [ordered, selectedEventId, selectedDay, selectEvent, format],
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

  const eventLink = useCallback(
    (event: CalendarEvent) => {
      const params = new URLSearchParams({
        city: cityId,
        view,
        date: clampDay(format.localDay(event.start), coverage),
        event: event.id,
      });
      return `${window.location.origin}${window.location.pathname}?${params}`;
    },
    [cityId, view, format, coverage],
  );

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

  // Tastatur: Pfeile blättern und wählen, Buchstaben schalten Ansicht und
  // Spalten. Kürzel bleiben absichtlich einzeln und ohne Modifikator – sie
  // sollen im Kalender liegen, nicht mit denen des Browsers streiten.
  //
  // Buchstaben und `/` `?` liefert `key` auf jedem Layout richtig. Die beiden
  // Spaltenkürzel liegen dagegen auf einer Taste, deren Zeichen vom Layout
  // abhängt – die laufen über `matchesKey` und werden vor der
  // Modifikatorsperre geprüft, weil AltGr unter Windows als Strg+Alt ankommt.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      // Escape wirkt überall, auch aus dem Suchfeld heraus – aber nur für
      // sich allein, damit Tastenfolgen des Systems unberührt bleiben.
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (typing) target.blur();
        dismiss();
        setSelectedEventId(undefined);
        setSolo(new Set());
        setCategorySolo(new Set());
        e.preventDefault();
        return;
      }
      // Ein offenes Menü führt seine Tastatur selbst; die Kürzelübersicht lässt
      // nur das Kürzel durch, das sie wieder zumacht.
      if (typing || menu) return;
      if (shortcutsOpen && e.key !== '?') return;

      if (matchesKey(e, SIDEBAR_KEY)) {
        setLayout((c) => ({ ...c, sidebarCollapsed: !c.sidebarCollapsed }));
        e.preventDefault();
        return;
      }
      if (matchesKey(e, DETAIL_KEY)) {
        // In Tag und Woche ohne gewählten Termin gibt es nichts aufzuklappen.
        if (detailAvailable) setLayout((c) => ({ ...c, detailCollapsed: !c.detailCollapsed }));
        e.preventDefault();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowLeft': step(-1); break;
        case 'ArrowRight': step(1); break;
        case 'ArrowUp': stepEvent(-1); break;
        case 'ArrowDown': stepEvent(1); break;
        case 't': case 'T': goToday(); break;
        case 'd': case 'D': changeView('day'); break;
        case 'w': case 'W': changeView('week'); break;
        case 'm': case 'M': changeView('month'); break;
        case 'k': case 'K': changeView('map'); break;
        case 'o': case 'O':
          if (selectedEvent) window.open(selectedEvent.url, '_blank', 'noopener,noreferrer');
          break;
        case '/': focusSearch(); break;
        case '?': setShortcutsOpen((open) => !open); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    step,
    stepEvent,
    goToday,
    focusSearch,
    dismiss,
    menu,
    shortcutsOpen,
    selectedEvent,
    detailAvailable,
    changeView,
  ]);

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
        onSelect: () => setSolo(new Set([event.sourceId])),
      },
      {
        key: 'title',
        label: t('menuOnlyTitle'),
        icon: <Filter className="h-3.5 w-3.5" />,
        onSelect: () => setQuery(event.title),
      },
    ];
  }, [menu, linkCopied, copyLink, selectEvent, data.definitions, t]);

  /* ------------------------------- Anzeige ------------------------------ */

  /** Wie viele Filter gerade greifen – Punkt am Knopf und „Zurücksetzen“. */
  const activeFilterCount =
    disabled.size +
    solo.size +
    categorySolo.size +
    disabledCategories.size +
    (availableOnly ? 1 : 0) +
    (query ? 1 : 0);

  const resetFilters = () => {
    setDisabled(new Set());
    setSolo(new Set());
    setCategorySolo(new Set());
    setDisabledCategories(new Set());
    setAvailableOnly(false);
    setQuery('');
  };

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
      cityId={cityId}
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
      categories={categories}
      enabledCategories={enabledCategories}
      onToggleCategory={(name) => {
        // Bei aktivem Fokus führt ein Klick zunächst dorthin zurück, wo man war.
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

  // Solange die Stadt nicht feststeht, hat der Kalender nichts zu zeigen:
  // Kopfzeile, Quellen und Termine gehörten sonst zu einer geratenen Stadt.
  if (cityStatus === 'ask') return <CityIntroScreen />;

  return (
    <div className="flex h-full flex-col overflow-hidden" onContextMenu={openMenu}>
        <Toolbar
          view={view}
          anchor={anchor}
          cityId={cityId}
          onCityChange={chooseCity}
          onViewChange={changeView}
          onStep={step}
          canStepBack={!restored || canStep(-1)}
          canStepForward={!restored || canStep(1)}
          onToday={goToday}
          onJumpDay={goToDay}
          selectedDay={selectedDay}
          onOpenFilters={() => setFiltersOpen(true)}
          activeFilterCount={activeFilterCount}
          sidebarCollapsed={layout.sidebarCollapsed}
          detailCollapsed={!detailOpen}
          canToggleDetail={detailAvailable}
          onToggleSidebar={() =>
            setLayout((c) => ({ ...c, sidebarCollapsed: !c.sidebarCollapsed }))
          }
          onToggleDetail={() => setLayout((c) => ({ ...c, detailCollapsed: !c.detailCollapsed }))}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          {/* Filter – links, ab lg dauerhaft sichtbar und in der Breite verstellbar.
              Zum Einklappen läuft die Breite auf null; der Inhalt behält seine
              eigene und wird beschnitten, statt sich dabei zu stauchen. */}
          <aside
            className={`hidden min-h-0 shrink-0 overflow-hidden bg-[var(--chrome)] lg:block
                        ${layout.sidebarCollapsed ? '' : 'hairline-r'}
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
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Mobile: die Suche steht über dem Kalender statt in den Filtern.
                Die 12 px ringsum sind Platz für den Schein des Suchfelds –
                `main` beschneidet, was darüber hinausgeht. */}
            <div className="shrink-0 px-3 py-3 hairline-b lg:hidden">
              <SearchField query={query} onQueryChange={setQuery} />
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
                  coverage={coverage}
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
                        ${detailOpen ? 'hairline-l' : ''}
                        ${resizing ? '' : `transition-[width] ${motion}`}`}
            style={{ width: detailOpen ? layout.detailWidth : 0 }}
            inert={!detailOpen}
          >
            <div className="h-full" style={{ width: layout.detailWidth }}>
              <DetailPanel
                day={selectedDay}
                dayEvents={dayEvents}
                event={selectedEvent}
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
              {activeFilterCount > 0 && (
                <span
                  className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent-soft)]
                             px-1.5 text-[11px] font-medium tabular-nums text-accent"
                >
                  {activeFilterCount}
                </span>
              )}
              {/* Ein Weg zurück auf den unberührten Bestand – auf dem Finger
                  ist das Einsammeln einzelner Filter sonst mühsam. */}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
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
                            ${activeFilterCount > 0 ? '' : 'ml-auto'}`}
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

function key(cityId: string, range: { from: string; to: string }): string {
  return `${cityId}_${range.from}_${range.to}`;
}

type StoredLayoutPrefs = Partial<Omit<LayoutPrefs, 'spaces'>> &
  Partial<CitySpacePrefs> & {
    spaces?: Record<string, Partial<CitySpacePrefs>>;
  };

function readLayoutPrefs(cityId: string): LayoutPrefs {
  try {
    return normalizeLayoutPrefs(
      JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as StoredLayoutPrefs,
      cityId,
    );
  } catch {
    return defaultLayout;
  }
}

function normalizeLayoutPrefs(stored: StoredLayoutPrefs, cityId: string): LayoutPrefs {
  const spaces = Object.fromEntries(
    Object.entries(stored.spaces ?? {}).map(([id, prefs]) => [id, normalizeSpacePrefs(prefs)]),
  );

  if (stored.disabledSources || stored.availableOnly !== undefined || stored.disabledCategories) {
    spaces[cityId] = normalizeSpacePrefs({
      ...spaces[cityId],
      disabledSources: stored.disabledSources,
      availableOnly: stored.availableOnly,
      disabledCategories: stored.disabledCategories,
    });
  }

  return {
    ...defaultLayout,
    sidebarWidth:
      typeof stored.sidebarWidth === 'number' ? stored.sidebarWidth : defaultLayout.sidebarWidth,
    detailWidth: typeof stored.detailWidth === 'number' ? stored.detailWidth : defaultLayout.detailWidth,
    sidebarCollapsed:
      typeof stored.sidebarCollapsed === 'boolean'
        ? stored.sidebarCollapsed
        : defaultLayout.sidebarCollapsed,
    detailCollapsed:
      typeof stored.detailCollapsed === 'boolean'
        ? stored.detailCollapsed
        : defaultLayout.detailCollapsed,
    spaces,
  };
}

function spacePrefs(layout: LayoutPrefs, cityId: string): CitySpacePrefs {
  return normalizeSpacePrefs(layout.spaces[cityId]);
}

function normalizeSpacePrefs(prefs: Partial<CitySpacePrefs> | undefined): CitySpacePrefs {
  return {
    disabledSources: stringList(prefs?.disabledSources),
    availableOnly:
      typeof prefs?.availableOnly === 'boolean' ? prefs.availableOnly : defaultSpacePrefs.availableOnly,
    disabledCategories: stringList(prefs?.disabledCategories),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'day' || value === 'week' || value === 'month' || value === 'map';
}
