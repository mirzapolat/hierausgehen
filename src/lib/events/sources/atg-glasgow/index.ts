import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDetails } from '../detail.ts';
import {
  BASE,
  SOURCE_ID,
  TIME_ZONE,
  type ShowCard,
  overlapsRange,
  parseListPage,
  parsePerformances,
  parseRun,
  parseSeasonPage,
  parseShowDetail,
} from './parse.ts';

/**
 * ATG Tickets Glasgow – King's Theatre und Theatre Royal.
 *
 * Beide Häuser gehören der Ambassador Theatre Group und teilen sich einen
 * Spielplan unter `/whats-on/glasgow/`: Musicals auf Tournee, Schauspiel,
 * Comedy, Scottish Opera und Scottish Ballet als Gäste, dazu die
 * Weihnachtspantomime und Haus­führungen. Ein drittes Glasgower Haus führt ATG
 * nicht; wer in der Übersicht steht, spielt in einem der beiden.
 *
 * Der Abruf läuft in zwei Schritten, weil die Quelle sie trennt:
 *
 *  1. Die Übersicht nennt die **Stücke** – mit Gattung, Haus und Laufzeit,
 *     aber ohne einen einzigen Anfangszeitpunkt. Sie kennt keinen Parameter
 *     für den Zeitraum (`?page=` ist laut `robots.txt` das einzige erlaubte
 *     Argument), also wird sie ganz geholt und die Laufzeit entscheidet, wen
 *     der angefragte Monat überhaupt betrifft.
 *  2. Der Kalenderdienst nennt zu jedem so übrig gebliebenen Stück **alle**
 *     Vorstellungen. Das ist ein Abruf je Stück – rund zwanzig für einen
 *     Monat, keiner davon für ein Stück ausserhalb des Zeitraums.
 *
 * Der lange Ankündigungstext kommt danach von der Produktionsseite. Er wird je
 * Produktion einmal geholt, nicht je Abend, und ein Fehlschlag lässt den
 * Termin einfach ohne Text stehen.
 *
 * Zur `robots.txt`: für `User-Agent: *` sind `/whats-on/*?page=` und
 * `/venues/*​/whats-on/*?page=` ausdrücklich erlaubt, gesperrt sind die
 * Filter-URLs mit Komma und alle übrigen Abfrageargumente (Werbe- und
 * Sitzungsparameter, `?genre=`) sowie `/checkout/`. Die Pfade unter `/shows/`
 * sind frei. Wir rufen nur `/whats-on/glasgow/?page=N`, `/shows/…/` und den
 * Kalenderdienst – keine gesperrte Adresse.
 */

const LIST_URL = `${BASE}/whats-on/glasgow/`;
const CALENDAR_SERVICE = 'https://calendar-service.core.platform.atgtickets.com/';
/** Der Kalenderdienst unterscheidet Länder; `AV_UK` ist die britische Seite. */
const SOURCE_PARAMETER = 'AV_UK';

/** Notbremse, falls die Blätterleiste einmal ins Leere zeigt. */
const MAX_PAGES = 12;
/** Rücksicht auf die Quelle: nie mehr als so viele Abrufe gleichzeitig. */
const LIST_CONCURRENCY = 3;
const SHOW_CONCURRENCY = 4;

/**
 * Nur die Felder, die wir wirklich lesen. Der Browser fragt ein Vielfaches ab
 * (Sitzplatzgruppen, Aktionscodes, Preisstufen); das hier ist die kleinste
 * Abfrage, die einen Termin vollständig beschreibt.
 */
const SHOW_QUERY = `query getShow($titleSlug: String, $venueSlug: String, $sourceId: String) {
  getShow(titleSlug: $titleSlug, venueSlug: $venueSlug, sourceId: $sourceId) {
    show {
      status
      dates { nextPerformanceDate lastPerformanceDate timeZone }
      performances {
        id
        dates { performanceDate }
        performanceTimeDescription
        availabilityStatus
        accessibilityType
        price { minPrice minPriceFee maxPrice maxPriceFee }
      }
    }
    status { code message }
  }
}`;

export const atgGlasgow: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'ATG Tickets Glasgow',
    cityId: 'glasgow',
    group: 'Theater',
    // Die Übersicht führt neben Schauspiel auch Comedy, Oper und Führungen –
    // "Theater" ist der ehrliche Sammelbegriff, "Schauspiel" wäre zu eng.
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
    // Ein Ticketshop führt keine gespielten Abende. Ein vergangener Monat ist
    // deshalb kein Ausfall, sondern schlicht leer – und kostet keinen Abruf.
    const today = new Date().toISOString().slice(0, 10);
    if (range.to < today) return [];

    const shows = await loadShows(range, signal, options);
    if (shows.length === 0) return [];

    const events = await loadPerformances(shows, signal, options);

    const inRange = events.filter((event) => {
      const day = event.start.slice(0, 10);
      return day >= range.from && day <= range.to;
    });

    // Der lange Text hängt am Stück, nicht am Abend: ein Abruf je Produktion.
    return enrichEventDetails({
      sourceId: SOURCE_ID,
      events: inRange,
      signal,
      fetchOptions: options,
      parse: parseShowDetail,
      timeZone: TIME_ZONE,
    });
  },
};

