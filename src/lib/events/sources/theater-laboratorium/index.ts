import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { dedupeById, settleParts, today, withinRange } from '../collect.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseDetailDescription, parseMonth, parseOfferedMonths } from './parse.ts';

/**
 * Theater Laboratorium Oldenburg – Figuren- und Schauspieltheater im eigenen
 * Haus und in der Limonadenfabrik, dazu Konzerte.
 *
 * `/index.php?r=site/calender&month_id=M` liefert einen Monat serverseitig
 * gerendert. Die Adresse kennt nur die Monatsnummer; welche Monate es gibt,
 * sagt die Monatsleiste (beim Schreiben: der laufende und drei weitere). Das
 * Jahr ergibt sich daraus, dass die Leiste nur nach vorn blickt: eine Nummer
 * kleiner als der laufende Monat gehört ins nächste Jahr.
 *
 * Vergangene Monate zeigt die Seite nicht.
 */

const BASE = 'https://www.theater-laboratorium.org';
const calendarUrl = (month?: number) =>
  `${BASE}/index.php?r=site%2Fcalender${month ? `&month_id=${month}` : ''}`;

export const theaterLaboratorium: EventSource = {
  definition: {
    id: 'theater-laboratorium',
    name: 'Theater Laboratorium',
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

    const overview = await fetchText(calendarUrl(), { signal, timeoutMs: options?.requestTimeoutMs });
    const offered = parseOfferedMonths(overview);
    if (offered.length === 0) throw new Error('Kalender: keine Monatsleiste (Layout geändert?)');

    const [year, month] = current.split('-').map(Number);
    const available = new Set(
      offered.map((m) => `${m >= month ? year : year + 1}-${String(m).padStart(2, '0')}`),
    );
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7)).filter(
      (m) => m >= current && available.has(m),
    );

    // Nacheinander: ein kleines Haus, kein Ticketportal.
    const events = (
      await settleParts({
        sourceId: 'theater-laboratorium',
        parts: months,
        sequential: true,
        load: async (m) => {
          const html = await fetchText(calendarUrl(Number(m.slice(5))), {
            signal,
            timeoutMs: options?.requestTimeoutMs,
          });
          const { events, skipped, empty } = parseMonth(html, m);
          assertRecognised(events.length, empty, `Kalender ${m}`);
          if (skipped > 0) console.warn(`[theater-laboratorium] ${m}: ${skipped} Eintrag/Einträge übersprungen`);
          return events;
        },
      })
    ).flat();

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'theater-laboratorium',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      // Nur eigene Stücke haben eine Stückseite; der Rest verweist auf den Kalender.
      fetchUrl: (event) => (event.url.includes('progtitle_id=') ? event.url : undefined),
      concurrency: 2,
    });
  },
};

export default theaterLaboratorium;
