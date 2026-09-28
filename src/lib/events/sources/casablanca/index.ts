import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseDetailDescription, parseProgramme } from './parse.ts';

/**
 * Casablanca Kino Oldenburg – Programmkino mit vier Sälen.
 *
 * Die Startseite trägt das ganze veröffentlichte Programm in einer Antwort;
 * Programmtexte kommen von den Filmseiten, einmal je Film.
 */

const BASE = 'https://www.casablanca-kino.de';

export const casablanca: EventSource = {
  definition: {
    id: 'casablanca',
    name: 'Casablanca Kino',
    cityId: 'oldenburg',
    group: 'Kino',
    defaultCategory: 'Kino',
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
    const { events, skipped, empty } = parseProgramme(html);
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[casablanca] ${skipped} Vorstellung(en) übersprungen`);

    return enrichEventDescriptions({
      sourceId: 'casablanca',
      events: events.filter((event) => withinRange(event.start, range)),
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      concurrency: 2,
    });
  },
};

export default casablanca;
