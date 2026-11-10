import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { withinRange } from '../collect.ts';
import { assertRecognised } from '../page.ts';
import { BASE, parseEventsPage, SOURCE_ID } from './parse.ts';

/**
 * Friends Studios – Community-Abende in München (Dinner, Partys, Open Stage).
 * Eine Seite enthält alle kommenden Termine; der Zeitraum wird lokal gefiltert.
 * Vergangene Termine kennt das Widget nicht.
 */
export const friendsStudiosSource: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Friends Studios',
    cityId: 'muenchen',
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
    const html = await fetchText(`${BASE}/events`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const { events, skipped, empty, hasMore } = parseEventsPage(html);
    assertRecognised(events.length, empty, 'Friends Studios');
    if (skipped > 0) console.warn(`[${SOURCE_ID}] ${skipped} Termin(e) übersprungen`);
    if (hasMore) console.warn(`[${SOURCE_ID}] Widget kündigt weitere Termine an, die nicht geladen werden`);
    return events.filter((event) => withinRange(event.start, range));
  },
};
