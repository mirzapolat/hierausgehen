import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TZ, monthsInRange } from '../../time.ts';
import { parseAvailableMonths, parseMonthPage } from './parse.ts';

/**
 * Unterfahrt – Jazzclub in der Einsteinstrasse, spielt praktisch jeden Abend.
 *
 * Die Monatsseite lädt ihre Konzerte serverseitig; nachgeladen wird nur beim
 * Filtern, und zwar auf dieselbe Adresse. Die Parameter dafür stehen im
 * Seitenskript (`{month, year}` aus dem Datepicker) und funktionieren auch
 * ohne JavaScript:
 *
 *   GET /programm.php?month=MM&year=YYYY
 *
 * Ohne Parameter kommt der laufende Monat. Ein Archiv gibt es nicht: jeder
 * Monat vor dem laufenden antwortet leer, deshalb werden solche Monate gar
 * nicht erst angefragt.
 *
 * Jede Antwort trägt ausserdem die Liste der Monate, für die der Club
 * überhaupt ein Programm hat (`window.rootData.filter.datepicker` – damit
 * graut die Seite leere Monate im Kalender aus). Die kostet keine eigene
 * Anfrage und dient hier als zweites Signal: ein Monat ohne Konzert, den
 * diese Liste führt, ist kein leerer Monat, sondern ein Bruch im Aufbau.
 *
 * Programmtexte stehen vollständig in der Liste – Detailseiten werden nicht
 * gebraucht. Eine Gattung führt die Quelle nicht; die Reihen ("Bigband
 * Night", "Vocal Jazz") stehen als Schlagworte in den Hinweisen.
 */

const BASE = 'https://www.unterfahrt.de';

export const unterfahrt: EventSource = {
  definition: {
    id: 'unterfahrt',
    name: 'Unterfahrt',
    cityId: 'muenchen',
    group: 'Konzert',
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
    // Kein Archiv: vergangene Monate antworten leer und werden übersprungen.
    const current = today().slice(0, 7);
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7)).filter(
      (month) => month >= current,
    );
    if (months.length === 0) return [];

    const results = await Promise.allSettled(
      months.map(async (month) => {
        const [year, m] = month.split('-');
        const html = await fetchText(`${BASE}/programm.php?month=${m}&year=${year}`, {
          signal,
          timeoutMs: options?.requestTimeoutMs,
        });

        const { events, skipped, empty } = parseMonthPage(html);

        // Fehlt der Container, wurde die Liste gar nicht gerendert.
        if (!empty && events.length === 0) {
          throw new Error(`${month}: kein Konzertblock erkannt (Layout geändert?)`);
        }
        // Leer, obwohl die Seite selbst diesen Monat als bespielt führt.
        if (empty && parseAvailableMonths(html).includes(month)) {
          throw new Error(`${month}: laut Datepicker bespielt, aber leer (Layout geändert?)`);
        }
        if (skipped > 0) console.warn(`[unterfahrt] ${month}: ${skipped} Block/Blöcke übersprungen`);

        return events;
      }),
    );

    const events: CalendarEvent[] = [];
    const failures: string[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failures.push(`${months[index]}: ${errorMessage(result.reason)}`);
    }

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    if (failures.length === months.length) throw new Error(failures.join('; '));
    if (failures.length) console.warn(`[unterfahrt] Teilausfall – ${failures.join('; ')}`);

    return events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );
  },
};

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default unterfahrt;
