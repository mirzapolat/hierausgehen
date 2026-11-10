import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { assertRecognised } from '../page.ts';
import { today, withinRange } from '../collect.ts';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

/**
 * Bergson Kunstkraftwerk – Kulturhaus im ehemaligen Heizkraftwerk Aubing:
 * Klassik und Jazz im Elektra Tonquartier und in der Barbastelle, dazu Wort,
 * Partys, Yoga, Familienprogramm und Brunch.
 *
 * `/programm` rendert die gesamte angekündigte Spielzeit serverseitig, ohne
 * Blättern und ohne Zeitraum-Parameter (das Filterformular schickt nur
 * Schlagworte und einen Einzeltag an `/events/filter`). Also ein Abruf,
 * danach lokal schneiden. Vergangenes führt die Seite nicht.
 *
 * Der lange Programmtext steht nur auf der Detailseite (im `ld+json`-Event)
 * und wird nachgeladen. robots.txt: `Allow: /`.
 */

const BASE = 'https://bergson.com';

export const bergson: EventSource = {
  definition: {
    id: 'bergson',
    name: 'Bergson Kunstkraftwerk',
    cityId: 'muenchen',
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
    // Die Seite kennt nur Gegenwart und Zukunft.
    if (range.to < today()) return [];

    const html = await fetchText(`${BASE}/programm`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped, empty } = parseProgrammePage(html);

    // Leer heisst: Listen-Container da, aber kein Termin. Fehlt der
    // Container, hat sich der Aufbau geändert.
    assertRecognised(events.length, empty, 'Programm');
    if (skipped > 0) console.warn(`[bergson] ${skipped} Block/Blöcke übersprungen`);

    return enrichEventDescriptions({
      sourceId: 'bergson',
      events: events.filter((event) => withinRange(event.start, range)),
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
    });
  },
};

export default bergson;
