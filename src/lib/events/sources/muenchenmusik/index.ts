import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseListPage } from './parse.ts';
import type { ParseResult } from './parse.ts';
import { assertRecognised } from '../page.ts';
import { dedupeById, today, withinRange } from '../collect.ts';

/**
 * MünchenMusik – Konzertveranstalter mit eigenem Spielplan über mehrere Häuser
 * (Isarphilharmonie, Prinzregententheater, Cuvilliés-Theater, Herkulessaal …).
 *
 * Die Liste ist ein Drupal-View mit ausgestellten Filtern:
 *
 *   GET /mm/veranstaltungen
 *       ?field_event_date_value=DD.MM.YYYY      (erster Tag)
 *       &field_event_date_value_1=DD.MM.YYYY    (letzter Tag)
 *       &page=N
 *
 * Der Zeitraum lässt sich also am Stück anfragen – gepaged wird zu je zehn
 * Terminen, bis der Pager keinen „Mehr Veranstaltungen"-Link mehr trägt. Das
 * ist über einen Zeitraum von mehreren Monaten sparsamer als Monat für Monat.
 * `items_per_page` ist nicht ausgestellt und wird ignoriert.
 *
 * Der View kennt keine Vergangenheit: ein abgelaufener Zeitraum liefert
 * dieselbe Leermeldung wie eine Spielzeitpause. Liegt der ganze Bereich hinter
 * uns, fragen wir gar nicht erst.
 *
 * Eine Gattung führt die Quelle nur als Filter (Klassik, Ballett, Film …),
 * nicht am Termin – sie stünde nur über einen zweiten Durchlauf je Genre zur
 * Verfügung. Dafür greift `defaultCategory`.
 */

const BASE = 'https://www.muenchenmusik.de';
const LIST = `${BASE}/mm/veranstaltungen`;

/** Sicherheitsnetz: zehn Termine je Seite, also 400 im angefragten Zeitraum. */
const MAX_PAGES = 40;

/** Wie viele Folgeseiten auf einmal – zurückhaltend, aber nicht seriell. */
const BATCH = 3;

export const muenchenmusik: EventSource = {
  definition: {
    id: 'muenchenmusik',
    name: 'MünchenMusik',
    cityId: 'muenchen',
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
    // Vergangene Zeiträume kennt die Quelle nicht – das ist kein Fehler.
    if (range.to < today()) return [];

    const events: CalendarEvent[] = [];

    // Erst Seite 0 allein: sie entscheidet über Layoutbruch und leeren
    // Zeitraum, bevor überhaupt weitere Anfragen losgehen.
    const first = await loadPage(range, 0, signal, options);
    events.push(...first.events);

    // Danach in Dreierschritten weiter. Wie viele Seiten es gibt, sagt die
    // Quelle nicht – eine Seite hinter der letzten antwortet aber mit
    // derselben Leermeldung, ein Überschuss kostet also nur die Anfrage.
    let done = !first.hasNextPage;
    for (let page = 1; !done && page < MAX_PAGES; page += BATCH) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(BATCH, MAX_PAGES - page) }, (_, index) =>
          loadPage(range, page + index, signal, options),
        ),
      );

      for (const result of batch) {
        events.push(...result.events);
        if (!result.hasNextPage) done = true;
        if (done) break;
      }
    }

    if (!done) {
      console.warn(`[muenchenmusik] Seitenlimit erreicht – Zeitraum ${range.from}..${range.to}`);
    }

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'muenchenmusik',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      cacheKey: productionKey,
    });
  },
};

/**
 * Eine Seite holen und prüfen. Der Pager steht auch über einer leeren
 * Trefferliste; fehlt er, ist es keine Liste mehr. Eine ausdrückliche
 * Leermeldung ist dagegen eine gültige Auskunft.
 */
async function loadPage(
  range: FetchRange,
  page: number,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<ParseResult> {
  const html = await fetchText(pageUrl(range, page), {
    signal,
    timeoutMs: options?.requestTimeoutMs,
  });

  const result = parseListPage(html);

  if (!result.rendered) {
    throw new Error(`Veranstaltungen Seite ${page}: kein Pager (Layout geändert?)`);
  }
  assertRecognised(result.blocks, result.empty, `Veranstaltungen Seite ${page}`);
  if (result.skipped > 0) {
    console.warn(`[muenchenmusik] Seite ${page}: ${result.skipped} Block/Blöcke übersprungen`);
  }

  return result;
}

function pageUrl(range: FetchRange, page: number): string {
  const params = new URLSearchParams({
    field_event_date_value: german(range.from),
    field_event_date_value_1: german(range.to),
    page: String(page),
  });
  return `${LIST}?${params.toString()}`;
}

/** "2026-11-30" → "30.11.2026", wie das Datumsfeld des Views es erwartet. */
function german(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}

/**
 * Mehrere Abende teilen sich eine Produktionsseite – der Detailtext wird
 * darüber einmal geholt statt je Vorstellung.
 */
function productionKey(event: CalendarEvent): string | undefined {
  try {
    const url = new URL(event.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return event.url;
  }
}

export default muenchenmusik;
