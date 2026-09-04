import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import {
  HOMEPAGE,
  LIST_URL,
  SOURCE_ID,
  type ShowCard,
  announcedEvent,
  overlapsRange,
  parseDescription,
  parseListPage,
  parsePerformances,
} from './parse.ts';

/**
 * Pavilion Theatre Glasgow (Trafalgar Tickets).
 *
 * Varieté-Haus an der Renfield Street, seit 1904 im Betrieb und bis heute ein
 * Gastspielhaus: Tribute-Bands, Stand-up, schottische Komödie, Musicals auf
 * Tournee und im Winter die eigene Pantomime. Verkauft wird über die Plattform
 * von Trafalgar Entertainment.
 *
 *     GET https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB/whats-on
 *     GET https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB/event/<art>/<stück>
 *
 * Die Übersicht nennt die **Stücke** samt Laufzeit, Gattung, Preis ab und den
 * Ticketsignalen – aber keinen einzigen Anfangszeitpunkt und keinen Parameter
 * für den Zeitraum. Sie wird deshalb ganz geholt; welche Stücke der angefragte
 * Monat überhaupt betrifft, entscheidet die Laufzeit. Erst die Produktionsseite
 * nennt die **Abende**, und zwar alle: für die Pantomime achtundsechzig, wo die
 * Karte nur „Thu 26 Nov 2026 - Sun 10 Jan 2027" schreibt. Ein Abruf je Stück,
 * keiner für ein Stück ausserhalb des Zeitraums.
 *
 * Zur `robots.txt`: `Allow: /`, nichts gesperrt.
 */

/** Rücksicht auf die Quelle: nie mehr als so viele Seiten gleichzeitig. */
const SHOW_CONCURRENCY = 4;

export const pavilionGlasgow: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Pavilion Theatre Glasgow',
    cityId: 'glasgow',
    group: 'Theater',
    // Jedes Stück führt seine eigene Gattung; der Fallback greift nur, wenn
    // die Übersicht einmal keine mitliefert.
    defaultCategory: 'Theater',
    homepage: HOMEPAGE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    // Ein Ticketshop führt keine gespielten Abende. Ein vergangener Monat ist
    // deshalb kein Ausfall, sondern schlicht leer – und kostet keinen Abruf.
    const today = new Date().toISOString().slice(0, 10);
    if (range.to < today) return [];

    const list = parseListPage(
      await fetchText(LIST_URL, { signal, timeoutMs: options?.requestTimeoutMs }),
    );
    // Die Übersicht ohne ein einziges Stück heisst: die Nutzlast sieht anders
    // aus als gedacht. Werfen, damit die Aggregation den Cache ausliefert.
    if (!list.recognised) throw new Error('Keine Stücke in der Übersicht (Layout geändert?)');

    const shows = list.shows.filter((show) => overlapsRange(show, range.from, range.to));
    if (shows.length === 0) return [];

    const events = await loadPerformances(shows, signal, options);

    const seen = new Set<string>();
    return events.filter((event) => {
      const day = event.start.slice(0, 10);
      if (day < range.from || day > range.to || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  },
};

/**
 * Zu jedem Stück die Abende holen.
 *
 * Einzelne Ausfälle sind hinnehmbar – das Stück fehlt dann eben. Fällt aber
 * *jede* Seite aus, ist die Plattform weg und die Quelle muss sich als kaputt
 * melden, statt still einen leeren Monat zu behaupten.
 */
async function loadPerformances(
  shows: ShowCard[],
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let failed = 0;

  for (let index = 0; index < shows.length; index += SHOW_CONCURRENCY) {
    const batch = shows.slice(index, index + SHOW_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((show) => fetchText(show.url, { signal, timeoutMs: options?.requestTimeoutMs })),
    );
    results.forEach((result, offset) => {
      const show = batch[offset];
      if (result.status === 'rejected') {
        failed++;
        console.warn(`[${SOURCE_ID}] ${show.url}: ${message(result.reason)}`);
        return;
      }
      events.push(...performancesOf(result.value, show));
    });
  }

  if (failed === shows.length) {
    throw new Error(`Keine der ${shows.length} Produktionsseiten lesbar`);
  }
  return events;
}

/**
 * Die Abende einer Produktionsseite – und der Rückfall, wenn es keine gibt.
 *
 * Ein Stück, dessen Vorverkauf noch nicht begonnen hat, trägt keinen
 * `schema.org`-Block. Es steht trotzdem im Spielplan des Hauses, mit Tag und
 * Uhrzeit auf der Karte; es wegzulassen wäre eine Lücke, die die Quelle nicht
 * hat.
 */
function performancesOf(html: string, show: ShowCard): CalendarEvent[] {
  const performances = parsePerformances(html, show);
  if (performances.length > 0) return performances;

  const announced = announcedEvent(show, parseDescription(html));
  if (!announced) {
    console.warn(`[${SOURCE_ID}] ${show.url}: kein Termin erkennbar`);
    return [];
  }
  return [announced];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default pavilionGlasgow;
