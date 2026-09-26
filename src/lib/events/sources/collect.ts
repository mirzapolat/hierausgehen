import type { CalendarEvent, FetchRange } from '../types.ts';
import { todayInZone } from '../schedule.ts';
import { TZ } from '../time.ts';

/**
 * Werkzeuge, die fast jedes Adapter beim Einsammeln braucht. Vorher stand
 * jedes davon als Kopie in den einzelnen Quellen.
 */

/**
 * Lädt eine Quelle in Teilen – Monate, Sparten, Seiten – und hält dabei die
 * gemeinsame Regel ein: **einzelne Lücken sind hinnehmbar, ein Totalausfall
 * nicht.** Fällt ein Teil aus, wird das protokolliert und der Rest geliefert;
 * fallen alle aus, wirft die Funktion mit den gesammelten Gründen, damit die
 * Aggregation den letzten Stand behält.
 *
 * `sequential` für Quellen, die ihre Liste in einer Sitzung führen und
 * parallele Anfragen durcheinanderbringen würden.
 */
export async function settleParts<Part, Result>(options: {
  sourceId: string;
  parts: readonly Part[];
  load: (part: Part) => Promise<Result>;
  /** Wie ein Teil in der Fehlermeldung heisst; Voreinstellung `String(part)`. */
  label?: (part: Part) => string;
  sequential?: boolean;
}): Promise<Result[]> {
  const { sourceId, parts, load, label = String, sequential = false } = options;

  const settled: PromiseSettledResult<Result>[] = [];
  if (sequential) {
    for (const part of parts) {
      try {
        settled.push({ status: 'fulfilled', value: await load(part) });
      } catch (reason) {
        settled.push({ status: 'rejected', reason });
      }
    }
  } else {
    settled.push(...(await Promise.allSettled(parts.map(load))));
  }

  const results: Result[] = [];
  const failures: string[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') results.push(result.value);
    else failures.push(`${label(parts[index])}: ${errorMessage(result.reason)}`);
  }

  if (parts.length > 0 && failures.length === parts.length) throw new Error(failures.join('; '));
  if (failures.length) console.warn(`[${sourceId}] Teilausfall – ${failures.join('; ')}`);
  return results;
}

/** Liegt der Beginn eines Termins im angefragten Zeitraum (beide Tage inklusive)? */
export function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

/** Doppelte Termine derselben Quelle zusammenlegen; der letzte gewinnt. */
export function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const event of events) byId.set(event.id, event);
  return [...byId.values()];
}

/** Heute in der Zeitzone der Münchner Quellen, als ISO-Tag. */
export function today(): string {
  return todayInZone(TZ);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
