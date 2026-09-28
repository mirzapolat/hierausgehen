import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { enrichEvents } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { dayOrdinals, mergeProduction, parseProductionPage, parseProgramme } from './parse.ts';

/**
 * Kulturetage Oldenburg – Konzert, Kabarett, Comedy, Lesung und Theater in
 * Halle, Theatersaal und Studio, dazu Abende „auf Tour“ an anderen Orten.
 *
 * `/p_ogramm_12-.html` führt das ganze veröffentlichte Programm in einer
 * Antwort, beim Schreiben dieses Adapters fünfzehn Monate. Die Liste nennt
 * aber keine Uhrzeit; die steht, zusammen mit Saal, Preis und Programmtext,
 * auf der Seite der Produktion. Die wird einmal je Produktion geholt (nicht je
 * Termin) und einen Tag lang behalten. Bis sie da ist, steht der Termin
 * ganztägig im Kalender.
 */

const BASE = 'https://www.kulturetage.de';
const PROGRAMME = `${BASE}/p_ogramm_12-.html`;

export const kulturetage: EventSource = {
  definition: {
    id: 'kulturetage',
    name: 'Kulturetage',
    cityId: 'oldenburg',
    group: 'Kultur',
    defaultCategory: 'Kultur',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const now = today();
    if (range.to < now) return [];

    const html = await fetchText(PROGRAMME, { signal, timeoutMs: options?.requestTimeoutMs });
    const { events, skipped, empty } = parseProgramme(html, now);

    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[kulturetage] ${skipped} Block/Blöcke übersprungen`);

    // Die Reihenfolge am Tag vor dem Zuschnitt: sie gilt für die ganze Liste.
    const ordinals = dayOrdinals(events);
    const filtered = events.filter((event) => withinRange(event.start, range));
    return enrichEvents({
      sourceId: 'kulturetage',
      events: filtered,
      signal,
      fetchOptions: options,
      parse: (page) => parseProductionPage(page),
      merge: (event, detail) => mergeProduction(event, detail, ordinals.get(event.id)),
      concurrency: 2,
    });
  },
};

export default kulturetage;
