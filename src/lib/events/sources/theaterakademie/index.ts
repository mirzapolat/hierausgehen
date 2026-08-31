import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import {
  parseDetailDescription,
  parseProgrammePage,
  theaterakademieBaseUrl as BASE,
  theaterakademieProgrammeUrl as PROGRAMME_URL,
} from './parse.ts';

/**
 * Bayerische Theaterakademie August Everding (Prinzregententheater).
 *
 * Der Spielplan liegt vollständig server-gerendert unter:
 *
 *   GET https://theaterakademie.de/de/theater/programm
 *
 * Monatsparameter (`tx_calendarize_calendar[month]`) ändern die Antwort nicht,
 * einen JSON- oder Fragment-Endpunkt gibt es nicht: die Filter der Seite
 * arbeiten im Browser auf einer eingebetteten Kopie der Liste. Der Adapter holt
 * deshalb eine Seite, parst die ganze Spielzeit und filtert lokal.
 *
 * Die Quelle führt keine Gattung pro Termin – die Veranstaltungsart kommt aus
 * `defaultCategory`. Vergangene Spielzeiten liegen nicht auf dieser Seite.
 */

const SOURCE_ID = 'theaterakademie';

export const theaterakademie: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Theaterakademie August Everding',
    cityId: 'muenchen',
    group: 'Theater',
    defaultCategory: 'Theater',
    color: '#3F6E8C',
    homepage: PROGRAMME_URL,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const html = await fetchText(PROGRAMME_URL, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty, described } = parseProgrammePage(html);
    if (events.length === 0 && !empty) {
      throw new Error('Spielplan: kein Termin erkannt (Layout geändert?)');
    }
    if (skipped > 0) {
      console.warn(`[${SOURCE_ID}] ${skipped} Eintrag/Einträge übersprungen`);
    }

    const filtered = events.filter((event) => withinRange(event.start, range));
    const withOwnPage = new Set(described);
    return enrichEventDescriptions({
      sourceId: SOURCE_ID,
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      cacheKey: productionKey,
      fetchUrl: (event) => (withOwnPage.has(event.url) ? event.url : undefined),
    });
  },
};

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

/**
 * Mehrere Abende derselben Produktion teilen sich eine Seite – der Detailtext
 * wird darum je Produktion geholt, nicht je Vorstellung.
 */
function productionKey(event: CalendarEvent): string | undefined {
  return event.url.startsWith(BASE) ? event.url : undefined;
}

export default theaterakademie;
