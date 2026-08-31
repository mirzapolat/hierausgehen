/**
 * Reine Datumsrechnung für den Kalender.
 *
 * Alles läuft über ISO-Tagesstrings ("YYYY-MM-DD") und UTC-Mittag: Server und
 * Client kommen damit unabhängig von der Zeitzone auf dasselbe Raster.
 * Alle sichtbaren Formate stehen in `format.ts`, weil sie von den
 * Einstellungen abhängen.
 */

export type ViewMode = 'day' | 'week' | 'month';

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
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const grid = monthGrid(anchor);
  return { from: grid[0], to: grid[41] };
}

/**
 * Zeitraum, der geladen wird: die Sichtbarkeit plus Puffer, damit Blättern
 * nicht bei jedem Klick einen Netzwerkzugriff auslöst.
 */
export function loadRange(view: ViewMode, anchor: string): { from: string; to: string } {
  const month = anchor.slice(0, 7);
  void view;
  return {
    from: startOfMonth(addMonths(`${month}-01`, -1)),
    to: endOfMonth(addMonths(`${month}-01`, 1)),
  };
}
