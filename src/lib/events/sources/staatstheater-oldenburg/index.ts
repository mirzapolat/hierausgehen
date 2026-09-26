import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { dedupeById, settleParts, today, withinRange } from '../collect.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseCalendarMonths, parseCalendarPage, parseDetailDescription } from './parse.ts';

/**
 * Oldenburgisches Staatstheater – Musiktheater, Schauspiel, Ballett, Konzert,
 * Junges Staatstheater, Niederdeutsch und Sparte 7 in einem Kalender.
 *
 * `/kalender?monat=MMYYYY` liefert einen ganzen Monat serverseitig gerendert.
 * Die Links der Seite tragen zusätzlich einen `cHash`; den braucht die Seite
 * nicht, und `robots.txt` sperrt solche Adressen – deshalb ohne.
 *
 * Welche Monate es gibt, sagt die Monatsleiste der Startseite des Kalenders:
 * ausserhalb der freigeschalteten Spielzeit antwortet die Seite mit einem
 * Serverfehler. Vergangene Monate zeigt sie nicht mehr.
 */

const BASE = 'https://staatstheater.de';
const CALENDAR = `${BASE}/kalender`;

export const staatstheaterOldenburg: EventSource = {
  definition: {
    id: 'staatstheater-oldenburg',
    name: 'Oldenburgisches Staatstheater',
    cityId: 'oldenburg',
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
    const current = today().slice(0, 7);
    if (range.to.slice(0, 7) < current) return [];

    const overview = await fetchText(CALENDAR, { signal, timeoutMs: options?.requestTimeoutMs });
    const offered = parseCalendarMonths(overview);
    if (offered.length === 0) throw new Error('Kalender: keine Monatsleiste (Layout geändert?)');

    const available = new Set(offered);
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7)).filter(
      (month) => month >= current && available.has(month),
    );

    // Nacheinander: ein Stadttheater, kein Ticketportal.
    const events = (
      await settleParts({
        sourceId: 'staatstheater-oldenburg',
        parts: months,
        sequential: true,
        load: async (month) => {
          const [year, mm] = month.split('-');
          const html = await fetchText(`${CALENDAR}?monat=${mm}${year}`, {
            signal,
            timeoutMs: options?.requestTimeoutMs,
          });
          const { events, skipped, excluded, empty } = parseCalendarPage(html);

          assertRecognised(events.length + excluded, empty, `Kalender ${month}`);
          if (skipped > 0) {
            console.warn(`[staatstheater-oldenburg] ${month}: ${skipped} Vorstellung(en) übersprungen`);
          }
          return events;
        },
      })
    ).flat();

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'staatstheater-oldenburg',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      // Nur die eigenen Produktionsseiten tragen einen Programmtext.
      fetchUrl: (event) => (event.url.startsWith(`${BASE}/programm/`) ? event.url : undefined),
      concurrency: 2,
    });
  },
};

export default staatstheaterOldenburg;
