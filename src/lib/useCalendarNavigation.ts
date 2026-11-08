import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ViewMode,
  addDays,
  addMonths,
  clampDay,
  coverageRange,
  isDayView,
  isSameMonth,
  navigationFloor,
  navigationRange,
} from '@/lib/calendar';
import { useSettings } from '@/lib/settings/context';
import { useMediaQuery } from '@/lib/useMediaQuery';

/**
 * Womit die Seite aufgeht – und zwar jedes Mal gleich: die zuletzt benutzte
 * Ansicht wird bewusst nicht gemerkt. Wer die Seite öffnet, will zuerst
 * wissen, was läuft, nicht wo er zuletzt war. Ein Link mit `?view=` sticht das.
 *
 * Auf jedem Gerät ist das der Monat: er zeigt auf einen Blick, wann überhaupt
 * etwas los ist, und rechts steht, was am gewählten Tag läuft.
 */
export const DEFAULT_VIEW: ViewMode = 'month';

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'day' || value === 'week' || value === 'month' || value === 'map';
}

/** Was ein Deeplink beim Start vorgibt; siehe `useAppPersistence`. */
export interface StartupState {
  view: ViewMode;
  day: string;
  eventId?: string;
}

/**
 * Wo im Kalender man steht: Ansicht, Anker, gewählter Tag und Termin – und
 * wohin man von dort blättern darf.
 *
 * `revealDetail` klappt die rechte Spalte auf; ein gewählter Tag und die Karte
 * wollen sie sehen. Die Spalte selbst gehört zum Layout, nicht hierher.
 */
export function useCalendarNavigation({
  initialAnchor,
  revealDetail,
}: {
  initialAnchor: string;
  revealDetail: () => void;
}) {
  const { format } = useSettings();

  const [view, setView] = useState<ViewMode>(DEFAULT_VIEW);
  const [anchor, setAnchor] = useState<string>(initialAnchor);
  const [selectedDay, setSelectedDay] = useState<string>(anchor);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  /** Erzwingt bei erneutem „Heute" ein Zentrieren, auch wenn das Datum gleich bleibt. */
  const [focusKey, setFocusKey] = useState(0);

  /**
   * Erst wenn URL und Speicher gelesen sind, darf zurückgeschrieben werden.
   * Bewusst State und kein Ref: der Schreib-Effekt liefe sonst noch im selben
   * Durchlauf mit den Anfangswerten und würde den Deeplink überschreiben.
   */
  const [restored, setRestored] = useState(false);

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

  /**
   * Wohin ein laufendes Wischen führt, noch bevor die Seite eingerastet ist.
   * Titel und Zähler folgen ihm sofort; der Anker selbst wechselt erst mit
   * `step`, wenn der Pager zur Ruhe gekommen ist.
   */
  const [previewAnchor, setPreviewAnchor] = useState<string | null>(null);
  const displayAnchor = previewAnchor ?? anchor;

  /** Übernimmt den Startzustand aus Deeplink und Speicher – genau einmal. */
  const restore = useCallback(
    ({ view: startupView, day, eventId }: StartupState) => {
      setView(startupView);
      // Auch ein alter Link führt nur in den Zeitraum, den der Server vorhält.
      const startDay = clampDay(day, navigationRange(startupView, format.today(), coverageRange(format.today())));
      setAnchor(startDay);
      setSelectedDay(startDay);
      if (eventId) setSelectedEventId(eventId);
      setRestored(true);
    },
    [format],
  );

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
      setFocusKey((current) => current + 1);
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
      revealDetail();
    },
    [navRange, revealDetail],
  );

  /**
   * Zeigt einen Termin an seinem Tag – auch einen, der gerade nicht im
   * geladenen Bestand steht (weitere Aufführungen).
   */
  const showEvent = useCallback(
    (eventId: string, start: string) => {
      const day = clampDay(format.localDay(start), coverage);
      setAnchor(day);
      setSelectedDay(day);
      setSelectedEventId(eventId);
    },
    [format, coverage],
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
      if (next === 'map') revealDetail();
    },
    [coverageDay, revealDetail],
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
    // Folgt einer äusseren Grösse (der Media Query).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view !== wanted) changeView(wanted);
  }, [restored, compact, landscape, view, changeView]);

  return {
    restored,
    restore,
    view,
    anchor,
    /** Der Anker, wie Titel und Zähler ihn zeigen – während des Wischens schon der nächste. */
    displayAnchor,
    setAnchor,
    selectedDay,
    selectedEventId,
    setSelectedEventId,
    focusKey,
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
  };
}

export type CalendarNavigation = ReturnType<typeof useCalendarNavigation>;
