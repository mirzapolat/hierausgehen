import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';
import { assertRecognised } from '../page.ts';
import { today } from '../collect.ts';

/**
 * Milla – Club für Musik und Kunst in der Holzstrasse, fast täglich Livemusik.
 *
 * Die Startseite ist das Programm: sie rendert die gesamte angekündigte
 * Spielzeit serverseitig (in der Fixture 121 Termine von September bis Mai),
 * chronologisch sortiert, ohne Blättern. Ein Parameter für den Zeitraum
 * existiert nicht, eine Schnittstelle auch nicht – die WordPress-REST-Routen
 * kennen keinen eigenen Termin-Typ. Also ein Abruf, danach lokal schneiden.
 *
 * Vergangenes führt die Seite nicht; ein rein vergangener Zeitraum ist
 * deshalb leer und kein Fehler.
 *
 * Programmtext und Gattung stehen ausschliesslich auf der Detailseite; die
 * Liste hat weder das eine noch das andere. Der Text wird nachgeladen, die
 * Gattung bleibt beim Quellen-Fallback "Konzert".
 *
 * Zur robots.txt: sie sperrt gezielt KI-Crawler (ClaudeBot, GPTBot, CCBot …)
 * und setzt `Content-Signal: search=yes, use=reference, ai-train=no`. Für
 * `User-agent: *` gilt `Allow: /`. Dieser Adapter ist keiner der gesperrten
 * Crawler: er liest die öffentliche Seite, um auf sie zu verweisen – genau
 * der Gebrauch, den das Signal ausdrücklich erlaubt. Trainiert wird nichts.
 */

const BASE = 'https://milla-club.de';

export const milla: EventSource = {
  definition: {
    id: 'milla',
    name: 'Milla',
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
    // Die Seite kennt nur Gegenwart und Zukunft.
    if (range.to < today()) return [];

    const html = await fetchText(`${BASE}/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty } = parseProgrammePage(html, today());

    // Ein leerer, aber vorhandener Container ist eine Spielpause; fehlt er,
    // hat sich der Aufbau geändert (siehe `page.ts`).
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[milla] ${skipped} Block/Blöcke übersprungen`);

    const filtered = events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );

    return enrichEventDescriptions({
      sourceId: 'milla',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
    });
  },
};

export default milla;
