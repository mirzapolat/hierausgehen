import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TIME_ZONE, parseDetailPage, parseListPage } from './parse.ts';
import { enrichEventDetails } from '../detail.ts';

/**
 * Glasgow Life – der städtische Kulturbetrieb Glasgows.
 *
 * Kein einzelnes Haus, sondern ein Dach über gut zwanzig Spielstätten: Royal
 * Concert Hall und City Halls (Sinfonik, RSNO/SCO/BBC SSO), Old Fruitmarket
 * und Barrowland (Pop), Tramway (Performance, Ausstellung), GoMA und
 * Kelvingrove (Ausstellung), Glasgow Film Theatre (Kino). Wir nehmen den
 * Kanal „Arts, Music and Culture"; Sport, Museen, Bibliotheken und
 * Stadtteilarbeit laufen unter eigenen Kanälen und bleiben draussen.
 *
 * Die Übersicht `/whats-on` ist ein serverseitig gerendertes Suchergebnis.
 * Sie kennt einen echten Zeitraumparameter (`start`/`end`, `dd/mm/yyyy`), und
 * zwar über die Vergangenheit hinweg – ein Januartermin von 2020 ist noch
 * abrufbar. Geblättert wird über `curPage`; wie viele Seiten es sind, sagt
 * die Blätterleiste auf der ersten. Alle Seiten müssen geholt werden: sortiert
 * wird nach Beginn, und weil der Filter auch alles zurückgibt, was in den
 * Zeitraum nur hineinragt, stehen die Monate lange laufender Ausstellungen
 * vorn und die eigentlichen Abende dahinter.
 *
 * Eine Gattung führt die Seite nirgends – nicht am Termin, nicht auf der
 * Detailseite, nicht als Filter. Es bleibt beim Quellen-Fallback „Kultur".
 *
 * Preise, Ticketlink und Ticketlage kennt die Liste nicht; sie stehen auf der
 * Detailseite, die ohnehin für den Programmtext geholt wird.
 *
 * Zur robots.txt: gesperrt sind nur die Umbraco-Pfade (`/umbraco/`, `/bin/`,
 * `/config/`, `/install/`, `/usync/`, `/app_plugins/`). `/whats-on` und
 * `/event/…` sind ausdrücklich frei.
 */

const BASE = 'https://www.glasgowlife.org.uk';
const CHANNEL = 'Arts, Music and Culture';
/** Notbremse, falls der Filter einmal ins Leere greift und alles zurückgibt. */
const MAX_PAGES = 30;
/** Rücksicht auf die Quelle: nie mehr als so viele Seiten gleichzeitig. */
const CONCURRENCY = 3;

export const glasgowlife: EventSource = {
  definition: {
    id: 'glasgowlife',
    name: 'Glasgow Life',
    cityId: 'glasgow',
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
    const load = (page: number) =>
      fetchText(listUrl(range, page), { signal, timeoutMs: options?.requestTimeoutMs });

    const first = parseListPage(await load(1));
    if (!first.recognised) {
      throw new Error('Keine Trefferliste erkannt (Layout geändert?)');
    }

    const events = [...first.events];
    let skipped = first.skipped;

    const pages = Math.min(first.pageCount, MAX_PAGES);
    if (first.pageCount > MAX_PAGES) {
      console.warn(`[glasgowlife] ${first.pageCount} Seiten, es werden ${MAX_PAGES} geholt`);
    }

    for (let page = 2; page <= pages; page += CONCURRENCY) {
      const batch = Array.from(
        { length: Math.min(CONCURRENCY, pages - page + 1) },
        (_, index) => page + index,
      );
      const results = await Promise.allSettled(batch.map(load));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          // Eine Lücke ist hinnehmbar, ein Totalausfall fällt unten auf.
          console.warn(`[glasgowlife] Seite ${batch[index]}: ${result.reason}`);
          return;
        }
        const parsed = parseListPage(result.value);
        events.push(...parsed.events);
        skipped += parsed.skipped;
      });
    }

    if (skipped > 0) console.warn(`[glasgowlife] ${skipped} Karte(n) ohne lesbares Datum`);

    // Kein Treffer ist ein gültiges Ergebnis: die Hülle der Seite steht auch
    // dann, und ein Dezember 2029 ist schlicht noch leer. Erkannt wird das am
    // Markup (`recognised`), nicht an der Antwortlänge.
    const filtered = events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );

    // Preise, Ticketlink und Ticketlage stehen nicht in der Liste, sondern
    // erst auf der Detailseite – zusammen mit dem langen Ankündigungstext.
    return enrichEventDetails({
      sourceId: 'glasgowlife',
      events: filtered,
      signal,
      fetchOptions: options,
      parse: parseDetailPage,
      // Für die Uhrzeit, die manche Läufe erst auf der Detailseite nennen.
      timeZone: TIME_ZONE,
    });
  },
};

/**
 * Die Filterseite erwartet alle ihre Felder, auch die leeren – wer `programme`
 * oder `cost` weglässt, bekommt die ungefilterte Liste zurück.
 */
function listUrl(range: FetchRange, page: number): string {
  const params = new URLSearchParams({
    channel: CHANNEL,
    programme: '',
    venue: '',
    age: '',
    cost: '',
    t: '',
    start: ukDate(range.from),
    end: ukDate(range.to),
    q: '',
  });
  if (page > 1) params.set('curPage', String(page));
  return `${BASE}/whats-on?${params}`;
}

/** "2026-10-01" -> "01/10/2026" */
function ukDate(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

export default glasgowlife;
