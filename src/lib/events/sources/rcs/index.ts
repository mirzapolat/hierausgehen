import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDetails } from '../detail.ts';
import {
  type ScheduleRow,
  type SpektrixEvent,
  type SpektrixInstance,
  applySchedules,
  attribute,
  buildEvents,
  parseEvents,
  parseInstances,
} from '../spektrix.ts';
import {
  BASE,
  type EventCard,
  LIST_URL,
  TIME_ZONE,
  idPrefix,
  parseDetail,
  parseEventList,
  titleKey,
} from './parse.ts';

/**
 * Royal Conservatoire of Scotland, Glasgow.
 *
 * Musikhochschule und Schauspielschule in einem Haus, mit einem
 * Spielplan, der zum grossen Teil aus Konzerten besteht: „Fridays at One",
 * „Mondays at One", Kammermusik, Jazz, Oper, dazu einige
 * Schauspielproduktionen und die Konzerte des Junior Conservatoire. Ein
 * knappes Fünftel wird von Gästen veranstaltet (Westbourne Music, Scottish
 * National Jazz Orchestra) – die stehen im selben Spielplan und kommen mit.
 *
 *     GET https://tickets.rcs.ac.uk/royalconservatoirescotland/api/v3/events
 *     GET https://tickets.rcs.ac.uk/royalconservatoirescotland/api/v3/instances
 *           ?startFrom=YYYY-MM-DDT00:00:00&startTo=YYYY-MM-DDT23:59:59
 *     GET https://www.rcs.ac.uk/whats-on-search/[page/N/]
 *
 * Dieselbe Spektrix-Schnittstelle wie beim Citizens und beim Tron; der
 * Kundenname stand nicht auf der Seite, sondern erst im Skript der
 * Buchungsstrecke (`/royalconservatoirescotland/website/scripts/integrate.js`).
 *
 * Die Übersicht wird ganz geholt – einen Zeitraumfilter kennt sie nicht, und
 * die Blätterleiste sagt, wie viele Seiten es sind. Sie trägt Adresse, Gattung
 * und „ausverkauft" bei; fällt sie aus, stehen die Termine trotzdem. Von der
 * Veranstaltungsseite kommt danach der Programmtext, den die Kasse zu keiner
 * einzigen Produktion führt.
 *
 * Ein Haus, eine Spielstätte: die Seite nennt zu jedem Termin nur „Royal
 * Conservatoire of Scotland", keinen Saal. Das wird nicht erfunden.
 *
 * Zur `robots.txt`: gesperrt ist allein `/admin/*`.
 */

const API = 'https://tickets.rcs.ac.uk/royalconservatoirescotland/api/v3';
/** Notbremse, falls die Blätterleiste einmal ins Leere zeigt. */
const MAX_PAGES = 15;
/** Rücksicht auf die Quelle: nie mehr als so viele Seiten gleichzeitig. */
const LIST_CONCURRENCY = 3;

export const rcs: EventSource = {
  definition: {
    id: 'rcs',
    name: 'Royal Conservatoire of Scotland',
    cityId: 'glasgow',
    group: 'Konzert',
    // Gut drei Viertel des Spielplans sind Konzerte; Schauspiel und Oper
    // nennen ihre Gattung selbst.
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
    const load = (url: string) => fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs });

    const [eventsJson, instancesJson] = await Promise.all([
      load(`${API}/events`),
      load(`${API}/instances?startFrom=${range.from}T00:00:00&startTo=${range.to}T23:59:59`),
    ]);

    const productions = parseEvents(eventsJson);
    const instances = parseInstances(instancesJson);
    // Eine leere Liste ist eine gültige Auskunft; ein Umbau der Schnittstelle
    // hätte schon in `parseEvents`/`parseInstances` geworfen.
    if (instances.length === 0) return [];

    const cards = await loadCards(signal, options);
    const byProduction = matchCards(cards, productions, instances);

    const events = buildEvents({
      sourceId: 'rcs',
      timeZone: TIME_ZONE,
      events: productions,
      instances,
      include: () => true,
      category: (event) => byProduction.get(event.id)?.genre ?? attribute(event, 'Discipline'),
      // Das Haus nennt zu keinem Termin einen Saal, nur sich selbst.
      venue: () => 'Royal Conservatoire of Scotland',
      url: (event) => byProduction.get(event.id)?.url ?? LIST_URL,
      ticketUrl: (event, instance) => ticketUrl(byProduction.get(event.id), instance),
      notes: () => [],
    });

    // Einen Programmtext führt die Kasse zu keiner Produktion – das Feld ist
    // da, aber bei allen 93 leer. Er steht nur im WordPress und wird deshalb
    // je Produktion einmal nachgeladen; ein Fehlschlag lässt den Termin
    // schlicht ohne Text stehen.
    return enrichEventDetails({
      sourceId: 'rcs',
      events: markSoldOut(events, instances, byProduction),
      signal,
      fetchOptions: options,
      parse: parseDetail,
      fetchUrl: (event) => (event.url === LIST_URL ? undefined : event.url),
    });
  },
};

