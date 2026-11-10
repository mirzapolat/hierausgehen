'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cities, cityById } from '@/lib/cities';
import { displayAvailability, sourceColor, sourceName } from '@/lib/events/display';
import type { CalendarEvent, EventPerformance } from '@/lib/events/types';
import type { MessageKey } from '@/lib/i18n';
import { searchUrl, type SearchHitPayload, type SearchPayload } from '@/lib/search/api';
import type { Facet } from '@/lib/search/engine';
import { removeSpans, type ParsedQuery, type Span } from '@/lib/search/parse';
import { useSettings } from '@/lib/settings/context';
import { addMonths, startOfMonth } from '@/lib/calendar';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { rememberReturn } from '@/lib/return-path';
import { DONATE_URL, pageTitle } from '@/lib/site';
import { track } from '@/lib/analytics';
import { AvailabilityDot } from './AvailabilityDot';
import {
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  Close,
  Heart,
  MapPin,
  Search as SearchIcon,
  Settings,
  Share,
} from './icons';
import { DetailPanel } from './DetailPanel';
import { MobileEventSheet } from './MobileEventSheet';
import { MonthView } from './MonthView';
import { SaveButton } from './SaveButton';
import { shareLink } from './ShareButton';
import { keyboardClosed, particleBurst, prefersReducedMotion } from './searchBurst';

/**
 * Die Suche als Startseite.
 *
 * Ohne Anfrage: Stadt, Schriftzug, eine Zeile, worum es geht, das Feld und
 * zwei Knöpfe – auf dem Desktop mittig, auf dem Telefon im oberen Drittel,
 * damit die Tastatur nichts verdeckt. Mit Anfrage rückt das Feld in eine
 * feste Kopfzeile, darunter stehen die erkannten Angaben als Filter und die
 * Treffer in der Reihenfolge der Bewertung (`src/lib/search`).
 *
 * Ein Treffer öffnet den Termin im Kalender; „Kalender öffnen" nimmt den
 * erkannten Zeitraum mit.
 */

const EXAMPLES: Record<'de' | 'en', string[]> = {
  de: [
    'Konzerte dieses Wochenende',
    'Simon Rattle',
    'Kostenlos heute Abend',
    'Für Kinder am Sonntag',
    'Gemütlicher Jazzabend',
    'Oper im Dezember',
    'Comedy unter 20 €',
    'Etwas für einen verregneten Sonntag',
  ],
  en: [
    'Concerts this weekend',
    'Simon Rattle',
    'Free tonight',
    'For kids on Sunday',
    'Something romantic for a date',
    'Opera in December',
    'Comedy under 20 €',
    'Something for a rainy Sunday',
  ],
};
type SortOrder = 'relevance' | 'date';
const SORT_ORDERS: SortOrder[] = ['relevance', 'date'];
const SORT_KEY = 'search-sort';

// Die Wahl gilt für diesen Browser; ohne Speicher bleibt sie bis zum Neuladen.
let sortFallback: SortOrder = 'relevance';
const sortListeners = new Set<() => void>();
function subscribeSort(listener: () => void) {
  sortListeners.add(listener);
  return () => sortListeners.delete(listener);
}
function readSort(): SortOrder {
  try {
    const stored = window.localStorage.getItem(SORT_KEY);
    if (stored === 'date' || stored === 'relevance') return stored;
  } catch {
    // Kein Speicher – der Wert im Speicher der Seite gilt.
  }
  return sortFallback;
}
function writeSort(order: SortOrder) {
  sortFallback = order;
  try {
    window.localStorage.setItem(SORT_KEY, order);
  } catch {
    // Nur eine Bequemlichkeit.
  }
  sortListeners.forEach((listener) => listener());
}

const FACET_KEYS: Record<Facet, MessageKey> = {
  time: 'searchFacetTime',
  price: 'searchFacetPrice',
  tickets: 'searchFacetTickets',
  kids: 'searchFacetKids',
  date: 'searchFacetDate',
  category: 'searchFacetCategory',
  text: 'searchFacetText',
};

