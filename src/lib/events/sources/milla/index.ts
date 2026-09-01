import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TZ } from '../../time.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

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

    const { events, skipped } = parseProgrammePage(html, today());

    // Es gibt genau diese eine Seite. Kein Termin darauf heisst nicht
    // "Spielpause", sondern: der Aufbau hat sich geändert.
    if (events.length === 0) throw new Error('Kein Termin erkannt (Layout geändert?)');
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

/** Heutiger Tag in Münchner Zeit – Bezugspunkt für das fehlende Jahr. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default milla;
