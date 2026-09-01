import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TZ, monthsInRange } from '../../time.ts';
import { applyEnrichment, parseTeaserFragment, parseUpcomingFeed } from './parse.ts';
import type { Enrichment } from './parse.ts';

/**
 * Gasteig HP8.
 *
 * Die Veranstaltungsliste (`/veranstaltungen/`) zeigt selbst nur die ersten
 * 24 Treffer und lädt den Rest über den WordPress-Ajax-Endpunkt nach:
 *
 *   POST /backend/admin-ajax.php
 *        action=load_teasers&post_type=events
 *        &date_start=DD.MM.YYYY&date_end=DD.MM.YYYY
 *        &filters={"events_rooms":["isarphilharmonie"]}
 *        &show=…&past_events=true
 *
 * Derselbe Endpunkt beantwortet einen ganzen Monat auf einmal, liefert je
 * Termin (nicht je Produktion) einen Block und trägt die Schlagworte der
 * Seite mit. `filters` fasst innerhalb einer Gruppe als ODER zusammen,
 * zwischen den Gruppen als UND – die drei vom Nutzer gewünschten Listen
 * (Isarphilharmonie, Musik, Tanz) sind deshalb zwei Abfragen, deren Treffer
 * über die Termin-ID vereinigt werden. Ausgeschlossen wird erst im Parser:
 * „kreativ" und „kinder-jugend" hängen als Schlagwort am Termin.
 *
 * Kurztext, Endzeit, Preis und Ticketlink stehen nicht im Teaser, sondern im
 * schema.org-Feed:
 *
 *   GET /wp-json/api/events/upcoming?lang=de&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Der Feed heisst „upcoming" und meint es auch so: Vergangenes gibt er nicht
 * heraus, und ein zu grosser Zeitraum wird stillschweigend gekürzt. Deshalb
 * eine Abfrage je Monat, und für abgelaufene Monate gar keine – die Termine
 * bleiben dann ohne diese Felder, statt sie zu erfinden.
 *
 * Die Detailseiten hätten einen längeren Programmtext, wiegen aber rund
 * 300 kB und sind hier je Vorstellung eine eigene Seite (kein gemeinsamer
 * Produktionsschlüssel). Für ~40 Termine im Monat wäre das gut ein Dutzend
 * Megabyte je Auffrischung – dafür ist der Kurztext des Feeds der bessere
 * Handel.
 */

const BASE = 'https://www.gasteig.de';
const AJAX = `${BASE}/backend/admin-ajax.php`;
const FEED = `${BASE}/wp-json/api/events/upcoming`;

/**
 * Die Auswahl dieser Quelle, eine Abfrage je Filtergruppe.
 * Entspricht `?room=isarphilharmonie` sowie `?categories=musik` und
 * `?categories=tanz` auf der Website.
 */
const FILTER_SETS: Record<string, string[]>[] = [
  { events_rooms: ['isarphilharmonie'] },
  { events_categories: ['musik', 'tanz'] },
];

export const gasteig: EventSource = {
  definition: {
    id: 'gasteig',
    name: 'Gasteig HP8',
    cityId: 'muenchen',
    group: 'Konzert',
    defaultCategory: 'Konzert',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7));
    if (months.length === 0) return [];

    const results = await Promise.allSettled(
      months.map((month) => loadMonth(month, signal, options)),
    );

    const events: CalendarEvent[] = [];
    const failures: string[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failures.push(`${months[index]}: ${errorMessage(result.reason)}`);
    }

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    if (failures.length === months.length) throw new Error(failures.join('; '));
    if (failures.length) console.warn(`[gasteig] Teilausfall – ${failures.join('; ')}`);

    return dedupeById(events).filter((event) => withinRange(event.start, range));
  },
};

/** Einen Monat vollständig laden: beide Filtersätze plus den Feed. */
async function loadMonth(
  month: string,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<CalendarEvent[]> {
  const [start, end] = monthBounds(month);

  const fragments = await Promise.all(
    FILTER_SETS.map((filters) => loadTeasers(month, start, end, filters, signal, options)),
  );

  const feed = await loadFeed(month, start, end, signal, options);
  return applyEnrichment(dedupeById(fragments.flat()), feed);
}

async function loadTeasers(
  month: string,
  start: string,
  end: string,
  filters: Record<string, string[]>,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<CalendarEvent[]> {
  const html = await fetchText(AJAX, {
    signal,
    timeoutMs: options?.requestTimeoutMs,
    body: teaserBody(start, end, filters),
  });

  const { events, skipped, excluded, empty, blocks } = parseTeaserFragment(html);

  // Eine leere Antwort heisst „kein Termin im Zeitraum" – das ist bei einem
  // Monat jenseits des Vorverkaufs der Normalfall. Inhalt ohne einen
  // einzigen Teaser heisst dagegen: Aufbau geändert.
  if (!empty && blocks === 0) {
    throw new Error(`Teaser ${month} (${Object.keys(filters)[0]}): kein Block erkannt (Layout geändert?)`);
  }
  if (skipped > 0) {
    console.warn(`[gasteig] ${month}: ${skipped} Block/Blöcke übersprungen`);
  }
  if (excluded > 0) {
    console.info(`[gasteig] ${month}: ${excluded} Termin(e) ausgeschlossen (kreativ/kinder-jugend)`);
  }

  return events;
}

/**
 * Kurztext, Preis und Ticketlink. Schlägt der Feed fehl, laufen die Termine
 * ohne diese Felder weiter – besser als ein Monat ohne Spielplan.
 */
async function loadFeed(
  month: string,
  start: string,
  end: string,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<Enrichment> {
  if (end < today()) return new Map();

  try {
    const json = await fetchText(`${FEED}?lang=de&from=${start}&to=${end}`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    return parseUpcomingFeed(json);
  } catch (error) {
    console.warn(`[gasteig] ${month}: Feed nicht lesbar: ${errorMessage(error)}`);
    return new Map();
  }
}

/** Rumpf der Ajax-Abfrage, benannt wie das Formular auf der Seite. */
function teaserBody(start: string, end: string, filters: Record<string, string[]>): string {
  return new URLSearchParams({
    action: 'load_teasers',
    post_type: 'events',
    type: 'automated',
    language: 'de',
    order: 'date',
    // Vergangene Termine bleiben in der Antwort; die Anzeige leitet den
    // Zustand später aus der Zeit ab.
    past_events: 'true',
    duplicates: 'true',
    highlights: 'true',
    cache: 'false',
    current: '0',
    // Ein Monat hat nie annähernd so viele Termine – die Antwort kommt damit
    // ohne Blättern vollständig.
    show: '500',
    count: '9999',
    ignore: '[]',
    date_start: german(start),
    date_end: german(end),
    filters: JSON.stringify(filters),
  }).toString();
}

/** Erster und letzter Tag des Monats als ISO-Tag. */
function monthBounds(month: string): [string, string] {
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/** "2026-11-30" → "30.11.2026", wie das Datumsfeld der Seite es erwartet. */
function german(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default gasteig;
