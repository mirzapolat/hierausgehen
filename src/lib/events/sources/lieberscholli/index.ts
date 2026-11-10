import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { assertRecognised } from '../page.ts';
import { BASE, SOURCE_ID, parseEventTable } from './parse.ts';

/**
 * Lieber Scholli über ihren ticket.io-Shop. Eine Seite
 * für alles, was im Vorverkauf ist; der Zeitraum wird lokal gefiltert.
 * Vergangenes kennt der Shop nicht, frühere Zeiträume bleiben leer.
 */
export const lieberScholliSource: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Lieber Scholli',
    cityId: 'muenchen',
    group: 'Club',
    defaultCategory: 'Clubnacht',
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

    const html = await fetchText(`${BASE}/?view=table`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const { events, skipped, empty } = parseEventTable(html);
    assertRecognised(events.length, empty, 'Lieber Scholli (ticket.io)');
    if (skipped > 0) console.warn(`[${SOURCE_ID}] ${skipped} Zeile(n) übersprungen`);

    return events.filter((event) => withinRange(event.start, range));
  },
};
