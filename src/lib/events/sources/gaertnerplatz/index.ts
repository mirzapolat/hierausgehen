import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { type CookieJar, createCookieJar, fetchText } from '../../http.ts';
import { parseEventList, parseSparten } from './parse.ts';
import { dedupeById, settleParts, withinRange } from '../collect.ts';

/**
 * Staatstheater am Gärtnerplatz – über den Kartenshop des Staatstheaters
 * (EVENTIM.Inhouse) statt über die eigene Spielplanseite.
 *
 * Der Shop gibt nur innerhalb einer Sitzung Auskunft. Der Ablauf ist deshalb
 * zweistufig:
 *
 *   1. GET  /gpt.webshop/webticket/shop            → 302 auf `eventlist`,
 *      setzt dabei die `JSESSIONID`. Dieselbe Antwort trägt die Sparten.
 *   2. POST /gpt.webshop/webticket/include/eventlistdelta
 *      mit `index`, `genre` und `date_begin` – das Fragment einer Seite.
 *
 * `index` ist **keine** Position, sondern die Seitennummer; eine Seite fasst
 * zehn Termine. Die letzte Seite trägt `<li id="listend">`. `date_begin` im
 * Format `TT.MM.JJJJ` wirkt, `date_end` wird vom Shop ignoriert — das Ende des
 * Zeitraums schneidet deshalb dieser Adapter selbst ab.
 *
 * Die Gattung steht an keinem Termin. Sie ergibt sich daraus, mit welchem
 * Sparten-Filter die Liste geholt wurde: der Adapter läuft die Sparten einzeln
 * ab, und jeder Termin trägt danach die seine. Die Sparten selbst kommen aus
 * dem Filter der Shop-Seite, damit keine Tabelle im Code veraltet.
 *
 * Was der Shop **nicht** kann: er führt nur, was gerade im Verkauf ist. Das
 * sind je nach Vorverkauf zwei bis drei Monate, nicht die zwölf des
 * Spielplans. Vergangenes gibt er gar nicht heraus, Endzeiten und
 * Programmtexte führt er nicht.
 */

const BASE = 'https://tickets.staatstheater.bayern';
/** Eröffnet die Sitzung (302 auf die Terminliste) und liefert die Sparten. */
const SHOP = `${BASE}/gpt.webshop/webticket/shop`;
const DELTA = `${BASE}/gpt.webshop/webticket/include/eventlistdelta`;

/** Zehn Termine je Seite; mehr als das ist eine Notbremse, kein Erwartungswert. */
const MAX_PAGES = 20;

export const gaertnerplatz: EventSource = {
  definition: {
    id: 'gaertnerplatz',
    name: 'Staatstheater am Gärtnerplatz',
    cityId: 'muenchen',
    group: 'Oper & Ballett',
    // Greift nur, wenn die Sparten einmal nicht lesbar sind – dann ist der
    // gemeinsame Nenner des Hauses die ehrlichste Auskunft.
    defaultCategory: 'Musiktheater',
    homepage: 'https://www.gaertnerplatztheater.de',
    // Ausnahmsweise fest: die Erkennung liefe über die Startseite des Hauses,
    // und genau die erreicht dieser Server nicht (der Grund für den Umzug in
    // den Shop). Das Logo liegt beim Shop und ist von hier aus erreichbar.
    iconUrl: `${BASE}/gpt.webshop/images/responsive/Logo%20GPT_ICO.png`,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const jar = createCookieJar();
    const shopPage = await fetchText(SHOP, {
      jar,
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const sparten = parseSparten(shopPage);
    if (sparten.length === 0) {
      console.warn('[gaertnerplatz] keine Sparten im Filter gefunden – Termine ohne Gattung');
    }

    // Ohne Sparten bleibt die ungefilterte Liste: lieber Termine ohne Gattung
    // als gar keine. `genre: '0'` ist im Shop „alle Sparten".
    const filters = sparten.length > 0 ? sparten : [{ id: '0', name: '' }];

    // Eine kaputte Sparte ist zu verschmerzen, ein Totalausfall nicht.
    // Bewusst nacheinander: der Shop führt die Liste in der Sitzung, und
    // elf kleine Abrufe am Tag sind ihm zuzumuten, ein Schwall nicht.
    const collected = await settleParts({
      sourceId: 'gaertnerplatz',
      parts: filters,
      label: (sparte) => sparte.name || 'alle Sparten',
      load: (sparte) => collectSparte(jar, sparte, range, signal, options),
      sequential: true,
    });
    const events = collected.flatMap((sparte) => sparte.events);
    const blocks = collected.reduce((sum, sparte) => sum + sparte.blocks, 0);

    // Antwortet der Shop, ohne dass ein einziger Block zu erkennen ist, hat
    // sich sein Aufbau geändert. Ein stilles „keine Veranstaltungen" wäre die
    // schlechtere Antwort – die Aggregation soll den Cache ausliefern.
    if (blocks === 0) {
      throw new Error('Kein Terminblock in der Liste erkannt (Layout geändert?)');
    }

    return dedupeById(events).filter((event) => withinRange(event.start, range));
  },
};

/** Alle Seiten einer Sparte, bis der Shop das Ende meldet. */
async function collectSparte(
  jar: CookieJar,
  sparte: { id: string; name: string },
  range: FetchRange,
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<{ events: CalendarEvent[]; blocks: number }> {
  const events: CalendarEvent[] = [];
  let blocks = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await fetchText(DELTA, {
      jar,
      body: deltaBody(sparte.id, page, range.from),
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const result = parseEventList(html, sparte.name || undefined);

    // Die Fehlerseite ist keine leere Sparte, sondern eine verlorene Sitzung.
    // Sie stillschweigend als „nichts gefunden" zu zählen, hiesse den Kalender
    // zu leeren, sobald der Shop die Sitzung schliesst.
    if (result.sessionLost) {
      throw new Error(`Sitzung abgelaufen (Seite ${page})`);
    }
    if (result.skipped > 0) {
      console.warn(`[gaertnerplatz] ${sparte.name}: ${result.skipped} Block/Blöcke übersprungen`);
    }

    blocks += result.blocks;
    events.push(...result.events);

    // Die letzte Seite meldet sich selbst; eine Seite ohne Block ist ebenfalls
    // das Ende (eine Sparte ohne Termine im Zeitraum kommt genau so daher).
    if (result.end || result.blocks === 0) return { events, blocks };
  }

  console.warn(`[gaertnerplatz] ${sparte.name}: nach ${MAX_PAGES} Seiten abgebrochen`);
  return { events, blocks };
}

/**
 * Der Shop erwartet das vollständige Filterformular, auch wo nichts gefiltert
 * wird. `weekdaysstring` ist die Wochentagsmaske: sieben `N` heisst „kein Tag
 * ausgeschlossen".
 */
function deltaBody(genre: string, page: number, from: string): string {
  return new URLSearchParams({
    index: String(page),
    genre,
    production: '0',
    date_begin: germanDate(from),
    date_end: '',
    weekdaysstring: 'NNNNNNN',
    venue: '0',
    performanceLocation: '0',
    eventTitle: '',
    showOnlyBookableEvents: '',
    showOnlyMagicCodeEvents: 'true',
  }).toString();
}

/** "2026-10-01" → "01.10.2026". */
function germanDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export default gaertnerplatz;
