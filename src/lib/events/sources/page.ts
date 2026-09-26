import type { CalendarEvent } from '../types.ts';

/**
 * Was ein Parser über eine Terminseite weiss – mehr als nur die Termine.
 *
 * Eine Seite ohne Termine kann zweierlei heissen, und beides muss der Parser
 * auseinanderhalten, weil nur er das Markup kennt:
 *
 * - **leer** (`empty: true`): die Liste ist da und erkannt, kündigt aber
 *   nichts an – Saisonpause, spielfreier Monat. Das ist ein gültiger Stand
 *   mit null Terminen, keine Störung.
 * - **nicht erkannt** (`empty: false`, keine Termine): die erwartete Liste
 *   fehlt. Meist hat sich das Layout geändert; das Adapter wirft, damit die
 *   Aggregation den letzten Stand behält und die Quelle als gestört meldet.
 *
 * Leer heisst deshalb: der Container der Liste ist gefunden, oder die Seite
 * sagt selbst, dass nichts ansteht. Nie bloss „nichts gefunden“.
 */
export interface PageResult {
  events: CalendarEvent[];
  /** Blöcke, die sich nicht vollständig lesen liessen – für Monitoring/Logs. */
  skipped: number;
  /** Liste erkannt, aber ohne Termin. */
  empty: boolean;
}

/**
 * Wirft, wenn eine Seite weder Termine noch eine erkennbar leere Liste
 * geliefert hat. `found` ist, was der Parser gezählt hat – meist
 * `events.length`, bei manchen Quellen die gelesenen Blöcke.
 */
export function assertRecognised(found: number, empty: boolean, where: string): void {
  if (found === 0 && !empty) throw new Error(`${where}: kein Termin erkannt (Layout geändert?)`);
}
