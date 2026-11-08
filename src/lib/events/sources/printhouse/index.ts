import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { assertRecognised } from '../page.ts';
import { parseEvents, SOURCE_ID } from './parse.ts';

/**
 * Host der Gästeliste, die printhousemunich.com/events als iframe einbettet.
 * Ändert sich die Einbettung (anderer Host), schlägt der Abruf fehl – dann
 * hier den neuen `src` des iframes `#ph-tickets` eintragen.
 */
const API = 'https://gaesteliste.89-167-86-84.sslip.io/api/public/events';

export const printhouseSource: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Printhouse',
    cityId: 'muenchen',
    group: 'Club',
    defaultCategory: 'Clubnacht',
    homepage: 'https://www.printhousemunich.com/events',
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    // Die API kennt nur kommende Termine: Zeiträume ganz in der Vergangenheit gar nicht anfragen.
    if (range.to < today()) return [];

    const json = await fetchText(API, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
      headers: { accept: 'application/json' },
    });
    const { events, skipped, empty } = parseEvents(json);
    assertRecognised(events.length, empty, 'Printhouse');
    if (skipped > 0) console.warn(`[${SOURCE_ID}] ${skipped} Eintrag/Einträge übersprungen`);
    return events.filter((event) => withinRange(event.start, range));
  },
};
