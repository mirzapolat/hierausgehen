import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TZ } from '../../time.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseEventsPage } from './parse.ts';

/**
 * Kino am Olympiasee – Open-Air-Kino und Sommer-Events im Olympiapark.
 *
 * Die oeffentliche Liste unter `/events/` enthaelt die kommenden Vorstellungen
 * als serverseitig gerenderte Avada-Post-Cards. Ein Monatsparameter wurde
 * nicht gefunden; bekannte Query-Parameter wie `?pno=2` liefern dieselbe
 * Seite. Deshalb wird die Liste einmal geladen und auf den angefragten
 * Zeitraum gefiltert. Vergangene Monate fragt der Adapter nicht an, weil die
 * Seite nur die aktuelle Saison nach vorne zeigt.
 */

const BASE = 'https://kinoamolympiasee.de';
const EVENTS_PAGE = `${BASE}/events/`;

export const kinoamolympiasee: EventSource = {
  definition: {
    id: 'kinoamolympiasee',
    name: 'Kino am Olympiasee',
    cityId: 'muenchen',
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

    const html = await fetchText(EVENTS_PAGE, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const { events, skipped, empty } = parseEventsPage(html);

    if (!empty && events.length === 0) {
      throw new Error('Kein Termin erkannt (Layout geändert?)');
    }
    if (skipped > 0) {
      console.warn(`[kinoamolympiasee] ${skipped} Block/Blöcke übersprungen`);
    }

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'kinoamolympiasee',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      concurrency: 2,
    });
  },
};

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

export default kinoamolympiasee;
