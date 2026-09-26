import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseSchedulePage } from './parse.ts';
import { assertRecognised } from '../page.ts';
import { dedupeById, settleParts, withinRange } from '../collect.ts';

/**
 * Residenztheater München (Residenztheater, Cuvilliéstheater, Marstall).
 *
 * Der Spielplan liegt pro Monat unter:
 *
 *   GET https://www.residenztheater.de/spielplan?month={YYYY-MM}
 *
 * Die Seite liefert den vollständigen Monat ohne JavaScript; die
 * Blätter-Elemente führen nur zum Vor- und Folgemonat, nicht zu weiteren
 * Seiten. Einen leichteren Endpunkt (JSON, Fragment, ICS-Feed für den ganzen
 * Spielplan) gibt es nicht – nur einen `.ics`-Link je Termin.
 *
 * Zwei Eigenheiten:
 * - Das Jahr steht bei keinem Termin, nur Tag und Monatskürzel ("Do. 1 Okt").
 *   Es ergibt sich aus dem angefragten Monat, siehe `parse.ts`.
 * - Kommende Monate sind erst mit Beginn ihres Vorverkaufs gefüllt; bis dahin
 *   stehen dort nur einzelne, bereits angekündigte Premieren. Ein fast leerer
 *   Monat ist also normal und kein Fehler.
 */

const BASE = 'https://www.residenztheater.de';

export const residenztheater: EventSource = {
  definition: {
    id: 'residenztheater',
    name: 'Residenztheater',
    cityId: 'muenchen',
    group: 'Theater',
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
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7));

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    const events = (
      await settleParts({
        sourceId: 'residenztheater',
        parts: months,
        load: async (month) => {
          const html = await fetchText(`${BASE}/spielplan?month=${month}`, {
            signal,
            timeoutMs: options?.requestTimeoutMs,
          });
          const { events, skipped, empty } = parseSchedulePage(html, month);

          // Fehlt die Liste ganz, hat sich der Aufbau der Seite geändert. Ein
          // leerer, aber vorhandener Container ist dagegen ein normaler Monat.
          assertRecognised(events.length, empty, `Spielplan ${month}`);
          if (skipped > 0) {
            console.warn(`[residenztheater] ${month}: ${skipped} Termin(e) übersprungen`);
          }
          return events;
        },
      })
    ).flat();

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'residenztheater',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      cacheKey: productionKey,
    });
  },
};

function productionKey(event: CalendarEvent): string | undefined {
  try {
    const url = new URL(event.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return event.url;
  }
}

export default residenztheater;
