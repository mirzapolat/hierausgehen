import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { parseProgrammeStart, parseProjections, type Clock } from './parse.ts';
import { assertRecognised } from '../page.ts';
import { today, withinRange } from '../collect.ts';

/**
 * Kino, Mond & Sterne – das Open-Air-Kino im Westpark.
 *
 * Die Seite ist eine Vue-Anwendung; im HTML steht kein einziger Termin. Die
 * Daten liegen offen als JSON:
 *
 *   GET /api/projections          alle noch kommenden Vorstellungen
 *   GET /api/projections/{jahr}   eine ganze Saison, auch vergangene
 *
 * Ohne Jahr liefert die Schnittstelle genau das, was der Kalender zeigt: ab
 * heute aufwärts, über die ganze Saison und ohne Blättern. Ein Abruf genügt.
 *
 * Achtung bei der Jahresvariante: ein Jahr ohne eigene Saison (2027, 2009)
 * gibt kommentarlos die **laufende** Saison zurück statt einer Leermeldung.
 * Wer damit vergangene Spielzeiten holen will, muss die Daten gegen das
 * angefragte Jahr prüfen. Hier wird sie deshalb gar nicht erst benutzt: das
 * Kino spielt nur im Sommer, und Vergangenes zeigt der Kalender ohnehin nicht.
 *
 * Eine Anfangszeit führt das Format nicht – der Film startet, wenn es dunkel
 * ist. Die Quelle nennt sie je Monat im FAQ, von dort wird sie gelesen.
 */

const BASE = 'https://www.kino-mond-sterne.de';
const PROJECTIONS = `${BASE}/api/projections`;
const FAQ = `${BASE}/api/single/wichtiges`;

const JSON_HEADERS = { accept: 'application/json' };

export const kinomondsterne: EventSource = {
  definition: {
    id: 'kinomondsterne',
    name: 'Kino, Mond & Sterne',
    cityId: 'muenchen',
    group: 'Kino',
    defaultCategory: 'Kino',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    // Kommendes ist alles, was die Schnittstelle hergibt – ein rein
    // vergangener Zeitraum ist kein Fehler, sondern schlicht nichts.
    if (range.to < today()) return [];

    const starts = await loadProgrammeStart(signal, options);

    const body = await fetchText(PROJECTIONS, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
      headers: JSON_HEADERS,
    });

    const { events, skipped, empty } = parseProjections(body, starts);

    // Eine leere Liste ist ausserhalb der Spielzeit die richtige Antwort.
    // Eine Antwort mit Vorstellungen, von denen keine lesbar ist, nicht.
    assertRecognised(events.length, empty, 'Vorstellungen');
    if (skipped > 0) console.warn(`[kinomondsterne] ${skipped} Vorstellung(en) übersprungen`);
    if (starts.size === 0) {
      console.warn('[kinomondsterne] Keine Anfangszeiten im FAQ gefunden – Termine bleiben ganztägig');
    }

    return events.filter((event) => withinRange(event.start, range));
  },
};

/**
 * Anfangszeiten je Monat aus dem FAQ. Beiwerk: fehlen sie, laufen die Termine
 * ganztägig weiter – das ist besser als eine erfundene Uhrzeit und besser als
 * gar kein Spielplan.
 */
async function loadProgrammeStart(
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<Map<number, Clock>> {
  try {
    return parseProgrammeStart(
      await fetchText(FAQ, {
        signal,
        retries: 0,
        timeoutMs: options?.requestTimeoutMs,
        headers: JSON_HEADERS,
      }),
    );
  } catch (error) {
    console.warn(
      `[kinomondsterne] Anfangszeiten nicht lesbar: ${error instanceof Error ? error.message : error}`,
    );
    return new Map();
  }
}

export default kinomondsterne;
