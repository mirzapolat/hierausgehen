/**
 * Reine Datumsrechnung für den Kalender.
 *
 * Alles läuft über ISO-Tagesstrings ("YYYY-MM-DD") und UTC-Mittag: Server und
 * Client kommen damit unabhängig von der Zeitzone auf dasselbe Raster.
 * Alle sichtbaren Formate stehen in `format.ts`, weil sie von den
 * Einstellungen abhängen.
 */

/**
 * "map" ist eine Tagesansicht mit anderen Mitteln: derselbe Zeitraum, dieselbe
 * Schrittweite, nur nach Ort statt nach Uhrzeit sortiert. Überall dort, wo es
 * um Datumsrechnung geht, verhält sie sich deshalb wie "day".
 */
export type ViewMode = 'day' | 'week' | 'month' | 'map';

/** Ansichten, die genau einen Tag zeigen. */
export function isDayView(view: ViewMode): boolean {
  return view === 'day' || view === 'map';
}

function utc(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function addDays(day: string, amount: number): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

export function addMonths(day: string, amount: number): string {
  const d = utc(day);
  const targetMonth = d.getUTCMonth() + amount;
  const anchor = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1, 12));
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12)).getUTCDate();
  anchor.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return anchor.toISOString().slice(0, 10);
}

/** 1 = Montag … 7 = Sonntag. */
export function weekday(day: string): number {
  return utc(day).getUTCDay() || 7;
}

export function startOfWeek(day: string): string {
  return addDays(day, -(weekday(day) - 1));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string): string {
  const d = utc(day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** 6×7-Raster einer Monatsansicht, beginnend am Montag. */
export function monthGrid(anchor: string): string[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** Sichtbarer Zeitraum einer Ansicht. */
export function visibleRange(view: ViewMode, anchor: string): { from: string; to: string } {
  if (isDayView(view)) return { from: anchor, to: anchor };
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const grid = monthGrid(anchor);
  return { from: grid[0], to: grid[41] };
}

/** So viele Monate im Voraus werden erhoben – mehr zeigt der Kalender nicht. */
export const COVERAGE_MONTHS = 12;

/**
 * Der gesamte Zeitraum, den der Server vorhält: der laufende Monat und die
 * elf folgenden. Ausserhalb davon gibt es keine Daten, und der Kalender lässt
 * sich auch nicht dorthin bewegen.
 */
export function coverageRange(today: string): { from: string; to: string } {
  const first = startOfMonth(today);
  return { from: first, to: endOfMonth(addMonths(first, COVERAGE_MONTHS - 1)) };
}

/**
 * Frühester Tag, bis zu dem eine Ansicht zurückblättern darf – Vergangenes
 * zeigt der Kalender nicht. Tag und Karte beginnen heute, die Woche mit
 * dieser Woche, der Monat mit diesem Monat. (Der scrollende Monat am
 * Schreibtisch beginnt wochenweise mit dieser Woche; das regelt die Ansicht.)
 */
export function navigationFloor(view: ViewMode, today: string): string {
  if (isDayView(view)) return today;
  if (view === 'week') return startOfWeek(today);
  return startOfMonth(today);
}

/** Der Zeitraum, in dem eine Ansicht blättern darf: ab heute, bis zum Ende der Erhebung. */
export function navigationRange(
  view: ViewMode,
  today: string,
  coverage: { from: string; to: string },
): { from: string; to: string } {
  const floor = navigationFloor(view, today);
  return { from: floor > coverage.from ? floor : coverage.from, to: coverage.to };
}

/** Hält einen Tag innerhalb des abgedeckten Zeitraums. */
export function clampDay(day: string, range: { from: string; to: string }): string {
  if (day < range.from) return range.from;
  if (day > range.to) return range.to;
  return day;
}

/**
 * Zeitraum, der geladen wird: die Sichtbarkeit plus Puffer, damit Blättern
 * nicht bei jedem Klick einen Netzwerkzugriff auslöst – begrenzt auf das,
 * was der Server überhaupt vorhält.
 */
export function loadRange(anchor: string, coverage: { from: string; to: string }): {
  from: string;
  to: string;
} {
  const month = `${anchor.slice(0, 7)}-01`;
  return {
    from: clampDay(startOfMonth(addMonths(month, -1)), coverage),
    to: clampDay(endOfMonth(addMonths(month, 1)), coverage),
  };
}