/**
 * Alle Stücke der Übersicht, die in den Zeitraum hineinragen.
 *
 * Die erste Seite sagt, wie viele es sind. Bleibt sie unlesbar, ist der Aufbau
 * geändert und die Quelle meldet sich als kaputt – ein stilles „keine Termine"
 * wäre die schlechtere Antwort. Eine leere Trefferliste dagegen ist gültig und
 * am Markup erkennbar (`"cards":[]`).
 */
async function loadShows(
  range: FetchRange,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<ShowCard[]> {
  const load = (page: number) =>
    fetchText(`${LIST_URL}?page=${page}`, { signal, timeoutMs: options?.requestTimeoutMs });

  const first = parseListPage(await load(1));
  if (!first.recognised) throw new Error('Keine Trefferliste erkannt (Layout geändert?)');

  const shows = [...first.shows];
  const pages = Math.min(first.pageCount, MAX_PAGES);
  if (first.pageCount > MAX_PAGES) {
    console.warn(`[${SOURCE_ID}] ${first.pageCount} Seiten, es werden ${MAX_PAGES} geholt`);
  }

  for (let page = 2; page <= pages; page += LIST_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(LIST_CONCURRENCY, pages - page + 1) },
      (_, index) => page + index,
    );
    const results = await Promise.allSettled(batch.map(load));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Eine fehlende Seite ist eine Lücke, kein Ausfall.
        console.warn(`[${SOURCE_ID}] Seite ${batch[index]}: ${message(result.reason)}`);
        return;
      }
      shows.push(...parseListPage(result.value).shows);
    });
  }

  const relevant = shows.filter((show) => overlapsRange(show, range.from, range.to));
  return resolveSeasons(relevant, signal, options);
}

/**
 * „Season"-Karten auflösen.
 *
 * Zwei Karten führen auf eine Sammelseite statt auf eine Produktion – am
 * fehlenden Haus im Pfad zu erkennen. Erst die Sammelseite nennt die Paare aus
 * Stück und Haus, die der Kalenderdienst braucht. Gattung und Laufzeit erbt
 * jede Produktion von der Sammelkarte, ihre eigene Laufzeit steht daneben.
 */
async function resolveSeasons(
  shows: ShowCard[],
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<ShowCard[]> {
  const resolved: ShowCard[] = [];
  for (const show of shows) {
    if (show.titleSlug && show.venueSlug) {
      resolved.push(show);
      continue;
    }
    try {
      const html = await fetchText(show.url, { signal, timeoutMs: options?.requestTimeoutMs });
      for (const entry of parseSeasonPage(html)) {
        resolved.push({
          ...show,
          id: `${show.id}:${entry.titleSlug}`,
          title: entry.title,
          titleSlug: entry.titleSlug,
          venueSlug: entry.venueSlug,
          venue: entry.venue ?? show.venue,
          url: `${BASE}/shows/${entry.titleSlug}/${entry.venueSlug}/`,
          runLabel: entry.runLabel || show.runLabel,
          ...parseRun(entry.runLabel || show.runLabel),
        });
      }
    } catch (error) {
      console.warn(`[${SOURCE_ID}] Sammelseite ${show.url}: ${message(error)}`);
    }
  }
  return resolved;
}

/**
 * Zu jedem Stück die Vorstellungen holen.
 *
 * Einzelne Ausfälle sind hinnehmbar – ein Stück, das der Kalenderdienst nicht
 * kennt, antwortet mit 404 und fehlt dann eben. Fällt aber *jeder* Abruf aus,
 * ist der Dienst weg und die Quelle muss sich als kaputt melden, damit die
 * Aggregation den Cache ausliefert.
 */
async function loadPerformances(
  shows: ShowCard[],
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let failed = 0;

  for (let index = 0; index < shows.length; index += SHOW_CONCURRENCY) {
    const batch = shows.slice(index, index + SHOW_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (show) => parsePerformances(await requestShow(show, signal, options), show)),
    );
    results.forEach((result, offset) => {
      if (result.status === 'rejected') {
        failed++;
        console.warn(`[${SOURCE_ID}] ${batch[offset].titleSlug}: ${message(result.reason)}`);
        return;
      }
      events.push(...result.value);
    });
  }

  if (failed === shows.length) {
    throw new Error(`Kalenderdienst antwortet zu keinem der ${shows.length} Stücke`);
  }
  return events;
}

function requestShow(
  show: ShowCard,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<string> {
  return fetchText(CALENDAR_SERVICE, {
    signal,
    timeoutMs: options?.requestTimeoutMs,
    // Apollo weist einen Rumpf ohne eigenen Inhaltstyp als möglichen
    // Cross-Site-Zugriff ab; `application/json` ist genau das, was der Browser
    // hier schickt.
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: 'getShow',
      variables: {
        titleSlug: show.titleSlug,
        venueSlug: show.venueSlug,
        sourceId: SOURCE_PARAMETER,
      },
      query: SHOW_QUERY,
    }),
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default atgGlasgow;
