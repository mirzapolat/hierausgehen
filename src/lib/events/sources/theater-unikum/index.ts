import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { dedupeById, today, withinRange } from '../collect.ts';
import { enrichEventDetails } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseDetailPage, parseListPage } from './parse.ts';

/**
 * Theater Unikum – die Studiobühne des Studierendenwerks Oldenburg, zwei
 * Bühnen am Uhlhornsweg.
 *
 * Der Spielplan kommt seitenweise (zehn Termine, `?pno=N`), aufsteigend nach
 * Datum und nur Kommendes. Geblättert wird nacheinander, bis keine weitere
 * Seite folgt oder die Seite hinter dem gefragten Zeitraum liegt – ein Blick
 * in den nächsten Monat kostet deshalb meist nur eine oder zwei Seiten.
 *
 * Programmtext und Eintritt stehen auf der Stückseite; mehrere Termine eines
 * Stücks teilen sie sich und laden sie einmal.
 */

const BASE = 'https://www.theater-unikum.de';
const LIST = `${BASE}/spielplan/`;
/** Sicherung gegen eine Seitenleiste, die nie endet. */
const MAX_PAGES = 20;

export const theaterUnikum: EventSource = {
  definition: {
    id: 'theater-unikum',
    name: 'Theater Unikum',
    cityId: 'oldenburg',
    group: 'Theater',
    defaultCategory: 'Theater',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    if (range.to < today()) return [];

    const events: CalendarEvent[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchText(page === 1 ? LIST : `${LIST}?pno=${page}`, {
        signal,
        timeoutMs: options?.requestTimeoutMs,
      });
      const result = parseListPage(html);

      assertRecognised(result.events.length, result.empty, `Spielplan Seite ${page}`);
      if (result.skipped > 0) console.warn(`[theater-unikum] Seite ${page}: ${result.skipped} Termin(e) übersprungen`);
      events.push(...result.events);

      const last = result.events.at(-1);
      if (!result.hasNext || !last || last.start.slice(0, 10) > range.to) break;
    }

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDetails({
      sourceId: 'theater-unikum',
      events: filtered,
      signal,
      fetchOptions: options,
      parse: parseDetailPage,
      concurrency: 2,
    });
  },
};

export default theaterUnikum;
