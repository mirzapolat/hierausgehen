import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { dedupeById, errorMessage, today, withinRange } from '../collect.ts';
import { enrichEvents, mergeDetail } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import {
  evisIdOf,
  parseEventPage,
  parseEvents,
  parseMetadata,
  type EventsResponse,
  type Metadata,
  type TonhalleDetail,
} from './parse.ts';

/**
 * Tonhalle Düsseldorf – eigene Reihen, Düsseldorfer Symphoniker und die
 * Konzerte der Gastveranstalter („Komet").
 *
 *   GET https://www.tonhalle.de/api/events?type=dynamic&size=200&from={offset}
 *   GET https://www.tonhalle.de/api/events/metadata
 *
 * Dieselben Endpunkte, aus denen die Seite ihre Karussells füllt. Ohne Filter
 * liefert die API das ganze kommende Programm (rund ein Jahr), geblättert
 * über `nextOffset`; einen Zeitraum-Parameter gibt es nicht, Vergangenes auch
 * nicht. Die Metadaten tragen die Ticketlage je Vorstellung – fallen sie aus,
 * fehlt nur die, nicht der Termin.
 *
 * Saal, Reihe, Veranstalter und Programmtext lädt die Veranstaltungsseite
 * nach, einmal je Veranstaltung.
 */

const BASE = 'https://www.tonhalle.de';
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

export const tonhalle: EventSource = {
  definition: {
    id: 'tonhalle',
    name: 'Tonhalle Düsseldorf',
    cityId: 'duesseldorf',
    group: 'Konzert',
    defaultCategory: 'Konzert',
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
    const request = { signal, timeoutMs: options?.requestTimeoutMs };

    const [pages, metadata] = await Promise.all([
      loadPages(request),
      fetchText(`${BASE}/api/events/metadata`, request)
        .then(parseMetadata)
        .catch((error: unknown): Metadata[] => {
          console.warn(`[tonhalle] Ticketlage nicht geladen – ${errorMessage(error)}`);
          return [];
        }),
    ]);

    const events: CalendarEvent[] = [];
    for (const [index, json] of pages.entries()) {
      const { events: found, skipped, empty } = parseEvents(json, metadata);
      assertRecognised(found.length, empty, `Termine, Seite ${index + 1}`);
      if (skipped > 0) console.warn(`[tonhalle] ${skipped} Veranstaltung(en)/Termin(e) übersprungen`);
      events.push(...found);
    }

    return enrichEvents<TonhalleDetail>({
      sourceId: 'tonhalle',
      events: dedupeById(events).filter((event) => withinRange(event.start, range)),
      signal,
      fetchOptions: options,
      parse: parseEventPage,
      merge: (event, detail) => {
        const merged = mergeDetail(event, detail);
        return {
          ...merged,
          venue: detail.venue ? { name: detail.venue } : merged.venue,
          url: detail.urls[evisIdOf(event)] ?? merged.url,
        };
      },
    });
  },
};

/** Alle Seiten der API, solange sie einen `nextOffset` nennt. */
async function loadPages(request: { signal?: AbortSignal; timeoutMs?: number }): Promise<string[]> {
  const pages: string[] = [];
  let offset: number | null = 0;
  while (offset !== null && pages.length < MAX_PAGES) {
    const json = await fetchText(`${BASE}/api/events?type=dynamic&size=${PAGE_SIZE}&from=${offset}`, request);
    pages.push(json);
    offset = nextOffset(json, offset);
  }
  return pages;
}

function nextOffset(json: string, current: number): number | null {
  try {
    const next = (JSON.parse(json) as EventsResponse).nextOffset;
    return typeof next === 'number' && next > current ? next : null;
  } catch {
    return null;
  }
}

export default tonhalle;
