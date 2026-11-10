import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { dedupeById, settleParts, today, withinRange } from '../collect.ts';
import { enrichEventDetails } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { BASE, SOURCE_ID, parseDetail, parseListPage, parseTeaserFragment } from './parse.ts';

/**
 * Werksviertel-Mitte – das Gelände am Ostbahnhof mit vielen Spielstätten
 * (Technikum, TonHalle München, WERK7 theater, NachtKantine, Sugar Shack,
 * Schlagergarten, Kreativstudio, München Hoch5 …). Die Spielstätte steht an
 * jedem Termin.
 *
 *   GET  /veranstaltungen/?date_start=YYYY-MM-DD&date_end=YYYY-MM-DD
 *        → erste 24 Teaser + `{found, hash}`
 *   POST /backend/admin-ajax.php  action=load_teasers&hash=…&offset=24|48|…
 *        → je 24 weitere Teaser, leer hinter dem letzten
 *
 * Der Filter wählt nach Überschneidung: ein Markt vom 12.11. bis 20.12. steht
 * auch in der Dezemberliste. Vergangenes kennt die Seite nicht; vor heute wird
 * nicht gefragt. Programmtext, Einlass, Preis, Veranstalter und Ticketlink
 * stehen auf der Detailseite.
 */

const PAGE_SIZE = 24;

export const werksviertelMitte: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Werksviertel-Mitte',
    cityId: 'muenchen',
    group: 'Kultur',
    // Termine ohne Schlagwort (z. B. der Wintermarkt) – das Gelände führt
    // Konzerte, Partys, Workshops, Führungen und Märkte quer durcheinander.
    defaultCategory: 'Kultur',
    concerts: 'Konzert',
    homepage: `${BASE}/veranstaltungen/`,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const now = today();
    const from = range.from < now ? now : range.from;
    if (from > range.to) return [];

    const request = { signal, timeoutMs: options?.requestTimeoutMs };
    const html = await fetchText(
      `${BASE}/veranstaltungen/?date_start=${from}&date_end=${range.to}`,
      request,
    );
    const first = parseListPage(html);
    assertRecognised(first.events.length, first.empty, `Liste ${from}–${range.to}`);
    let skipped = first.skipped;

    const offsets: number[] = [];
    if (first.hash) {
      for (let offset = first.events.length + first.skipped; offset < first.found; offset += PAGE_SIZE) {
        offsets.push(offset);
      }
    }

    const more = await settleParts({
      sourceId: SOURCE_ID,
      parts: offsets,
      label: (offset) => `offset ${offset}`,
      load: async (offset) => {
        const body = new URLSearchParams({
          action: 'load_teasers',
          hash: first.hash ?? '',
          offset: String(offset),
        }).toString();
        const fragment = await fetchText(`${BASE}/backend/admin-ajax.php`, {
          ...request,
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const page = parseTeaserFragment(fragment);
        assertRecognised(page.events.length, page.empty, `Nachladen ab ${offset}`);
        skipped += page.skipped;
        return page.events;
      },
    });
    if (skipped > 0) console.warn(`[${SOURCE_ID}] ${skipped} Teaser übersprungen`);

    // Wie bei allen Quellen zählt der Beginn: ein Mehrtägiges steht in dem
    // Monat, in dem es anfängt, nicht in jedem, den es berührt.
    const events = sameEvening(dedupeById([...first.events, ...more.flat()])).filter((event) =>
      withinRange(event.start, range),
    );
    return enrichEventDetails({
      sourceId: SOURCE_ID,
      events,
      signal,
      fetchOptions: options,
      parse: parseDetail,
      cacheKey: (event) => event.url,
    });
  },
};

/**
 * Die Seite führt manche Abende unter zwei Adressen – gleicher Titel,
 * gleiche Zeit, gleicher Ort. Der erste bleibt.
 */
function sameEvening(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.start}|${event.title.toLowerCase()}|${event.venue.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default werksviertelMitte;
