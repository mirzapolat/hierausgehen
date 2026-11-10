import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';
import { assertRecognised } from '../page.ts';
import { today } from '../collect.ts';

/**
 * Import Export – Kultur- und Clubhaus im Kreativquartier an der
 * Dachauer Strasse: Konzerte, Clubnächte, Diskussionen, Werkstätten.
 *
 * `/programm/` rendert serverseitig das komplette Programm in einer Antwort:
 * erst die angekündigten Termine, dann das Archiv zurück bis Anfang 2023
 * (in der Fixture 1052 Termine). Einen Parameter für den Zeitraum gibt es
 * nicht, blättern muss man nicht – also ein Abruf, danach lokal schneiden.
 * Vergangene Monate sind damit ebenfalls abgedeckt.
 *
 * Eine Schnittstelle gibt es nicht: der Custom-Post-Type `event` ist nicht
 * über die WordPress-REST-API veröffentlicht, ld+json führt die Seite keins.
 *
 * Programmtext steht ausschliesslich auf der Detailseite und wird für die
 * Termine im angefragten Zeitraum nachgeladen. Gattung, Datum und Uhrzeit
 * kommen dagegen aus der Liste.
 *
 * Die zweite vom Haus genannte Adresse, `rausgegangen.de/locations/
 * import-export`, wird nicht abgefragt: rausgegangen.de liegt hinter einer
 * JavaScript-Prüfung (bunny.net-Shield mit Proof-of-Work), die ohne Browser
 * keine Seite ausliefert. Ein Zugangsschutz wird nicht umgangen; die eigene
 * Seite des Hauses führt dasselbe Programm vollständiger.
 *
 * Zur robots.txt: sie sperrt nur `/wp-admin/`. `/programm/` und die
 * Detailseiten sind ausdrücklich frei.
 */

const BASE = 'https://import-export.cc';

export const importExport: EventSource = {
  definition: {
    id: 'import-export',
    name: 'Import Export',
    cityId: 'muenchen',
    group: 'Club',
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
    const html = await fetchText(`${BASE}/programm/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty } = parseProgrammePage(html, today());

    // Ein leerer, aber vorhandener Container ist eine Spielpause; fehlt er,
    // hat sich der Aufbau geändert (siehe `page.ts`).
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[import-export] ${skipped} Block/Blöcke übersprungen`);

    const filtered = events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );

    return enrichEventDescriptions({
      sourceId: 'import-export',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
    });
  },
};

export default importExport;
