import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseSchedulePage } from './parse.ts';

/**
 * Muenchner Volkstheater.
 *
 * Der Spielplan liegt als vollstaendig server-gerenderte Seite unter:
 *
 *   GET https://www.muenchner-volkstheater.de/programm/spielplan
 *
 * Monatsparameter werden ignoriert; JSON-, ICS- oder Fragment-Endpunkte fuer
 * die gesamte Liste waren nicht sichtbar. Deshalb holt der Adapter eine Seite,
 * parst alle veroeffentlichten Termine und filtert anschliessend lokal.
 */

const BASE = 'https://www.muenchner-volkstheater.de';

export const volkstheater: EventSource = {
  definition: {
    id: 'volkstheater',
    name: 'Münchner Volkstheater',
    cityId: 'muenchen',
    group: 'Theater',
    defaultCategory: 'Theater',
    color: '#C7342F',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const html = await fetchText(`${BASE}/programm/spielplan`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty } = parseSchedulePage(html, range.from.slice(0, 7));
    if (events.length === 0 && !empty) {
      throw new Error('Spielplan: kein Termin erkannt (Layout geaendert?)');
    }
    if (skipped > 0) {
      console.warn(`[volkstheater] ${skipped} Termin(e) uebersprungen`);
    }

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'volkstheater',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      cacheKey: productionKey,
    });
  },
};

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

function productionKey(event: CalendarEvent): string | undefined {
  try {
    const url = new URL(event.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return event.url;
  }
}

export default volkstheater;
