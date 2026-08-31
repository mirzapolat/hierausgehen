import type { EventFetchOptions, EventSource, CalendarEvent, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { enrichEventDescriptions } from '../detail.ts';
import { parseCalendarFragment, parseDetailDescription } from './parse.ts';

/**
 * Bayerische Staatsoper.
 *
 * Der Spielplan liegt pro Monat unter `/spielplan/{YYYY-MM}`. Wir holen die
 * Ajax-Variante derselben Seite:
 *
 *   GET https://www.staatsoper.de/spielplan/{YYYY-MM}/calendar.ajax
 *
 * Sie enthält denselben vollständigen Monat inklusive Ticketstatus, aber nur
 * das Listenfragment – rund ein Fünftel der Übertragung, ohne JavaScript und
 * ohne Paging.
 *
 * Die Seite steht hinter einer Bot-Erkennung, die am TLS-Handshake ansetzt.
 * Darum geht der Abruf über `fetchText` aus `../../http.ts`; ein einfacher
 * `fetch` bekommt hier 403.
 *
 * Vergangene Monate liefert die Quelle bewusst leer („In diesem Zeitraum gibt
 * es keine Vorstellungen"). Das ist kein Fehler und wird auch nicht als solcher
 * behandelt.
 *
 * Dieser Adapter ist die Vorlage für weitere Quellen – siehe `../_template.ts`.
 */

const BASE = 'https://www.staatsoper.de';

export const staatsoper: EventSource = {
  definition: {
    id: 'staatsoper',
    name: 'Bayerische Staatsoper',
    cityId: 'muenchen',
    group: 'Oper & Ballett',
    defaultCategory: 'Oper & Ballett',
    color: '#B4472E',
    homepage: BASE,
    // Die Staatsoper liefert unter /favicon.ico nichts; dies ist der Stand des
    // versionierten Assets, falls die Erkennung über die Startseite ausfällt.
    iconUrl: `${BASE}/_assets/66a8104d9e7fe1b5c2a81d582940c903/Favicons/favicon-32x32.png`,
    enabledByDefault: true,
  },

  // Ticketstatus veraltet schnell; der Spielplan selbst ändert sich selten.
  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7));

    const results = await Promise.allSettled(
      months.map(async (month) => {
        const html = await fetchText(`${BASE}/spielplan/${month}/calendar.ajax`, {
          signal,
          timeoutMs: options?.requestTimeoutMs,
        });
        const { events, skipped, empty } = parseCalendarFragment(html);

        // Kein Termin und keine Leermeldung heisst: die Seite antwortet zwar,
        // aber ihr Aufbau hat sich geändert. Das muss auffallen.
        if (events.length === 0 && !empty) {
          throw new Error(`Spielplan ${month}: kein Termin erkannt (Layout geändert?)`);
        }
        if (skipped > 0) {
          console.warn(`[staatsoper] ${month}: ${skipped} Zeile(n) übersprungen`);
        }
        return events;
      }),
    );

    const events: CalendarEvent[] = [];
    const failures: string[] = [];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failures.push(`${months[i]}: ${errorMessage(result.reason)}`);
    }

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    if (failures.length === months.length) {
      throw new Error(failures.join('; '));
    }
    if (failures.length) {
      console.warn(`[staatsoper] Teilausfall – ${failures.join('; ')}`);
    }

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return enrichEventDescriptions({
      sourceId: 'staatsoper',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      cacheKey: productionKey,
    });
  },
};

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

function productionKey(event: CalendarEvent): string | undefined {
  try {
    const url = new URL(event.url);
    const pathname = url.pathname.replace(/\/\d{4}-\d{2}-\d{2}-\d{4}-\d+\/?$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return event.url;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default staatsoper;
