import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { enrichEventDetails } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseEventDetail, parseProgramme } from './parse.ts';

/**
 * zakk – Zentrum für Aktion, Kultur und Kommunikation.
 *
 *   GET https://zakk.de/programm/alle
 *
 * Eine Seite mit dem ganzen kommenden Programm (gut ein Jahr im Voraus),
 * ohne Paging und ohne Zeitraum-Parameter. Vergangenes zeigt die Seite
 * nicht; liegt der angefragte Zeitraum ganz in der Vergangenheit, wird gar
 * nicht erst abgerufen.
 *
 * Die Liste führt nur einen Anriss; der volle Text und der Veranstalter
 * stehen auf der Seite des Termins (`/event-detail?event={id}`), die
 * gecacht und mit begrenztem Zeitbudget nachgeladen wird.
 */

const BASE = 'https://zakk.de';

export const zakk: EventSource = {
  definition: {
    id: 'zakk',
    name: 'zakk',
    cityId: 'duesseldorf',
    group: 'Kultur',
    defaultCategory: 'Kultur',
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

    const html = await fetchText(`${BASE}/programm/alle`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const { events, skipped, empty } = parseProgramme(html);
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[zakk] ${skipped} Termin(e) übersprungen`);

    return enrichEventDetails({
      sourceId: 'zakk',
      events: events.filter((event) => withinRange(event.start, range)),
      signal,
      fetchOptions: options,
      parse: parseEventDetail,
    });
  },
};

export default zakk;
