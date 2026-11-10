import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { today, withinRange } from '../collect.ts';
import { enrichEventDetails } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { parseEventDetail, parseProgramme } from './parse.ts';

/**
 * Muffatwerk München.
 *
 *   GET https://www.muffatwerk.de/de/events
 *
 * Eine Seite mit dem ganzen kommenden Programm (gut ein Jahr im Voraus),
 * ohne Paging und ohne Zeitraum-Parameter; gefiltert wird lokal. Vergangenes
 * zeigt die Seite nicht – liegt der Zeitraum ganz in der Vergangenheit, wird
 * nicht abgerufen.
 *
 * Programmtext, Einlass, Preise und – bei Terminen ohne Uhrzeit in der
 * Liste – der Beginn stehen auf `/de/events/view/{ID}/{slug}`. Die
 * `robots.txt` sperrt einzelne dieser Seiten; sie wird mitgelesen und
 * gesperrte Seiten werden nicht geholt. Ist sie nicht lesbar, bleibt es bei
 * der Liste.
 */

const BASE = 'https://www.muffatwerk.de';

export const muffatwerk: EventSource = {
  definition: {
    id: 'muffatwerk',
    name: 'Muffatwerk',
    cityId: 'muenchen',
    group: 'Konzert',
    defaultCategory: 'Konzert',
    concerts: 'Konzert',
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

    const [html, disallowed] = await Promise.all([
      fetchText(`${BASE}/de/events`, { signal, timeoutMs: options?.requestTimeoutMs }),
      loadDisallowed(signal, options),
    ]);
    const { events, skipped, empty } = parseProgramme(html, now);
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[muffatwerk] ${skipped} Termin(e) übersprungen`);

    return enrichEventDetails({
      sourceId: 'muffatwerk',
      events: events.filter((event) => withinRange(event.start, range)),
      signal,
      fetchOptions: options,
      parse: parseEventDetail,
      fetchUrl: (event) => (disallowed && !isDisallowed(event.url, disallowed) ? event.url : undefined),
      timeZone: 'Europe/Berlin',
    });
  },
};

/** Gesperrte Pfade aus `robots.txt`; `undefined`, wenn sie nicht lesbar war. */
async function loadDisallowed(signal?: AbortSignal, options?: EventFetchOptions): Promise<string[] | undefined> {
  try {
    const robots = await fetchText(`${BASE}/robots.txt`, { signal, timeoutMs: options?.requestTimeoutMs });
    return robots
      .split(/\r?\n/)
      .map((line) => /^\s*Disallow:\s*(\S+)/i.exec(line)?.[1])
      .filter((path): path is string => Boolean(path));
  } catch {
    return undefined;
  }
}

function isDisallowed(url: string, disallowed: string[]): boolean {
  const path = new URL(url).pathname;
  // Präfixvergleich wie in robots.txt üblich – im Zweifel lieber eine Seite zu wenig holen.
  return disallowed.some((rule) => path.startsWith(rule));
}

export default muffatwerk;
