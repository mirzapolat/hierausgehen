import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { assertRecognised } from '../page.ts';
import { parseEvents } from './parse.ts';

/**
 * Wilhelm13 – Musik und Literatur für Oldenburg e.V.
 *
 * Die Startseite führt alle kommenden Veranstaltungen in einer Antwort,
 * beim Schreiben dieses Adapters zehn Monate am Stück. Einen Parameter für
 * den Zeitraum gibt es nicht und braucht es nicht; der Zuschnitt passiert
 * hier. Programmtexte stehen schon im JSON der Karten, Detailseiten gibt es
 * keine – ein Abruf je Aktualisierung.
 *
 * Vergangenes führt die Seite nicht.
 */

const BASE = 'https://wilhelm13.de';

export const wilhelm13: EventSource = {
  definition: {
    id: 'wilhelm13',
    name: 'Wilhelm13',
    cityId: 'oldenburg',
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
    if (range.to < today()) return [];

    const html = await fetchText(`${BASE}/`, { signal, timeoutMs: options?.requestTimeoutMs });
    const { events, skipped, empty } = parseEvents(html);

    assertRecognised(events.length, empty, 'Startseite');
    if (skipped > 0) console.warn(`[wilhelm13] ${skipped} Karte(n) übersprungen`);

    return events.filter((event) => withinRange(event.start, range));
  },
};

export default wilhelm13;
