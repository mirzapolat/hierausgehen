import type { CalendarEvent, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TZ, monthsInRange } from '../../time.ts';
import { parseScheduleFragment, parseSparten } from './parse.ts';

/**
 * Staatstheater am Gärtnerplatz.
 *
 * Die Spielplanseite enthält selbst keine Termine – sie lädt sie nach:
 *
 *   GET /de/spielplan/index.html?ajax=1&offset={N}&letzterTermin=0
 *
 * `offset` ist **kein** Monat, sondern der Abstand in Monaten zum laufenden
 * Monat: 0 ist der aktuelle, 1 der nächste und so fort. Vergangenes gibt die
 * Quelle nicht heraus, negative Werte gibt es nicht. Hinter dem letzten
 * geplanten Monat antwortet sie mit „ende erreicht.".
 *
 * `letzterTermin` ist im Original ein Cursor mit der Unix-Zeit des zuletzt
 * gezeigten Termins. Mit `0` liefert dieselbe Seite den vollständigen Monat –
 * mit dem echten Cursor fehlt der jeweils erste Termin. Deshalb immer `0`.
 *
 * Die Gattungsnamen stehen nicht in den Fragmenten, sondern als Beschriftung
 * der Filter auf der Spielplanseite. Die wird einmal je Abruf mitgelesen,
 * damit keine Tabelle im Code veraltet.
 */

const BASE = 'https://www.gaertnerplatztheater.de';
const SCHEDULE = `${BASE}/de/spielplan/index.html`;

export const gaertnerplatz: EventSource = {
  definition: {
    id: 'gaertnerplatz',
    name: 'Staatstheater am Gärtnerplatz',
    cityId: 'muenchen',
    group: 'Oper & Ballett',
    color: '#7A4FA0',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(range: FetchRange, signal?: AbortSignal): Promise<CalendarEvent[]> {
    const current = currentMonth();
    const offsets = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7))
      .map((month) => ({ month, offset: monthIndex(month) - monthIndex(current) }))
      // Vergangene Monate kennt die Quelle nicht – das ist kein Fehler.
      .filter((entry) => entry.offset >= 0);

    if (offsets.length === 0) return [];

    const sparten = await loadSparten(signal);

    const results = await Promise.allSettled(
      offsets.map(async ({ month, offset }) => {
        const html = await fetchText(`${SCHEDULE}?ajax=1&offset=${offset}&letzterTermin=0`, { signal });
        const { events, skipped, end, empty, blocks } = parseScheduleFragment(html, sparten);

        // Leere Antwort und „ende erreicht." sind gültige Auskünfte. Inhalt
        // ohne einen einzigen Terminblock heisst dagegen: Aufbau geändert.
        if (!end && !empty && blocks === 0) {
          throw new Error(`Spielplan ${month} (offset ${offset}): kein Terminblock erkannt (Layout geändert?)`);
        }
        if (skipped > 0) {
          console.warn(`[gaertnerplatz] ${month}: ${skipped} Block/Blöcke übersprungen`);
        }
        return events;
      }),
    );

    const events: CalendarEvent[] = [];
    const failures: string[] = [];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failures.push(`${offsets[i].month}: ${errorMessage(result.reason)}`);
    }

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    if (failures.length === offsets.length) throw new Error(failures.join('; '));
    if (failures.length) console.warn(`[gaertnerplatz] Teilausfall – ${failures.join('; ')}`);

    return dedupeById(events).filter((event) => withinRange(event.start, range));
  },
};

/**
 * Gattungsnamen von der Spielplanseite lesen. Schlägt das fehl, laufen die
 * Termine ohne Gattung weiter – das ist besser als der ganze Monat.
 */
async function loadSparten(signal?: AbortSignal): Promise<Record<string, string>> {
  try {
    return parseSparten(await fetchText(SCHEDULE, { signal, retries: 1 }));
  } catch (error) {
    console.warn(`[gaertnerplatz] Gattungen nicht lesbar: ${errorMessage(error)}`);
    return {};
  }
}

/** Laufender Monat in Münchner Zeit – Bezugspunkt für `offset`. */
function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(
    new Date(),
  );
}

function monthIndex(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return year * 12 + m;
}

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default gaertnerplatz;
