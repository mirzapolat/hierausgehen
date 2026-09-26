import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseDetailDescription, parseProgramme } from './parse.ts';
import { assertRecognised } from '../page.ts';
import { today, withinRange } from '../collect.ts';

/**
 * Literaturhaus München.
 *
 * Ausnahmsweise ohne Monatsschleife: `/programm/` liefert das gesamte
 * veröffentlichte Programm in einer einzigen Antwort – beim Schreiben dieses
 * Adapters zehn Monate am Stück, ohne Blättern und ohne Parameter für den
 * Zeitraum. Ein Abruf ist damit sparsamer als zwölf, und der Zuschnitt auf den
 * gefragten Ausschnitt passiert hier.
 *
 * Vergangenes kennt die Seite nicht. Liegt der gefragte Zeitraum vollständig
 * hinter uns, wird sie deshalb gar nicht erst angefasst.
 *
 * Programmtexte stehen nur auf den Veranstaltungsseiten. Da jeder Termin genau
 * eine eigene Seite hat, deckt der gemeinsame Detail-Helfer das ab: er cacht je
 * Adresse einen Tag lang und hat ein eigenes Zeitbudget.
 */

const BASE = 'https://www.literaturhaus-muenchen.de';
const PROGRAMME = `${BASE}/programm/`;

export const literaturhaus: EventSource = {
  definition: {
    id: 'literaturhaus',
    name: 'Literaturhaus München',
    cityId: 'muenchen',
    group: 'Literatur',
    defaultCategory: 'Literatur',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    // Die Quelle führt kein Archiv – ein rein vergangener Zeitraum ist kein
    // Fehler, sondern schlicht nichts.
    if (range.to < today()) return [];

    const html = await fetchText(PROGRAMME, { signal, timeoutMs: options?.requestTimeoutMs });
    const { events, skipped, empty } = parseProgramme(html);

    // Eine gerenderte, aber leere Liste wäre eine gültige Auskunft (Programm
    // noch nicht veröffentlicht). Fehlt der Container, hat sich der Aufbau
    // geändert – dann lieber werfen und den Cache ausliefern lassen.
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[literaturhaus] ${skipped} Block/Blöcke übersprungen`);

    const filtered = events.filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'literaturhaus',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
    });
  },
};

export default literaturhaus;