/**
 * Die Übersicht, Seite für Seite.
 *
 * Ein Ausfall kostet Adresse, Gattung und die Auskunft „ausverkauft" – nie
 * einen Termin. Deshalb wird hier nicht geworfen, sondern leer
 * zurückgegeben.
 */
async function loadCards(
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<EventCard[]> {
  const load = (page: number) =>
    fetchText(page === 1 ? LIST_URL : `${LIST_URL}page/${page}/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

  let first;
  try {
    first = parseEventList(await load(1));
  } catch (error) {
    console.warn(`[rcs] Übersicht nicht lesbar: ${message(error)}`);
    return [];
  }
  if (!first.recognised) {
    console.warn('[rcs] Übersicht ohne Karten und ohne Blätterleiste (Layout geändert?)');
    return [];
  }

  const cards = [...first.cards];
  const pages = Math.min(first.pageCount, MAX_PAGES);
  if (first.pageCount > MAX_PAGES) {
    console.warn(`[rcs] ${first.pageCount} Seiten, es werden ${MAX_PAGES} geholt`);
  }

  for (let page = 2; page <= pages; page += LIST_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(LIST_CONCURRENCY, pages - page + 1) },
      (_, index) => page + index,
    );
    const results = await Promise.allSettled(batch.map(load));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`[rcs] Seite ${batch[index]}: ${message(result.reason)}`);
        return;
      }
      cards.push(...parseEventList(result.value).cards);
    });
  }

  return cards;
}

/**
 * Karte zu Produktion – erst über die Buchungsnummer, dann über den Titel.
 *
 * Die Buchungsnummer der Karte ist der Anfang einer Vorstellungs-ID; über die
 * Vorstellung findet die Karte zur Produktion und gilt damit für alle deren
 * Abende. Nur wo sie fehlt – Läufe über mehrere Tage verweisen statt auf die
 * Kasse auf ihre eigene Terminliste – wird der Titel verglichen.
 */
function matchCards(
  cards: EventCard[],
  productions: SpektrixEvent[],
  instances: SpektrixInstance[],
): Map<string, EventCard> {
  const productionOf = new Map<string, string>();
  for (const instance of instances) {
    const prefix = idPrefix(instance.id);
    if (prefix) productionOf.set(prefix, instance.eventId);
  }
  const byTitle = new Map(productions.map((event) => [titleKey(event.name), event.id]));

  const matched = new Map<string, EventCard>();
  for (const card of cards) {
    const id =
      (card.bookingId ? productionOf.get(card.bookingId) : undefined) ??
      byTitle.get(titleKey(card.title));
    if (id && !matched.has(id)) matched.set(id, card);
  }
  return matched;
}

/**
 * Der Ticketlink einer einzelnen Vorstellung.
 *
 * `/whats-on/<stück>/book/<n>/` reicht `<n>` als `InstanceId` an die Kasse
 * durch – nachgeprüft an einer Vorstellung, die auf der Seite gar keinen Knopf
 * hatte. Ohne Karte kennen wir den Pfad des Stücks nicht und lassen das Feld
 * leer.
 */
function ticketUrl(card: EventCard | undefined, instance: SpektrixInstance): string | undefined {
  const prefix = idPrefix(instance.id);
  if (!card || !prefix) return undefined;
  return `${card.url.replace(/\/?$/, '/')}book/${prefix}/`;
}

/**
 * „Sold Out" von der Karte auf die Termine legen.
 *
 * Die Karte spricht für den ganzen Lauf – solange ein Abend zu haben ist,
 * zeigt sie den Ticketknopf. Was die Kasse über den Verkaufsbeginn weiss,
 * steht schon am Termin und bleibt unangetastet.
 */
function markSoldOut(
  events: CalendarEvent[],
  instances: SpektrixInstance[],
  byProduction: Map<string, EventCard>,
): CalendarEvent[] {
  const soldOut = new Set(
    instances
      .filter((instance) => byProduction.get(instance.eventId)?.soldOut)
      .map((instance) => `rcs:${instance.id}`),
  );
  if (soldOut.size === 0) return events;

  const row: ScheduleRow = { availability: 'soldout', availabilityLabel: 'Sold Out', notes: [] };
  return applySchedules(events, (event) => (soldOut.has(event.id) ? row : undefined));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default rcs;
