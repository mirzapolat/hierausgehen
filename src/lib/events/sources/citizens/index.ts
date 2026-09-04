import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import {
  type Schedule,
  type SpektrixEvent,
  applySchedules,
  attribute,
  buildEvents,
  parseEvents,
  parseInstances,
} from '../spektrix.ts';
import { BASE, LIST_URL, TIME_ZONE, parseEventList, parseSchedule, titleKey } from './parse.ts';

/**
 * Citizens Theatre, Glasgow.
 *
 * Das Haus am Gorbals Street führt drei Bühnen (Main Theatre, Studio Theatre,
 * Event Studio) und daneben eine grosse Vermittlungsschiene. In den Kalender
 * kommt, was auch auf der eigenen Spielplanseite steht: `attribute_EventType`
 * „Shows" und „Heritage Tours". Die wöchentlichen Kursreihen („Classes":
 * Young Creatives, 119 Players, Young Artists) und die Bildungsworkshops
 * bleiben draussen – sie laufen über das Schuljahr und würden den Spielplan
 * zahlenmässig zudecken.
 *
 *     GET https://tickets.citz.co.uk/citizenstheatre/api/v3/events
 *     GET https://tickets.citz.co.uk/citizenstheatre/api/v3/instances
 *           ?startFrom=YYYY-MM-DDT00:00:00&startTo=YYYY-MM-DDT23:59:59
 *     GET https://citz.co.uk/whats-on/            Adressen der Produktionen
 *     GET https://citz.co.uk/whats-on/<stück>/    Ticketlage je Vorstellung
 *
 * Die beiden ersten tragen den Spielplan, die beiden letzten ergänzen ihn.
 * Fällt die Website aus, stehen die Termine trotzdem – nur ohne Ticketlage und
 * mit der Übersichtsseite als Adresse.
 *
 * Der Zeitraumfilter wirkt auch rückwärts: gespielte Abende bleiben rund ein
 * Jahr abrufbar. Vergangene Monate werden deshalb angefragt wie jeder andere.
 *
 * Zur `robots.txt`: gesperrt ist allein `/admin/*`.
 */

const API = 'https://tickets.citz.co.uk/citizenstheatre/api/v3';
/** Die Reihen, die auch auf der eigenen Spielplanseite stehen. */
const PROGRAMME = new Set(['Shows', 'Heritage Tours']);
/** Rücksicht auf die Quelle: nie mehr als so viele Seiten gleichzeitig. */
const DETAIL_CONCURRENCY = 3;

export const citizens: EventSource = {
  definition: {
    id: 'citizens',
    name: 'Citizens Theatre',
    cityId: 'glasgow',
    group: 'Theater',
    // Eine Gattung führt das Haus nicht: `attribute_EventType` trennt
    // Spielplan von Kursen, nicht Schauspiel von Konzert.
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
    const load = (url: string) =>
      fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs });

    const [eventsJson, instancesJson] = await Promise.all([
      load(`${API}/events`),
      load(`${API}/instances?startFrom=${range.from}T00:00:00&startTo=${range.to}T23:59:59`),
    ]);

    const productions = parseEvents(eventsJson);
    const instances = parseInstances(instancesJson);
    // Eine leere Liste ist eine gültige Auskunft (Sommerpause, Vergangenheit
    // vor dem Aufbewahrungsfenster). Ein Umbau der Schnittstelle hätte schon
    // in `parseEvents`/`parseInstances` geworfen.
    if (instances.length === 0) return [];

    const links = await loadLinks(signal, options);

    const events = buildEvents({
      sourceId: 'citizens',
      timeZone: TIME_ZONE,
      events: productions,
      instances,
      include: (event) => PROGRAMME.has(attribute(event, 'EventType') ?? ''),
      category: categoryOf,
      venue: (event) => attribute(event, 'Venue') ?? 'Citizens Theatre',
      url: (event) => links[titleKey(event.name)] ?? LIST_URL,
      notes: () => [],
    });

    return addAvailability(events, links, signal, options);
  },
};

/**
 * Die Gattung, so weit das Haus eine nennt.
 *
 * „Shows" ist keine – das Feld trennt Spielplan von Kursbetrieb und würde als
 * Kategorie zu „Show" (Revue, Varieté) werden, also glatt daneben. Nur die
 * Hausführungen benennen sich selbst; alles andere fällt auf den
 * Quellen-Fallback „Theater".
 */
function categoryOf(event: SpektrixEvent): string | undefined {
  const type = attribute(event, 'EventType');
  return type === 'Heritage Tours' ? type : undefined;
}

/** Titel auf Produktionsseite. Ein Ausfall kostet nur die schöneren Adressen. */
async function loadLinks(
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<Record<string, string>> {
  try {
    const list = parseEventList(await fetchText(LIST_URL, { signal, timeoutMs: options?.requestTimeoutMs }));
    if (!list.recognised) {
      console.warn('[citizens] Übersicht ohne Karten (Layout geändert?)');
      return {};
    }
    return list.links;
  } catch (error) {
    console.warn(`[citizens] Übersicht nicht lesbar: ${message(error)}`);
    return {};
  }
}

/**
 * Ticketlage von den Produktionsseiten nachtragen.
 *
 * Geholt wird je Produktion einmal, nicht je Abend. Zugeordnet wird über Tag
 * und Uhrzeit in Ortszeit – beide stehen auf der Seite maschinenlesbar im
 * `datetime`-Attribut, und innerhalb einer Produktion ist das eindeutig.
 */
async function addAvailability(
  events: CalendarEvent[],
  links: Record<string, string>,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<CalendarEvent[]> {
  const known = new Set(Object.values(links));
  const urls = [...new Set(events.map((event) => event.url))].filter((url) => known.has(url));
  if (urls.length === 0) return events;

  const schedules = new Map<string, Schedule>();
  for (let index = 0; index < urls.length; index += DETAIL_CONCURRENCY) {
    const batch = urls.slice(index, index + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((url) => fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs, retries: 0 })),
    );
    results.forEach((result, offset) => {
      if (result.status === 'rejected') {
        // Ohne Spielplan bleibt der Termin stehen, nur ohne Ticketlage.
        console.warn(`[citizens] ${batch[offset]}: ${message(result.reason)}`);
        return;
      }
      schedules.set(batch[offset], parseSchedule(result.value));
    });
  }

  // Tag und Uhrzeit stehen auf der Seite maschinenlesbar im `datetime`; in
  // Ortszeit sind die ersten sechzehn Zeichen des Beginns genau das.
  return applySchedules(events, (event) => schedules.get(event.url)?.[event.start.slice(0, 16)]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default citizens;
