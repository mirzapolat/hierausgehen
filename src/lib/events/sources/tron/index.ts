import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import {
  type Schedule,
  type SpektrixEvent,
  type SpektrixInstance,
  applySchedules,
  attribute,
  buildEvents,
  parseEvents,
  parseInstances,
} from '../spektrix.ts';
import { BASE, LIST_URL, TIME_ZONE, parseEventList, parseSchedule, titleKey } from './parse.ts';

/**
 * Tron Theatre, Glasgow.
 *
 * Kleines Haus am Trongate mit eigener Company: Main Auditorium, The Vic und
 * gelegentlich das Foyer („Promenade"). In den Kalender kommt, was das Haus
 * selbst als Spielplan führt – `attribute_WebsitePlacement` „Theatre".
 * Draussen bleiben „Participation" (Recruitment-Workshops der Community
 * Ensemble) und „Hidden", hinter dem der Tischverkauf des Café/Bar steckt:
 * 177 „Table Reservation"-Termine, mehr als der ganze übrige Spielplan.
 *
 *     GET https://sales.tron.co.uk/tron/api/v3/events
 *     GET https://sales.tron.co.uk/tron/api/v3/instances
 *           ?startFrom=YYYY-MM-DDT00:00:00&startTo=YYYY-MM-DDT23:59:59
 *     GET https://www.tron.co.uk/whats-on/     Adressen der Produktionen
 *
 *     GET https://www.tron.co.uk/shows/<stück>/  Ticketlage je Vorstellung
 *
 * Die ersten beiden tragen den Spielplan, die anderen ergänzen ihn. Fällt die
 * Website aus, stehen die Termine trotzdem – nur ohne Ticketlage und mit der
 * Übersichtsseite als Adresse.
 *
 * Zur `robots.txt`: `Disallow:` ohne Wert, also nichts gesperrt.
 */

const API = 'https://sales.tron.co.uk/tron/api/v3';
/** Was das Haus auf seiner eigenen Spielplanseite zeigt. */
const PROGRAMME = 'Theatre';
/** Rücksicht auf die Quelle: nie mehr als so viele Seiten gleichzeitig. */
const DETAIL_CONCURRENCY = 3;

export const tron: EventSource = {
  definition: {
    id: 'tron',
    name: 'Tron Theatre',
    cityId: 'glasgow',
    group: 'Theater',
    // Rund die Hälfte der Produktionen führt eine Gattung; der Rest
    // (Doors-Open-Day-Führung, Comedy-Abend, Gespräch) lässt sie leer.
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
    const load = (url: string) => fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs });

    const [eventsJson, instancesJson] = await Promise.all([
      load(`${API}/events`),
      load(`${API}/instances?startFrom=${range.from}T00:00:00&startTo=${range.to}T23:59:59`),
    ]);

    const productions = parseEvents(eventsJson);
    const instances = parseInstances(instancesJson);
    if (instances.length === 0) return [];

    const links = await loadLinks(signal, options);

    const events = buildEvents({
      sourceId: 'tron',
      timeZone: TIME_ZONE,
      events: productions,
      instances,
      include: (event) => attribute(event, 'WebsitePlacement') === PROGRAMME,
      category: categoryOf,
      venue: venueOf,
      url: (event) => links[titleKey(event.name)] ?? LIST_URL,
      // Der Umweg über das eigene Haus statt direkt in den Spektrix-Shop:
      // genau diese Adresse setzt die Website unter ihre Vorstellungen.
      ticketUrl: (_event, instance: SpektrixInstance) => `${BASE}/book-online/${instance.id}`,
      notes: notesOf,
    });

    return addAvailability(events, links, signal, options);
  },
};

/**
 * Ticketlage und Vorstellungshinweise von den Produktionsseiten nachtragen.
 *
 * Geholt wird je Produktion einmal, nicht je Abend – bei der Pantomime mit
 * ihren 66 Terminen ist das ein Abruf statt 66. Zugeordnet wird über Tag und
 * Uhrzeit in Ortszeit; die ersten sechzehn Zeichen des Beginns sind genau das.
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
      batch.map((url) =>
        fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs, retries: 0 }),
      ),
    );
    results.forEach((result, offset) => {
      if (result.status === 'rejected') {
        // Ohne Spielplan bleibt der Termin stehen, nur ohne Ticketlage.
        console.warn(`[tron] ${batch[offset]}: ${message(result.reason)}`);
        return;
      }
      schedules.set(batch[offset], parseSchedule(result.value));
    });
  }

  return applySchedules(events, (event) => schedules.get(event.url)?.[event.start.slice(0, 16)]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Die Gattung im Wortlaut des Hauses.
 *
 * Das Tron führt sie zweistufig, in der Systematik der schottischen
 * Theaterstatistik: `TAAArtform` grob („Plays/Drama", „Christmas Show"),
 * `TAASubGenre` genau („Drama New Writing", „Pantomime", „Physical Theatre").
 * Vorangestellt wird die genauere – `categories.ts` nimmt aus einer
 * zusammengesetzten Angabe das erste Glied, das es kennt, und „Pantomime"
 * sagt mehr als „Christmas Show".
 */
function categoryOf(event: SpektrixEvent): string | undefined {
  const parts = [attribute(event, 'TAASubGenre'), attribute(event, 'TAAArtform')].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : undefined;
}

/**
 * Der Saal, mit dem Haus davor.
 *
 * „Main Auditorium" allein wäre in einer Liste über zwanzig Häuser nicht
 * wiederzuerkennen; die Ortsauflösung schneidet am Gedankenstrich ohnehin auf
 * „Tron Theatre" zurück.
 */
function venueOf(event: SpektrixEvent): string {
  const location = attribute(event, 'Location');
  return location ? `Tron Theatre – ${location}` : 'Tron Theatre';
}

/** Preise und Hinweise, die das Haus an der Produktion führt. */
function notesOf(event: SpektrixEvent): string[] {
  const notes: string[] = [];
  const prices = attribute(event, 'Prices');
  if (prices) notes.push(`Tickets: ${prices}`);
  const presenter = [attribute(event, 'EventInfo'), attribute(event, 'EventInfo2')]
    .filter(Boolean)
    .join(' ');
  if (presenter) notes.push(presenter);
  const age = attribute(event, 'AgeRestrictionNote');
  if (age) notes.push(age);
  return notes;
}

async function loadLinks(
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<Record<string, string>> {
  try {
    const list = parseEventList(
      await fetchText(LIST_URL, { signal, timeoutMs: options?.requestTimeoutMs }),
    );
    if (!list.recognised) {
      console.warn('[tron] Übersicht ohne Karten (Layout geändert?)');
      return {};
    }
    return list.links;
  } catch (error) {
    console.warn(`[tron] Übersicht nicht lesbar: ${message(error)}`);
    return {};
  }
}

export default tron;
