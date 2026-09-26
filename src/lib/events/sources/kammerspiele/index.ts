import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';
import { assertRecognised } from '../page.ts';

/**
 * Münchner Kammerspiele – Schauspielhaus, Werkraum, Therese-Giehse-Halle,
 * Habibi Kiosk.
 *
 * Anders als bei den meisten Häusern gibt es hier nichts nachzuladen und
 * nichts zu blättern: `/de/programm/` rendert die **komplette Spielzeit**
 * serverseitig, in der Fixture gut ein Jahr im Voraus. Ein Monatsparameter
 * existiert nicht – die Filter der Seite (Ort, Themen, Abos) sind reine
 * Anzeigefilter. Also ein Abruf, danach lokal auf den Zeitraum schneiden.
 *
 * Vergangenes führt die Seite nicht; ein rein vergangener Zeitraum ist
 * deshalb schlicht leer und kein Fehler.
 *
 * Eine Gattung führt die Quelle nicht – die Filter kennen Ort und Thema, aber
 * keine Sparte. Deshalb `defaultCategory: 'Theater'`, das auch Konzerte,
 * Lesungen und Führungen im Haus mitträgt.
 *
 * Programmtexte stehen nur auf der Produktionsseite. Die Termin-URL trägt die
 * Vorstellung im Query (`?activity=52293`); der Cache-Schlüssel schneidet ihn
 * ab, damit alle Abende einer Produktion einen einzigen Abruf teilen.
 */

const BASE = 'https://www.muenchner-kammerspiele.de';
const PROGRAMME = `${BASE}/de/programm/`;

export const kammerspiele: EventSource = {
  definition: {
    id: 'kammerspiele',
    name: 'Münchner Kammerspiele',
    cityId: 'muenchen',
    group: 'Theater',
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
    const html = await fetchText(PROGRAMME, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty } = parseProgrammePage(html);

    // Ein leerer, aber vorhandener Container ist eine Spielpause; fehlt er,
    // hat sich der Aufbau geändert (siehe `page.ts`).
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[kammerspiele] ${skipped} Block/Blöcke übersprungen`);

    const filtered = events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );

    return enrichEventDescriptions({
      sourceId: 'kammerspiele',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      cacheKey: (event) => event.url.split('?')[0],
      fetchUrl: (event) => event.url.split('?')[0],
    });
  },
};

export default kammerspiele;
