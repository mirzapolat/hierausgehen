import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { assertRecognised } from '../page.ts';
import { BASE, LIST_URL, SOURCE_ID, parseEventsPage } from './parse.ts';

/**
 * Backstage München — Konzerte, Partys und Fussball-Übertragungen im
 * Backstage (Club, Halle, Werk, Werkstatt …) und bei Gastspielen in anderen
 * Münchner Hallen (Zenith, TonHalle, Technikum).
 *
 * Eine Seite für alles: `/events` trägt die nächsten 200 Termine (rund drei
 * Monate) in den Daten des Server-Renderings; der Zeitraum wird lokal
 * gefiltert. Was dahinter liegt, lädt der Browser direkt aus dem Backend nach
 * (`/api/` ist per robots.txt gesperrt) — das holt dieser Adapter nicht.
 * Vergangenes kennt die Seite nicht.
 */
export const backstageSource: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Backstage',
    cityId: 'muenchen',
    group: 'Konzert',
    defaultCategory: 'Konzert',
    concerts: 'Konzert',
    homepage: `${BASE}/events`,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    if (range.to < today()) return [];

    const html = await fetchText(LIST_URL, { signal, timeoutMs: options?.requestTimeoutMs });
    const { events, skipped, empty, total, loaded } = parseEventsPage(html);
    assertRecognised(events.length, empty, 'Backstage-Programm');
    if (skipped > 0) console.warn(`[${SOURCE_ID}] ${skipped} Datensatz/Datensätze übersprungen`);
    if (total > loaded && events.length > 0) {
      const horizon = events[events.length - 1].start.slice(0, 10);
      if (range.to > horizon) {
        console.warn(`[${SOURCE_ID}] Seite trägt ${loaded} von ${total} Terminen, Abdeckung bis ${horizon}`);
      }
    }

    return events.filter((event) => withinRange(event.start, range));
  },
};
