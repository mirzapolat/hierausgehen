import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { parseProgrammePage } from './parse.ts';
import { assertRecognised } from '../page.ts';

/**
 * Bahnwärter Thiel – Kulturhaus, Club und Open-Air-Gelände an der
 * Tumblingerstrasse: Clubnächte, Open Airs, Poetry Slam, Comedy, Flohmarkt.
 *
 * Die Startseite ist das Programm. Sie rendert die gesamte angekündigte Zeit
 * serverseitig, nach Monaten geschachtelt, dazu einen Abschnitt "Archiv" mit
 * den vergangenen Wochen. Einen Parameter für den Zeitraum gibt es nicht und
 * eine Schnittstelle auch nicht: die WordPress-REST-Routen führen keinen
 * Termin-Typ, der Beitragstyp `calendar` enthält nur die Atelierpark-Seite.
 * Also ein Abruf, danach lokal schneiden.
 *
 * Eine Gattung nennt die Seite nirgends – weder als Klasse noch als Text.
 * Deshalb bleibt es beim Quellen-Fallback "Party"; die Abende, die keine
 * Clubnacht sind, erkennt man am Titel, nicht an den Daten.
 *
 * Detailseiten gibt es nicht: jeder Termin ist eine Aufklappbox auf der
 * Startseite, der Ankündigungstext steht bereits darin.
 *
 * Zur robots.txt: gesperrt sind nur `/wp-admin/` und die Formular-Uploads.
 * Das Programm und die Ticketseite sind ausdrücklich frei.
 */

const BASE = 'https://www.bahnwaerterthiel.de';

export const bahnwaerterthiel: EventSource = {
  definition: {
    id: 'bahnwaerterthiel',
    name: 'Bahnwärter Thiel',
    cityId: 'muenchen',
    group: 'Club',
    defaultCategory: 'Party',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const html = await fetchText(`${BASE}/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty } = parseProgrammePage(html);

    // Ein leerer, aber vorhandener Container ist eine Spielpause; fehlt er,
    // hat sich der Aufbau geändert (siehe `page.ts`).
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[bahnwaerterthiel] ${skipped} Block/Blöcke übersprungen`);

    return events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );
  },
};

export default bahnwaerterthiel;
