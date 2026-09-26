import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import {
  applyEventTypes,
  parseEventTypes,
  parseMonthResponse,
  parseNonce,
  parseTypeAssignments,
  type ParseResult,
} from './parse.ts';
import { assertRecognised } from '../page.ts';
import { dedupeById, errorMessage, settleParts, withinRange } from '../collect.ts';

/**
 * Hochschule für Musik und Theater München.
 *
 * Die Seite `/veranstaltungen/` bringt keinen einzigen Termin mit – sie lädt
 * die Liste über das eigene Filterwerkzeug des Themes nach:
 *
 *   POST /wp-admin/admin-ajax.php
 *        action=apply_event_filter & nonce=… & paged=N & show_prev_pages=true
 *        & date_from=YYYY-MM-DD 00:00:00 & date_to=YYYY-MM-DD 23:59:59
 *
 * Drei Eigenheiten bestimmen den Aufbau hier:
 *
 * 1. **Der Nonce wird geprüft.** Ohne ihn ist die Antwort leer – kein Fehler,
 *    kein JSON, nichts. Er steht offen im Seitenkopf (`var event_filter`),
 *    also wird die Seite einmal je Abruf gelesen. Dieselbe Seite trägt in der
 *    Filterleiste auch die Namen der Gattungen.
 * 2. **`show_prev_pages` macht `paged` kumulativ**: `paged=N` liefert die
 *    Seiten 1 bis N in einer Antwort. Ein grosszügiges `paged` holt damit
 *    einen ganzen Monat auf einmal, statt zwölfmal zu blättern.
 * 3. **`date_to` braucht die Uhrzeit.** Mit `… 00:00:00` fehlt der letzte Tag
 *    des Monats komplett; erst `23:59:59` nimmt ihn mit.
 *
 * Die Gattung führt die Liste nicht mit. Sie kommt aus der offenen
 * REST-Schnittstelle, die genau die kommenden Termine herausgibt – also den
 * Zeitraum, den der Kalender ohnehin zeigt. Vergangene Termine laufen ohne
 * Gattung, dafür greift `defaultCategory`.
 */

const BASE = 'https://hmtm.de';
const LIST_PAGE = `${BASE}/veranstaltungen/`;
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const TYPES_REST = `${BASE}/wp-json/wp/v2/events?per_page=100&_fields=id,link,Veranstaltungsart`;
/** `per_page` deckelt die Schnittstelle bei 100 – ein Semester ist mehr. */
const TYPES_PAGE_SIZE = 100;
const TYPES_PAGES_MAX = 12;

/** Die Liste zählt zwölf Termine je Seite; 40 Seiten sind 480 im Monat. */
const PAGES = 40;
/** Reicht das nicht, wird einmal deutlich grösser nachgefragt. */
const PAGES_MAX = 400;

const AJAX_HEADERS = {
  accept: 'application/json, text/javascript, */*; q=0.01',
  'x-requested-with': 'XMLHttpRequest',
  referer: LIST_PAGE,
};

export const hmtm: EventSource = {
  definition: {
    id: 'hmtm',
    name: 'Hochschule für Musik und Theater',
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

    // Ohne Nonce antwortet die Quelle auf nichts – das ist kein Teilausfall.
    const page = await fetchText(LIST_PAGE, { signal, timeoutMs: options?.requestTimeoutMs });
    const nonce = parseNonce(page);
    if (!nonce) throw new Error('Kein Filter-Nonce auf /veranstaltungen/ (Seite geändert?)');
    const types = parseEventTypes(page);

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    const events = (
      await settleParts({
        sourceId: 'hmtm',
        parts: months,
        load: async (month) => {
          let pages = PAGES;
          let result = await loadMonth(month, nonce, pages, signal, options);

          // Ein Monat mit mehr als 480 Terminen ist nicht vorgesehen, aber
          // stillschweigend abschneiden wäre die schlechtere Antwort.
          while (result.hasMore && pages < PAGES_MAX) {
            pages = Math.min(pages * 4, PAGES_MAX);
            result = await loadMonth(month, nonce, pages, signal, options);
          }
          if (result.hasMore) {
            console.warn(`[hmtm] ${month}: Liste reicht über ${pages} Seiten hinaus – womöglich abgeschnitten`);
          }

          // Die ausdrückliche Leermeldung ist eine gültige Auskunft; eine
          // Antwort mit Inhalt, aber ohne Terminblock heisst: Aufbau geändert.
          assertRecognised(result.events.length, result.empty, month);
          if (result.skipped > 0) {
            console.warn(`[hmtm] ${month}: ${result.skipped} Block/Blöcke übersprungen`);
          }

          return result.events;
        },
      })
    ).flat();

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return applyEventTypes(filtered, await loadTypeAssignments(signal, options), types);
  },
};

async function loadMonth(
  month: string,
  nonce: string,
  pages: number,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<ParseResult> {
  const body = await fetchText(AJAX, {
    signal,
    timeoutMs: options?.requestTimeoutMs,
    headers: AJAX_HEADERS,
    body: filterBody(month, nonce, pages),
  });

  // Genau so sieht ein abgelaufener Nonce aus: HTTP 200, leerer Rumpf.
  if (body.trim() === '') throw new Error(`${month}: leere Antwort (Nonce abgelaufen?)`);

  return parseMonthResponse(body);
}

function filterBody(month: string, nonce: string, pages: number): string {
  return new URLSearchParams({
    action: 'apply_event_filter',
    nonce,
    show_prev_pages: 'true',
    paged: String(pages),
    search_term: '',
    date_from: `${month}-01 00:00:00`,
    date_to: `${month}-${lastDayOfMonth(month)} 23:59:59`,
    genre: '0',
    type: '0',
    place: '0',
    field: '0',
  }).toString();
}

/**
 * Gattungen sind Beiwerk: fehlen sie, greift `defaultCategory`. Ein Ausfall
 * hier darf den Spielplan nicht mitreissen.
 */
async function loadTypeAssignments(
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<Map<string, number[]>> {
  const assignments = new Map<string, number[]>();

  try {
    for (let page = 1; page <= TYPES_PAGES_MAX; page++) {
      const body = await fetchText(`${TYPES_REST}&page=${page}`, {
        signal,
        retries: 0,
        timeoutMs: options?.requestTimeoutMs,
        headers: { accept: 'application/json' },
      });

      const batch = parseTypeAssignments(body);
      for (const [url, terms] of batch) assignments.set(url, terms);
      if (batch.size < TYPES_PAGE_SIZE) break;
    }
  } catch (error) {
    console.warn(`[hmtm] Gattungen nicht lesbar: ${errorMessage(error)}`);
  }

  return assignments;
}

function lastDayOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return String(new Date(Date.UTC(year, m, 0)).getUTCDate());
}

export default hmtm;
