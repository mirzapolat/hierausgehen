import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { dedupeById, settleParts, withinRange } from '../collect.ts';
import { enrichEventDetails } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseCalendar, parseProductionDetail } from './parse.ts';

/**
 * Deutsche Oper am Rhein – nur der Düsseldorfer Spielplan.
 *
 *   GET https://www.operamrhein.de/spielplan/kalender/{YYYY-MM}/duesseldorf
 *
 * Ein Monat je Abruf, ohne JavaScript und ohne Paging. Das Haus spielt auch
 * in Duisburg; der Pfadteil `duesseldorf` lässt diese Termine weg.
 *
 * Die Seite klemmt jeden Monat auf ihr Ladefenster (Spielzeitbeginn bis zum
 * letzten angekündigten Termin) und liefert ausserhalb davon einen anderen
 * Zeitraum statt eines leeren. Darum wird nach dem angefragten Zeitraum
 * gefiltert; ein Monat vor Spielzeitbeginn kommt als leerer Container.
 *
 * Programmtext, Sprache, Dauer und Altersempfehlung stehen auf der
 * Produktionsseite – einmal je Produktion geladen, nicht je Vorstellung.
 */

const BASE = 'https://www.operamrhein.de';

export const operamrhein: EventSource = {
  definition: {
    id: 'operamrhein',
    name: 'Deutsche Oper am Rhein',
    cityId: 'duesseldorf',
    group: 'Oper & Ballett',
    // Führungen und Gesprächsformate tragen keine eigene Gattung.
    defaultCategory: 'Oper & Ballett',
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

    const events = (
      await settleParts({
        sourceId: 'operamrhein',
        parts: months,
        load: async (month) => {
          const html = await fetchText(`${BASE}/spielplan/kalender/${month}/duesseldorf`, {
            signal,
            timeoutMs: options?.requestTimeoutMs,
          });
          const { events, skipped, empty } = parseCalendar(html);
          assertRecognised(events.length, empty, `Kalender ${month}`);
          if (skipped > 0) console.warn(`[operamrhein] ${month}: ${skipped} Termin(e) übersprungen`);
          return events;
        },
      })
    ).flat();

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDetails({
      sourceId: 'operamrhein',
      events: filtered,
      signal,
      fetchOptions: options,
      parse: parseProductionDetail,
      cacheKey: productionKey,
    });
  },
};

/**
 * `/spielplan/kalender/2026-11/duesseldorf/die-meistersinger-von-nuernberg/3707/`
 * → `die-meistersinger-von-nuernberg`: dieselbe Produktionsseite für alle
 * Vorstellungen und Monate.
 */
function productionKey(event: CalendarEvent): string | undefined {
  return event.url.match(/\/duesseldorf\/([^/]+)\/\d+\/?$/)?.[1];
}

export default operamrhein;
