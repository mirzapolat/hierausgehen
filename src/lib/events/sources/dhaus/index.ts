import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { dedupeById, settleParts, today, withinRange } from '../collect.ts';
import { enrichEventDetails } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseProductionDetail, parseSchedule } from './parse.ts';

/**
 * D'haus – Düsseldorfer Schauspielhaus (Schauspielhaus, Central, Junges
 * Schauspiel, Stadt:Kollektiv).
 *
 *   GET https://www.dhaus.de/programm/spielplan/{YYYY-MM}/
 *
 * Ein Monat je Abruf, ohne JavaScript. Die Seite kennt keine Vergangenheit:
 * ein vergangener Monat liefert den laufenden ab heute. Solche Monate werden
 * gar nicht erst angefragt; jenseits des Vorverkaufs klemmt die Seite auf die
 * letzten angekündigten Tage, was der Filter auf den Zeitraum auffängt.
 *
 * Programmtext und Dauer stehen auf der Produktionsseite – einmal je
 * Produktion geladen.
 */

const BASE = 'https://www.dhaus.de';

export const dhaus: EventSource = {
  definition: {
    id: 'dhaus',
    name: "D'haus",
    cityId: 'duesseldorf',
    group: 'Theater',
    // Gastspiele, Führungen und Formate des Hauses ohne Sparte.
    defaultCategory: 'Theater',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const current = today().slice(0, 7);
    const from = range.from.slice(0, 7) < current ? current : range.from.slice(0, 7);
    const to = range.to.slice(0, 7);
    if (from > to) return [];

    const events = (
      await settleParts({
        sourceId: 'dhaus',
        parts: monthsInRange(from, to),
        load: async (month) => {
          const html = await fetchText(`${BASE}/programm/spielplan/${month}/`, {
            signal,
            timeoutMs: options?.requestTimeoutMs,
          });
          const { events, skipped, empty } = parseSchedule(html);
          assertRecognised(events.length, empty, `Spielplan ${month}`);
          if (skipped > 0) console.warn(`[dhaus] ${month}: ${skipped} Termin(e) übersprungen`);
          return events;
        },
      })
    ).flat();

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDetails({
      sourceId: 'dhaus',
      events: filtered,
      signal,
      fetchOptions: options,
      parse: parseProductionDetail,
      cacheKey: productionKey,
    });
  },
};

/**
 * `/programm/spielplan/inter-alia/3064/` und – so verlinken die Monatsseiten –
 * `/programm/spielplan/2026-11/inter-alia/3064/` → `inter-alia`.
 */
function productionKey(event: CalendarEvent): string | undefined {
  return event.url.match(/\/programm\/spielplan\/(?:\d{4}-\d{2}\/)?([^/]+)\/\d+\/?$/)?.[1];
}

export default dhaus;