export function SearchScreen({
  initialQuery,
  initialData,
}: {
  initialQuery: string;
  initialData?: SearchPayload;
}) {
  const { cityId, chooseCity, t, settings, format } = useSettings();
  const router = useRouter();
  const [input, setInput] = useState(initialQuery);
  const [data, setData] = useState<SearchPayload | undefined>(initialData);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const debug = useRef(false);
  /** Für welche Stadt zuletzt gesucht wurde. */
  const searchedCity = useRef(initialData?.cityId);
  /** Eine Anfrage läuft, das Ergebnis ist noch nicht da – gilt auch für die erste. */
  const [pendingQuery, setPendingQuery] = useState<string>();
  /** Die Startseite verabschiedet sich gerade (Animation) – noch nicht umschalten. */
  const [leaving, setLeaving] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  /** Rechte Seite auf dem Desktop: ein Tag oder ein Termin – ohne beides der Kalender. */
  const [preview, setPreview] = useState<Preview>();
  /** Im Kalender angeklickter Tag – die Liste zeigt dann nur ihn. */
  const [dayFilter, setDayFilter] = useState<string>();
  /** Reihenfolge der Treffer; die Wahl bleibt für diesen Browser erhalten. */
  const sortOrder = useSyncExternalStore(subscribeSort, readSort, () => 'relevance' as const);
  const changeSort = writeSort;

  const showResults = ((!!data && !!data.query.trim()) || !!pendingQuery) && !leaving;
  const wide = useMediaQuery('(min-width: 1024px)');

  const run = useCallback(
    async (query: string, city: string, { push = true }: { push?: boolean } = {}) => {
      const trimmed = query.trim();
      const id = ++request.current;
      searchedCity.current = city;
      if (push) {
        window.history.pushState(null, '', trimmed ? searchUrl(trimmed, city) : `/search?city=${city}`);
      }
      if (!trimmed) {
        setData(undefined);
        setFailed(false);
        setPendingQuery(undefined);
        setLoading(false);
        return;
      }
      setLoading(true);
      setFailed(false);
      setPendingQuery(trimmed);
      try {
        const params = new URLSearchParams({ q: trimmed, city });
        if (debug.current) params.set('debug', '1');
        const response = await fetch(`/api/search?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as SearchPayload;
        if (id !== request.current) return;
        trackSearch(payload);
        setData(payload);
        setPreview(undefined);
        setDayFilter(undefined);
        // „… in Glasgow": die genannte Stadt wird zur gewählten – ohne dass
        // der Wechsel dieselbe Anfrage noch einmal auslöst.
        if (payload.cityId !== city) {
          searchedCity.current = payload.cityId;
          chooseCity(payload.cityId);
        }
      } catch {
        if (id === request.current) setFailed(true);
      } finally {
        if (id === request.current) {
          setLoading(false);
          setPendingQuery(undefined);
        }
      }
    },
    [chooseCity],
  );

  // Einmal beim Öffnen: Debug-Schalter aus der Adresse.
  useEffect(() => {
    debug.current = new URLSearchParams(window.location.search).get('debug') === '1';
  }, []);

  // Das Feld nimmt den Fokus nicht von selbst – sonst stünde der Cursor
  // mitten in den getippten Vorschlägen. Wer aber einfach lostippt, schreibt
  // ins Feld: die erste Taste setzt den Fokus, ihr Zeichen landet schon
  // darin. Kürzel, andere Felder und Knöpfe (Leertaste, Enter) bleiben unberührt.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="listbox"]')) return;
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Die gemerkte Stadt kommt erst nach der Hydration aus dem Speicher (und
  // aus den Einstellungen, wenn sie dort umgestellt wurde). Hat der Server
  // für eine andere gerechnet, kommt dieselbe Anfrage für die richtige –
  // „gesucht für" statt der Antwort verglichen, damit eine laufende Anfrage
  // nicht ein zweites Mal startet.
  useEffect(() => {
    if (!data?.query.trim() || searchedCity.current === cityId) return;
    searchedCity.current = cityId;
    void run(data.query, cityId, { push: false });
    // Nur auf den Stadtwechsel – nicht auf jede neue Antwort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  // Escape schliesst den Termin-Dialog (auf dem Telefon das Sheet selbst).
  useEffect(() => {
    if (!preview?.event || !wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview?.event, wide]);

  /** Stadt in der Pille umgestellt: dieselbe Anfrage dort. */
  const changeCity = (id: string) => {
    chooseCity(id);
    if (data?.query.trim()) void run(data.query, id);
  };

  // Zurück und Vor im Browser: Anfrage aus der Adresse.
  useEffect(() => {
    const onPop = () => {
      const query = new URLSearchParams(window.location.search).get('q') ?? '';
      setInput(query);
      void run(query, cityId, { push: false });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [run, cityId]);

  useEffect(() => {
    document.title = pageTitle(data?.query.trim() || t('searchTab'));
  }, [data?.query, t]);

  // Vorschläge tippen sich im leeren Feld der Startansicht selbst.
  const typed = useTypewriter(EXAMPLES[settings.locale], !showResults && !input);

  const submit = (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    // Leeres Feld auf der Startseite: gesucht wird, was gerade dasteht.
    const query = input.trim() || (showResults ? '' : typed.current);
    if (query !== input) setInput(query);
    void launch(query);
  };

  /**
   * Erst den Fokus lösen – auf dem Telefon klappt die Tastatur ein, und erst
   * wenn sie weg ist, steht das Feld dort, wo die Funken starten sollen.
   * Dann Funken und Druck aufs Feld; von der Startseite aus hebt sich die
   * Seite weg, bevor die Treffer kommen. Die Anfrage läuft von Anfang an mit.
   */
  const launch = async (query: string) => {
    const hadFocus = document.activeElement === inputRef.current;
    inputRef.current?.blur();
    if (!query.trim()) {
      void run(query, cityId);
      return;
    }
    if (hadFocus) await keyboardClosed();

    const reduced = prefersReducedMotion();
    const box = fieldRef.current;
    if (box && !reduced) {
      particleBurst(box.getBoundingClientRect(), { mode: showResults ? 'refresh' : 'launch' });
      box.classList.remove('search-press');
      void box.offsetWidth; // Animation neu starten, auch beim zweiten Mal
      box.classList.add('search-press');
    }
    if (!showResults && !reduced) {
      setLeaving(true);
      setTimeout(() => setLeaving(false), 380);
    }
    void run(query, cityId);
  };

  const replaceQuery = (query: string) => {
    setInput(query);
    void run(query, cityId);
  };

  const calendarHref = data?.query.trim() ? calendarLink(data) : `/calendar?city=${encodeURIComponent(cityId)}`;

  const field = (size: 'large' | 'compact') => (
    <SearchField
      size={size}
      placeholder={size === 'large' ? typed.text : undefined}
      boxRef={fieldRef}
      city={<CitySelect cityId={cityId} onChange={changeCity} size={size} />}
      inputRef={inputRef}
      value={input}
      onChange={setInput}
      onSubmit={submit}
      onClear={() => {
        setInput('');
        inputRef.current?.focus();
      }}
    />
  );

  /* ------------------------------ Startansicht ------------------------------ */

  if (!showResults) {
    return (
      <main
        className={`flex h-full flex-col overflow-y-auto bg-[var(--canvas)] scroll-quiet ${leaving ? 'search-leave' : ''}`}
      >
        <div className="relative flex shrink-0 items-center justify-between px-2 pt-2 sm:px-4 sm:pt-3">
          <ShareSite />
          <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 sm:hidden">
            <CitySelect cityId={cityId} onChange={changeCity} size="large" standalone />
          </div>
          <TopLinks />
        </div>

        {/* Telefon: oberes Drittel, damit die Tastatur die Knöpfe nicht
            verdeckt. Desktop: optisch mittig, etwas über der Mitte. */}
        <div className="h-[8vh] shrink-0 lg:h-auto lg:min-h-[10vh] lg:flex-1" />

        <div className="mx-auto flex w-full max-w-[640px] flex-col items-center px-4">
          <h1>
            <Wordmark size="large" />
          </h1>

          <div className="mt-7 w-full sm:mt-8">{field('large')}</div>

          {/* Zwei kompakte Wege: im Kalender stöbern oder suchen. Die Farbe
              und die rechte Position tragen die primäre Aktion „Suchen". */}
          <div className="mt-5 flex w-auto justify-center gap-2.5 sm:mt-6 sm:gap-3">
            <Link
              href={calendarHref}
              onClick={() => trackOpenCalendar(data)}
              className="flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)]
                         border border-line bg-[var(--raised)] px-4 text-[15px] text-text hover:border-line-strong sm:px-7"
            >
              <Calendar className="h-[18px] w-[18px] text-muted" />
              {t('searchOpenCalendar')}
            </Link>
            <button
              type="button"
              onClick={() => submit()}
              className="flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)]
                         bg-[var(--accent)] px-4 text-[15px] font-medium text-white hover:opacity-90 sm:px-8"
            >
              <SearchIcon className="h-[18px] w-[18px]" />
              {t('searchSubmit')}
            </button>
          </div>

          {failed && <p className="mt-6 text-[13px] text-danger">{t('searchError')}</p>}

        </div>

        <div className="min-h-10 flex-1" />
        <Footer />
      </main>
    );
  }

  /* -------------------------------- Treffer -------------------------------- */

  const shown = data && data.query.trim() ? data : undefined;
  const today = format.today();
  // Jeder Termin ist eine eigene Zeile – der Tagesfilter nimmt die des Tages.
  const filteredHits = shown
    ? dayFilter
      ? shown.hits.filter((hit) => format.localDay(hit.event.start) === dayFilter)
      : shown.hits
    : [];
  // Die API liefert nach Relevanz; nach Datum wird stabil umsortiert.
  const visibleHits =
    sortOrder === 'date' ? [...filteredHits].sort((a, b) => a.event.start.localeCompare(b.event.start)) : filteredHits;
  /** Ein Tag im Kalender: filtern – derselbe Tag noch einmal hebt den Filter auf. */
  const toggleDay = (day: string) => setDayFilter((current) => (current === day ? undefined : day));

  /** Was Seitenleiste und Sheet zeigen – derselbe Termin, dieselben Wege. */
  const detail = (payload: SearchPayload, current: Preview) => {
    const events = payload.hits.map((hit) => hit.event);
    const day = format.localDay(current.day);
    return {
      day,
      dayEvents: events.filter((event) => format.localDay(event.start) === day),
      event: current.event,
      cityId: payload.cityId,
      shareUrl: current.event ? eventLink(payload.cityId, current.event, day) : undefined,
      definitions: payload.definitions,
      onSelectEvent: (event: CalendarEvent) => setPreview({ day: event.start, event }),
      onSelectPerformance: (performance: EventPerformance) => {
        // Weitere Aufführungen stehen nicht unbedingt unter den Treffern –
        // dann zeigt sie der Kalender.
        const found = events.find((event) => event.id === performance.id);
        if (found) setPreview({ day: found.start, event: found });
        else router.push(eventLink(payload.cityId, performance, format.localDay(performance.start)));
      },
      // Eine Tagesansicht gibt es hier nicht – zurück heisst zu.
      onBackToDay: () => setPreview(undefined),
      onClose: () => setPreview(undefined),
    };
  };
  const firstLoad = loading && !shown;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--canvas)]">
      <header className="search-header-in z-10 shrink-0 bg-[var(--chrome)] hairline-b">
        <div className="mx-auto flex w-full max-w-[920px] items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 lg:max-w-none lg:px-5">
          <button
            type="button"
            onClick={() => replaceQuery('')}
            aria-label={t('searchHome')}
            className="grid h-10 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted hover:bg-[var(--canvas)]
                       hover:text-text sm:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => replaceQuery('')} className="hidden shrink-0 sm:block">
            <Wordmark size="small" />
          </button>
          <div className="min-w-0 flex-1">{field('compact')}</div>
          <div className="hidden sm:block">
            <TopLinks compact />
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(440px,560px)_minmax(0,1fr)]">
        <div className="h-full overflow-y-auto scroll-quiet lg:border-r lg:border-line">
        <div className="mx-auto w-full max-w-[880px] pb-28 sm:px-6 lg:max-w-none lg:px-5 lg:pb-12">
          {shown && (
            <Toolbar
              data={shown}
              loading={loading}
              calendarHref={calendarHref}
              onReplace={replaceQuery}
              dayFilter={dayFilter}
              shownCount={visibleHits.length}
              onClearDay={() => setDayFilter(undefined)}
              sortOrder={sortOrder}
              onSort={changeSort}
            />
          )}

          {failed && (
            <Notice>
              <span className="text-danger">{t('searchError')}</span>
            </Notice>
          )}

          {firstLoad && <Skeleton />}

          {shown && shown.hits.length === 0 && !loading && (
            <div className="px-4 py-16 text-center">
              <p className="text-[15px] font-medium text-text">{t('searchNoResults')}</p>
              <p className="mt-1.5 text-[13px] text-muted">{t('searchNoResultsHint')}</p>
              <Link
                href={calendarHref}
                onClick={() => trackOpenCalendar(data)}
                className="mt-5 inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-line px-4 text-[13px]
                           text-text hover:border-line-strong"
              >
                <Calendar className="h-4 w-4 text-muted" />
                {t('searchOpenCalendar')}
              </Link>
            </div>
          )}

          {shown && visibleHits.length > 0 && (
            <ol key={`${shown.cityId}:${shown.query}:${dayFilter ?? ''}:${sortOrder}`} className={`transition-opacity ${loading ? 'opacity-50' : ''}`}>
              {visibleHits.map((hit, index) => (
                <ResultRow
                  key={hit.key}
                  hit={hit}
                  data={shown}
                  index={index}
                  selected={preview?.event?.id === hit.event.id}
                  onPreview={(event) => setPreview({ day: event.start, event })}
                />
              ))}
            </ol>
          )}
          </div>
        </div>

        {/* Desktop: rechts der Kalender mit genau diesen Treffern; ein Klick
            – hier oder in der Liste – öffnet den Termin als Dialog in der
            Mitte. Die Suche bleibt dahinter stehen, kein Sprung in den Kalender. */}
        {wide && (
          <div className="relative hidden h-full min-h-0 lg:flex">
            {/* Ein Klick irgendwo in den Kalender schliesst den offenen Termin.
                Termine selbst halten ihren Klick an (`MonthDayCell`) und öffnen
                stattdessen ihren eigenen. */}
            <section
              onClick={() => setPreview(undefined)}
              className="flex min-w-0 flex-1 flex-col bg-[var(--chrome)]"
            >
              {shown && (
                <CalendarPreview
                  key={`${shown.cityId}:${shown.query}`}
                  data={shown}
                  dayFilter={dayFilter}
                  onSelectDay={toggleDay}
                  selectedEventId={preview?.event?.id}
                  focusDay={preview?.day}
                  onPreview={setPreview}
                />
              )}
            </section>
          </div>
        )}
      </main>

      {wide && shown && preview?.event && (
        <EventDialog key={preview.event.id} onClose={() => setPreview(undefined)} closeLabel={t('close')}>
          <DetailPanel {...detail(shown, preview)} />
        </EventDialog>
      )}

      {/* Telefon: der Kalender schwebt als Knopf über der Liste – dort gibt es
          keine Vorschau daneben. Solange ein Termin offen ist, tritt er zurück. */}
      {!wide && shown && !preview?.event && (
        // Aussen zentriert, innen animiert – beides über `transform` ginge nicht zusammen.
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 flex justify-center">
          <Link
            href={calendarHref}
            onClick={() => trackOpenCalendar(data)}
            className="search-rise pointer-events-auto flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-5
                       text-[14px] font-medium text-white"
            style={{ boxShadow: 'var(--shadow-overlay)', animationDelay: '250ms' }}
          >
            <Calendar className="h-4 w-4" />
            {t('searchShowInCalendar')}
          </Link>
        </div>
      )}

      {/* Telefon: der Termin als Sheet über der Liste – kein Sprung in den Kalender. */}
      {!wide && shown && (
        <MobileEventSheet
          {...detail(shown, preview ?? { day: today })}
          open={!!preview?.event}
          onClose={() => setPreview(undefined)}
          shareUrl={(event) => eventLink(shown.cityId, event, format.localDay(event.start))}
          revealPerformances={0}
        />
      )}
    </div>
  );
}

/**
 * Der Termin als Dialog in der Mitte – Desktop. Escape schliesst ihn über den
 * Tastendruck der Suche, ein Klick daneben hier.
 */
function EventDialog({ onClose, closeLabel, children }: { onClose: () => void; closeLabel: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Der Fokus gehört dem Dialog, damit Tab und Screenreader dort beginnen.
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="search-fade-in absolute inset-0"
        style={{ background: 'var(--overlay)' }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="search-dialog-in relative flex h-[min(760px,calc(100dvh-3rem))] w-full max-w-[560px] flex-col overflow-hidden
                   rounded-[var(--radius-lg)] border border-line outline-none"
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- Feld --------------------------------- */

/**
 * Stadt und Suchtext in einem Feld: links, wo gesucht wird, rechts, wonach.
 * Die Stadt ist ein Knopf im Feld; ihre Liste klappt direkt darunter auf.
 */
function SearchField({
  size,
  placeholder,
  city,
  boxRef,
  inputRef,
  value,
  onChange,
  onSubmit,
  onClear,
}: {
  size: 'large' | 'compact';
  /** Eigener Platzhalter – auf der Startseite der getippte Vorschlag. */
  placeholder?: string;
  city: ReactNode;
  /** Das sichtbare Feld – von hier starten die Funken. */
  boxRef?: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: { preventDefault(): void }) => void;
  onClear: () => void;
}) {
  const { t } = useSettings();
  const large = size === 'large';
  return (
    <form role="search" onSubmit={onSubmit} className="w-full">
      <label htmlFor="search-input" className="sr-only">
        {t('searchAria')}
      </label>
      <div
        ref={boxRef}
        className={`relative flex w-full items-center rounded-[var(--radius-lg)] border border-line-strong bg-[var(--raised)]
                    transition-[border-color,box-shadow] focus-within:border-[var(--accent)]
                    focus-within:shadow-[0_0_0_3px_var(--accent-soft)]
                    ${large ? 'h-[52px] sm:h-14' : 'h-10'}`}
      >
        <div className={large ? 'hidden h-full sm:block' : 'h-full'}>{city}</div>
        <span
          aria-hidden="true"
          className={`w-px shrink-0 bg-[var(--line-strong)] ${large ? 'hidden h-6 sm:block' : 'h-5'}`}
        />
        <input
          id="search-input"
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('searchPlaceholder')}
          className={`search-page-input h-full min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none
                      placeholder:text-faint [&::-webkit-search-cancel-button]:hidden
                      ${large ? 'pl-3.5 sm:pl-4 sm:text-[17px]' : 'pl-3 sm:text-[14px]'}`}
        />
        {value ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={t('clearSearch')}
            className="mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-faint
                       hover:bg-[var(--chrome)] hover:text-text"
          >
            <Close className="h-3.5 w-3.5" />
          </button>
        ) : (
          <SearchIcon className={`mr-4 shrink-0 text-faint ${large ? 'h-[18px] w-[18px]' : 'h-4 w-4 mr-3'}`} />
        )}
      </div>
    </form>
  );
}

/* ------------------------------ Filterzeile ------------------------------ */

function Toolbar({
  data,
  loading,
  calendarHref,
  onReplace,
  dayFilter,
  shownCount,
  onClearDay,
  sortOrder,
  onSort,
}: {
  data: SearchPayload;
  loading: boolean;
  calendarHref: string;
  onReplace: (query: string) => void;
  dayFilter?: string;
  shownCount: number;
  onClearDay: () => void;
  sortOrder: SortOrder;
  onSort: (order: SortOrder) => void;
}) {
  const { t, format } = useSettings();
  const count = dayFilter ? shownCount : data.total;
  const chips = useChips(data.parsed);
  const relaxedNames = data.relaxed.map((facet) => t(FACET_KEYS[facet])).join(', ');

  return (
    <div className="pt-3 sm:pt-5">
      {(chips.length > 0 || dayFilter) && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:px-0">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] border border-line
                         bg-[var(--accent-soft)] pl-2.5 pr-1 text-[12px] font-medium text-accent"
            >
              {chip.label}
              {chip.spans.length > 0 && (
                <button
                  type="button"
                  onClick={() => onReplace(removeSpans(data.query, chip.spans))}
                  aria-label={t('searchFacetRemove', { label: chip.label })}
                  className="grid h-5 w-5 place-items-center rounded-[var(--radius-xs)] opacity-70 hover:opacity-100"
                >
                  <Close className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {dayFilter && (
            // Der Tag aus dem Kalender – eine Einschränkung der Liste, nicht der Anfrage.
            <span
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--accent)]
                         bg-[var(--accent-soft)] pl-2.5 pr-1 text-[12px] font-medium text-accent"
            >
              <Calendar className="h-3 w-3" />
              {format.dayShort(dayFilter)}
              <button
                type="button"
                onClick={onClearDay}
                aria-label={t('searchFacetRemove', { label: format.dayShort(dayFilter) })}
                className="grid h-5 w-5 place-items-center rounded-[var(--radius-xs)] opacity-70 hover:opacity-100"
              >
                <Close className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-3 px-4 sm:mt-3 sm:px-0">
        <span aria-live="polite" className="text-[12px] tabular-nums text-muted">
          {loading ? t('searchLoading') : count === 1 ? t('searchResultCountOne') : t('searchResultCount', { count })}
        </span>
        <div
          role="group"
          aria-label={t('searchSortAria')}
          className="ml-auto inline-flex rounded-[var(--radius-sm)] border border-line p-[2px] text-[12px]"
        >
          {SORT_ORDERS.map((order) => (
            <button
              key={order}
              type="button"
              aria-pressed={sortOrder === order}
              onClick={() => onSort(order)}
              className={`rounded-[var(--radius-xs)] px-2 py-0.5 ${
                sortOrder === order ? 'bg-[var(--sunken)] text-text' : 'text-muted hover:text-text'
              }`}
            >
              {t(order === 'date' ? 'searchSortDate' : 'searchSortRelevance')}
            </button>
          ))}
        </div>
        <Link
          href={calendarHref}
          onClick={() => trackOpenCalendar(data)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-accent
                     hover:bg-[var(--chrome)]"
        >
          <Calendar className="h-3.5 w-3.5" />
          {t('searchOpenCalendar')}
        </Link>
      </div>

      {data.relaxed.length > 0 && data.hits.length > 0 && (
        <Notice>{t('searchRelaxed', { facets: relaxedNames })}</Notice>
      )}

      <div className="mt-3 border-b border-line" />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="mx-4 mt-3 rounded-[var(--radius-md)] bg-[var(--sunken)] px-3 py-2 text-[12px] leading-relaxed text-muted sm:mx-0">
      {children}
    </p>
  );
}

interface Chip {
  key: string;
  label: string;
  spans: Span[];
}

/** Die erkannten Angaben in der eingestellten Sprache. */
function useChips(parsed: ParsedQuery): Chip[] {
  const { t, term, format, cityId } = useSettings();
  const chips: Chip[] = [];
  const { date, times, categories, price, tickets, kids } = parsed;

  if (categories) {
    chips.push({ key: 'category', label: categories.values.map(term).join(' · '), spans: categories.spans });
  }
  if (date) {
    const today = format.today();
    let label: string;
    if (date.kind === 'day') {
      label =
        date.from === today ? t('today') : date.from === nextDay(today) ? t('tomorrow') : format.dayShort(date.from);
    } else if (date.kind === 'month') {
      label = format.monthYear(date.from);
    } else {
      const range =
        date.from === date.to
          ? format.dayNumeric(date.from)
          : `${format.dayNumeric(date.from)} – ${format.dayNumeric(date.to)}`;
      label = date.kind === 'weekend' ? `${t('searchWeekend')} · ${range}` : range;
    }
    chips.push({ key: 'date', label, spans: date.spans });
  }
  if (times) {
    const names = { day: t('timeDay'), evening: t('timeEvening'), night: t('timeNight') };
    chips.push({ key: 'time', label: times.values.map((value) => names[value]).join(' · '), spans: times.spans });
  }
  if (price) {
    const currency = cityById(cityId).country === 'GB' ? '£' : '€';
    const label = price.free
      ? t('onlyFree')
      : price.max !== undefined
        ? t('searchPriceMax', { amount: `${price.max} ${currency}` })
        : t('searchCheap');
    chips.push({ key: 'price', label, spans: price.spans });
  }
  if (tickets) chips.push({ key: 'tickets', label: t('onlyAvailable'), spans: tickets.spans });
  if (kids?.spans.length) chips.push({ key: 'kids', label: t('searchKids'), spans: kids.spans });
  return chips;
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/* -------------------------------- Treffer -------------------------------- */

function ResultRow({
  hit,
  data,
  index,
  selected,
  onPreview,
}: {
  hit: SearchHitPayload;
  data: SearchPayload;
  index: number;
  selected: boolean;
  /** Desktop: statt in den Kalender zu springen, rechts zeigen. */
  onPreview?: (event: CalendarEvent) => void;
}) {
  const { t, term, format } = useSettings();
  const { event } = hit;
  const day = format.localDay(event.start);
  const color = sourceColor(data.definitions, event.sourceId);
  const today = format.today();
  const isToday = day === today;
  const otherYear = day.slice(0, 4) !== today.slice(0, 4);

  return (
    <li
      data-hit-id={event.id}
      aria-current={selected || undefined}
      className={`search-rise group relative border-b border-line ${selected ? 'bg-[var(--accent-soft)]' : ''}`}
      // Nacheinander aufsteigen; ab der zwölften Zeile ist sie ohnehin ausserhalb des Blicks.
      style={{ animationDelay: `${Math.min(index, 12) * 32}ms` }}
    >
      <Link
        href={eventLink(data.cityId, event, day)}
        onClick={(e) => {
          track('search-result', { source: event.sourceId, category: event.category, rank: rankBucket(index) });
          if (!onPreview || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          onPreview(event);
        }}
        className="flex items-start gap-3.5 py-3.5 pl-4 pr-12 hover:bg-[var(--chrome)] sm:gap-5 sm:rounded-[var(--radius-md)]
                   sm:py-4 sm:pl-3 sm:pr-14"
      >
        {/* Kalenderblatt: oben der Monat, gross der Tag, darunter der
            Wochentag – und das Jahr nur, wenn es nicht dieses ist. */}
        <span
          className="flex w-[50px] shrink-0 flex-col items-center overflow-hidden rounded-[var(--radius-md)] border border-line
                     bg-[var(--raised)] text-center sm:w-[56px]"
        >
          <span
            className={`w-full py-[3px] text-[10px] font-semibold uppercase leading-tight tracking-[0.06em]
                        ${isToday ? 'bg-[var(--accent)] text-white' : 'bg-[var(--sunken)] text-text'}`}
          >
            {format.monthShort(day)}
          </span>
          <span className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-text sm:text-[22px]">
            {format.dayNumber(day)}
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
            {format.weekdayShort(day)}
          </span>
          {otherYear ? (
            <span className="mb-1 mt-0.5 text-[10px] font-semibold tabular-nums text-accent">{day.slice(0, 4)}</span>
          ) : (
            <span className="h-1.5" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug tracking-[-0.01em] text-text sm:text-[16px]">
            {event.title}
          </span>
          {event.subtitle && (
            <span className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-muted sm:line-clamp-2">{event.subtitle}</span>
          )}
          <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted">
            <span className="tabular-nums text-text">{event.allDay ? t('allDay') : format.time(event.start)}</span>
            <Dot />
            <span className="truncate">{event.venue.name}</span>
            {event.category && (
              <>
                <Dot />
                <span>{term(event.category)}</span>
              </>
            )}
          </span>
          {event.description && (
            <span className="mt-2 hidden text-[13px] leading-relaxed text-faint sm:line-clamp-2">{event.description}</span>
          )}
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-[10px] w-[3px] rounded-full" style={{ background: color }} />
              {sourceName(data.definitions, event.sourceId)}
            </span>
            <AvailabilityDot value={displayAvailability(event)} />
          </span>
          {hit.breakdown && (
            <span className="mt-1.5 block font-mono text-[10px] leading-relaxed text-faint">
              score {hit.score.toFixed(3)} · text {hit.breakdown.text.toFixed(2)} (lex {hit.breakdown.lexical.toFixed(2)},
              sem {hit.breakdown.semantic.toFixed(2)}, cov {hit.breakdown.coverage.toFixed(2)}) · λ{' '}
              {hit.breakdown.lambda.toFixed(2)} · α {hit.breakdown.alpha.toFixed(2)} · fit {hit.breakdown.fit.toFixed(2)} ·
              prior {hit.breakdown.prior.toFixed(2)} · tier {hit.tier}
            </span>
          )}
        </span>
      </Link>
      <SaveButton
        event={event}
        cityId={data.cityId}
        className={() =>
          `absolute right-2 top-3 grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-accent
           hover:bg-[var(--canvas)] sm:right-3 sm:top-4`
        }
      />
    </li>
  );
}

function Dot() {
  return <span aria-hidden="true" className="text-faint">·</span>;
}

function Skeleton() {
  return (
    <ol aria-hidden="true" className="mt-4 animate-pulse">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex gap-4 border-b border-line px-4 py-4 sm:px-3">
          <span className="h-[62px] w-[46px] shrink-0 rounded-[var(--radius-md)] bg-[var(--sunken)] sm:w-[52px]" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-4 w-2/3 rounded-[var(--radius-xs)] bg-[var(--sunken)]" />
            <span className="block h-3 w-1/2 rounded-[var(--radius-xs)] bg-[var(--sunken)]" />
            <span className="block h-3 w-1/3 rounded-[var(--radius-xs)] bg-[var(--sunken)]" />
          </span>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------- Vorschau -------------------------------- */

/** Was die Seitenleiste zeigt: ein Tag (Liste seiner Treffer) oder ein Termin. `day` ist ein ISO-Zeitpunkt oder -Tag. */
interface Preview {
  day: string;
  event?: CalendarEvent;
}

/**
 * Rechts auf dem Desktop: ein Monatskalender mit genau den gefundenen
 * Terminen. Er beginnt beim Monat des frühesten Treffers und folgt dem
 * gewählten Termin, wenn der in einem anderen Monat liegt.
 */
function CalendarPreview({
  data,
  dayFilter,
  onSelectDay,
  selectedEventId,
  focusDay,
  onPreview,
}: {
  data: SearchPayload;
  /** Gefilterter Tag – im Raster markiert. */
  dayFilter?: string;
  onSelectDay: (day: string) => void;
  selectedEventId?: string;
  focusDay?: string;
  onPreview: (preview: Preview | undefined) => void;
}) {
  const { t, format } = useSettings();
  const events = useMemo(() => data.hits.map((hit) => hit.event), [data]);
  const firstDay = events.length ? [...events].sort((a, b) => a.start.localeCompare(b.start))[0].start : undefined;
  const [anchor, setAnchor] = useState(() => startOfMonth(firstDay ? format.localDay(firstDay) : format.today()));

  // Ein in der Liste gewählter Termin in einem anderen Monat: dorthin blättern.
  const focusMonth = focusDay ? startOfMonth(format.localDay(focusDay)) : undefined;
  const [lastFocus, setLastFocus] = useState(focusMonth);
  if (focusMonth !== lastFocus) {
    setLastFocus(focusMonth);
    if (focusMonth) setAnchor(focusMonth);
  }

  // Die Liste zeigt, was gewählt ist.
  useEffect(() => {
    if (!selectedEventId) return;
    document
      .querySelector(`[data-hit-id="${CSS.escape(selectedEventId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedEventId]);

  const inMonth = events.filter((event) => format.localDay(event.start).slice(0, 7) === anchor.slice(0, 7)).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4 hairline-b">
        <h2 className="text-[14px] font-semibold text-text">{format.monthYear(anchor)}</h2>
        <span className="text-[12px] tabular-nums text-muted">
          {inMonth === 1 ? t('searchResultCountOne') : t('searchResultCount', { count: inMonth })}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Link
            href={
              dayFilter
                ? `/calendar?${new URLSearchParams({ city: data.cityId, view: 'day', date: dayFilter })}`
                : `/calendar?${new URLSearchParams({ city: data.cityId, view: 'month', date: anchor })}`
            }
            className="mr-2 inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2.5
                       text-[12px] font-medium text-white hover:opacity-90"
          >
            <Calendar className="h-3.5 w-3.5" />
            {t('searchOpenInCalendar')}
          </Link>
          <button
            type="button"
            onClick={() => setAnchor(startOfMonth(format.today()))}
            className="h-7 rounded-[var(--radius-sm)] px-2 text-[12px] text-muted hover:bg-[var(--canvas)] hover:text-text"
          >
            {t('today')}
          </button>
          <button
            type="button"
            onClick={() => setAnchor((value) => addMonths(value, -1))}
            aria-label={t('previousMonth')}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted hover:bg-[var(--canvas)] hover:text-text"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor((value) => addMonths(value, 1))}
            aria-label={t('nextMonth')}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted hover:bg-[var(--canvas)] hover:text-text"
          >
            <ChevronLeft className="h-3.5 w-3.5 rotate-180" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-[var(--canvas)]">
        <MonthView
          anchor={anchor}
          events={events}
          definitions={data.definitions}
          selectedDay={dayFilter ?? (focusDay ? format.localDay(focusDay) : '')}
          selectedEventId={selectedEventId}
          // Ein Tag filtert die Liste links; Termine öffnen die Seitenleiste.
          onSelectDay={onSelectDay}
          onSelectEvent={(event) => onPreview({ day: event.start, event })}
        />
      </div>
    </div>
  );
}

/** Ein Treffer öffnet den Termin im Kalender – mit Detailansicht. */
/* ------------------------------- Zählung ------------------------------- */

// Gezählt wird über `track()` statt `data-umami-event`: auf einem `<Link>`
// fängt das Umami-Skript den Klick ab und lädt die Seite neu – die Vorschau
// rechts käme nie zum Zug. Die Anfrage selbst wird nie mitgeschickt, nur
// grobe Stufen und welche Angaben erkannt wurden.

function trackSearch(payload: SearchPayload) {
  const parsed = payload.parsed;
  const facets = [
    parsed.date && 'date',
    parsed.times && 'time',
    parsed.categories && 'category',
    parsed.price && 'price',
    parsed.tickets && 'tickets',
    parsed.kids && 'kids',
  ].filter(Boolean);
  const count = payload.hits.length;
  track('search', {
    city: payload.cityId,
    mode: payload.mode,
    results: count === 0 ? '0' : count <= 5 ? '1-5' : count <= 20 ? '6-20' : '21+',
    facets: facets.length ? facets.join(',') : 'none',
  });
}

function trackOpenCalendar(data: SearchPayload | undefined) {
  track('search-open-calendar', { query: data?.query.trim() ? 1 : 0 });
}

function rankBucket(index: number): string {
  return index < 3 ? String(index + 1) : index < 10 ? '4-10' : '11+';
}

function eventLink(cityId: string, event: Pick<CalendarEvent, 'id'>, day: string): string {
  const params = new URLSearchParams({ city: cityId, view: 'month', date: day, event: event.id });
  return `/calendar?${params}`;
}

/** „Kalender öffnen" nimmt den erkannten Zeitraum mit – Tag, Woche oder Monat. */
function calendarLink(data: SearchPayload): string {
  const params = new URLSearchParams({ city: data.cityId });
  const date = data.relaxed.includes('date') ? undefined : data.parsed.date;
  if (date) {
    params.set('view', date.kind === 'day' ? 'day' : date.kind === 'month' ? 'month' : 'week');
    params.set('date', date.from);
  }
  return `/calendar?${params}`;
}

/* ---------------------------------- Teile ---------------------------------- */

/** Der Schriftzug – die Endung leiser, damit der Name trägt. */
function Wordmark({ size }: { size: 'large' | 'small' }) {
  return (
    <span
      className={`block select-none font-bold leading-none text-text ${
        size === 'large' ? 'text-[28px] tracking-[-0.04em] sm:text-[36px]' : 'text-[15px] tracking-[-0.03em]'
      }`}
    >
      HIERAUSGEHEN<span className="text-faint">.de</span>
    </span>
  );
}

/** Stadt als erster Teil des Suchfelds. */
function CitySelect({
  cityId,
  onChange,
  size,
  standalone = false,
}: {
  cityId: string;
  onChange: (id: string) => void;
  size: 'large' | 'compact';
  standalone?: boolean;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const city = cityById(cityId);
  const large = size === 'large';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={container} className={standalone ? 'relative' : 'relative h-full shrink-0'}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('selectCity')}: ${city.name}`}
        className={`flex items-center gap-1.5 ${
          standalone
            ? 'h-9 max-w-[132px] rounded-[var(--radius-md)] px-2 text-[14px] font-normal text-muted hover:bg-[var(--chrome)] hover:text-text'
            : `h-full rounded-l-[var(--radius-lg)] font-medium text-text hover:bg-[var(--chrome)] ${large ? 'pl-4 pr-3 text-[15px] sm:pl-5' : 'pl-3 pr-2 text-[13px]'}`
        }`}
      >
        <MapPin className={`h-4 w-4 shrink-0 ${standalone ? 'text-faint' : 'text-accent'}`} />
        {large ? (
          <span className={standalone ? 'truncate' : undefined}>{city.name}</span>
        ) : (
          <>
            <span className="sm:hidden">{city.shortName}</span>
            <span className="hidden sm:inline">{city.name}</span>
          </>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute top-[calc(100%+6px)] z-50 min-w-[230px] overflow-hidden rounded-[var(--radius-lg)]
                      border border-line py-1 ${
                        standalone ? 'left-1/2 -translate-x-1/2 bg-[var(--canvas)]' : 'left-0 bg-[var(--raised)]'
                      }`}
          style={{ boxShadow: standalone ? 'none' : 'var(--shadow-overlay)' }}
        >
          {cities.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.id === cityId}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] hover:bg-[var(--chrome)]
                           lg:py-1.5 lg:text-[13px]"
              >
                <Check className={`h-3.5 w-3.5 ${item.id === cityId ? 'text-accent' : 'text-transparent'}`} />
                <span className="flex-1">{item.name}</span>
                <span className="text-[11px] text-faint">{item.country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Merkliste und Einstellungen – oben rechts, auf dem Telefon nur als Zeichen. */
function TopLinks({ compact = false }: { compact?: boolean }) {
  const { t } = useSettings();
  const item = `flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] text-[13px] text-muted
                hover:bg-[var(--chrome)] hover:text-text ${compact ? 'w-9 justify-center' : 'px-2.5'}`;
  return (
    <nav className="flex items-center gap-0.5">
      <Link href="/merkliste" onClick={rememberReturn} aria-label={t('savedTitle')} title={t('savedTitle')} className={item}>
        <Bookmark className="h-4 w-4" />
        {!compact && <span className="hidden sm:inline">{t('savedTitle')}</span>}
      </Link>
      <Link href="/settings" onClick={rememberReturn} aria-label={t('settings')} title={t('settings')} className={item}>
        <Settings className="h-4 w-4" />
        {!compact && <span className="hidden sm:inline">{t('settings')}</span>}
      </Link>
    </nav>
  );
}

/**
 * Oben links: die Seite weitergeben. Auf dem Telefon über das Teilen-Menü des
 * Systems, sonst wird der Link kopiert – das sagt der Knopf dann kurz.
 */
function ShareSite() {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void shareLink('/', t('appName')).then((result) => {
          if (result === 'copied') setCopied(true);
        });
      }}
      aria-label={t('shareWebsite')}
      title={t('shareWebsite')}
      data-umami-event="share-website"
      className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-[13px] text-muted
                 hover:bg-[var(--chrome)] hover:text-text"
    >
      {copied ? <Check className="h-4 w-4 text-accent" /> : <Share className="h-4 w-4" />}
      <span className="hidden sm:inline">{copied ? t('menuLinkCopied') : t('shareWebsite')}</span>
    </button>
  );
}

function Footer() {
  const { t, cityId } = useSettings();
  return (
    <footer className="flex shrink-0 justify-center gap-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-6 text-[12px] text-faint">
      <Link href="/impressum" onClick={rememberReturn} className="hover:text-text">
        {t('imprint')}
      </Link>
      <Link href={`/status?city=${encodeURIComponent(cityId)}`} onClick={rememberReturn} className="hover:text-text">
        {t('status')}
      </Link>
      <a
        href={DONATE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={t('donateTitle')}
        className="inline-flex items-center gap-1 hover:text-text"
      >
        <Heart className="h-3.5 w-3.5 text-heart" />
        {t('donate')}
      </a>
    </footer>
  );
}

/* ------------------------------ Schreibmaschine ------------------------------ */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Vorschläge, die sich selbst ins Feld tippen: Buchstabe für Buchstabe mit
 * leicht unregelmässigem Takt, kurz stehen lassen, zügig löschen, der
 * nächste. Wer Bewegung reduziert hat, bekommt die Vorschläge im Wechsel
 * ohne Tippen. `current` ist der ganze Vorschlag, auch während er noch
 * getippt wird – danach sucht „Suchen" bei leerem Feld.
 */
function useTypewriter(phrases: string[], enabled: boolean): { text: string; current: string } {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const phrase = phrases[index % phrases.length];

  useEffect(() => {
    if (!enabled) return;
    let delay: number;
    let step: () => void;
    if (reduced) {
      delay = 3200;
      step = () => setIndex((value) => value + 1);
    } else if (!deleting && length < phrase.length) {
      // Ein Tippen ist nie ganz gleichmässig; nach Leerzeichen etwas länger.
      const char = phrase.charCodeAt(length);
      delay = 45 + (char % 4) * 14 + (phrase[length] === ' ' ? 40 : 0);
      step = () => setLength((value) => value + 1);
    } else if (!deleting) {
      delay = 1800;
      step = () => setDeleting(true);
    } else if (length > 0) {
      delay = 22;
      step = () => setLength((value) => value - 1);
    } else {
      delay = 380;
      step = () => {
        setDeleting(false);
        setIndex((value) => value + 1);
      };
    }
    const timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [enabled, reduced, deleting, length, phrase]);

  if (reduced) return { text: phrase, current: phrase };
  const typing = length < phrase.length || deleting;
  return { text: phrase.slice(0, length) + (typing ? '|' : ''), current: phrase };
}
