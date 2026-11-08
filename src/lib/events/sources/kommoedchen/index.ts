import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseDetailDescription, parseSpielplan } from './parse.ts';

/**
 * Kom(m)ödchen – Kabarett in der Düsseldorfer Altstadt.
 *
 *   GET https://www.kommoedchen.de/spielplan/
 *
 * Eine Seite mit dem ganzen kommenden Spielplan (rund fünf Monate), ohne
 * Paging und ohne Zeitraum-Parameter; gefiltert wird lokal. Vergangenes zeigt
 * die Seite nicht. Den Programmtext liefert die Seite des Programms
 * (`/spielplan/<slug>/`), die mehrere Termine teilen und die gecacht wird.
 */

const BASE = 'https://www.kommoedchen.de';

export const kommoedchen: EventSource = {
  definition: {
    id: 'kommoedchen',
    name: 'Kom(m)ödchen',
    cityId: 'duesseldorf',
    group: 'Theater',
    defaultCategory: 'Kabarett',
    homepage: `${BASE}/`,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    if (range.to < today()) return [];

    const html = await fetchText(`${BASE}/spielplan/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const { events, skipped, empty } = parseSpielplan(html);
    assertRecognised(events.length, empty, 'Spielplan');
    if (skipped > 0) console.warn(`[kommoedchen] ${skipped} Termin(e) übersprungen`);

    return enrichEventDescriptions({
      sourceId: 'kommoedchen',
      events: events.filter((event) => withinRange(event.start, range)),
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
    });
  },
};

export default kommoedchen;
