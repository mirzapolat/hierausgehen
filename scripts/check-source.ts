/**
 * Live-Prüfung einer Quelle – ohne Dev-Server, ohne Cache-Ritual.
 *
 *   npm run check -- theaterakademie
 *   npm run check                       # alle registrierten Quellen
 *   npm run check -- theaterakademie 2026-09 2027-01
 *
 * Ruft den Adapter direkt auf, über mehrere Monate, und prüft dasselbe, was
 * die API später ausliefert: Pflichtfelder nach der Normalisierung, eindeutige
 * IDs, keine Dopplungen, keine Termine ausserhalb des angefragten Zeitraums.
 *
 * Der Platten-Cache ist dabei abgeschaltet (`EVENT_CACHE_DISK=0`): jeder Lauf
 * fragt die Quelle wirklich. Das ist der Punkt – ein Adapter, der nur aus dem
 * Cache antwortet, ist nicht geprüft. Der Cache des laufenden Dev-Servers
 * bleibt unberührt.
 */

import type { CalendarEvent, EventSource } from '../src/lib/events/types.ts';

// Vor dem ersten Import der Cache-Schicht setzen – sie liest den Wert einmal.
process.env.EVENT_CACHE_DISK = '0';

const { sources, sourceById } = await import('../src/lib/events/registry.ts');
const { normalizeSourceEvents } = await import('../src/lib/events/normalize.ts');
const { monthsInRange } = await import('../src/lib/events/time.ts');

const args = process.argv.slice(2);
const months = args.filter((arg) => /^\d{4}-\d{2}$/.test(arg));
const ids = args.filter((arg) => !/^\d{4}-\d{2}$/.test(arg));

const unknown = ids.filter((id) => !sourceById.has(id));
if (unknown.length > 0) {
  console.error(`Unbekannte Quelle(n): ${unknown.join(', ')}`);
  console.error(`Bekannt: ${sources.map((s) => s.definition.id).join(', ')}`);
  process.exit(1);
}

const selected = ids.length > 0 ? ids.map((id) => sourceById.get(id)!) : sources;
const ranges = (months.length > 0 ? months : defaultMonths()).map(monthRange);

let problems = 0;
for (const source of selected) {
  console.log(`\n${'='.repeat(72)}\n${source.definition.id}  (${source.definition.name})`);
  console.log('='.repeat(72));
  for (const range of ranges) problems += await checkRange(source, range);
}

console.log(
  problems === 0
    ? '\nAlles in Ordnung.'
    : `\n${problems} Befund(e) – oben nachsehen, das sind keine Kleinigkeiten.`,
);
process.exit(problems === 0 ? 0 : 1);

/* ------------------------------------------------------------------ */

interface MonthRange {
  from: string;
  to: string;
}

/**
 * Vergangenheit, laufender Monat, die nächsten Monate und die Spielzeitpause:
 * genau die vier Fälle, in denen Adapter erfahrungsgemäss auseinanderfallen.
 */
function defaultMonths(): string[] {
  const now = new Date();
  const [year, month] = [now.getFullYear(), now.getMonth() + 1];
  const shift = (offset: number) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const pause = `${month >= 9 ? year + 1 : year}-08`;
  return [...new Set([shift(-1), shift(0), shift(1), shift(3), pause])].sort();
}

function monthRange(month: string): MonthRange {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${last}` };
}

async function checkRange(source: EventSource, range: MonthRange): Promise<number> {
  const label = range.from.slice(0, 7);
  const started = Date.now();

  let raw: CalendarEvent[];
  try {
    raw = await source.fetchEvents(range, undefined, {
      requestTimeoutMs: 15_000,
      descriptionBudgetMs: 15_000,
    });
  } catch (error) {
    console.log(`\n  ${label}  ✖ ${(error as Error).message}`);
    return 1;
  }

  const events = normalizeSourceEvents(raw, source.definition);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n  ${label}  ${String(events.length).padStart(4)} Termine  ${seconds}s` +
      `  ${share(events, (event) => event.availability)}`,
  );
  if (events.length === 0) {
    console.log('        (leer – bei Vergangenheit und Spielzeitpause richtig so)');
    return 0;
  }

  console.log(`        Arten:  ${share(events, (event) => event.category ?? '—')}`);
  console.log(`        Orte:   ${share(events, (event) => event.venue.name)}`);
  console.log(
    `        Text:   ${count(events, (event) => !!event.description)} mit Beschreibung, ` +
      `${count(events, (event) => !!event.ticketUrl)} mit Ticketlink, ` +
      `${count(events, (event) => event.allDay)} ohne Uhrzeit`,
  );
  console.log(`        Beispiel: ${describe(events[0])}`);

  return findings(events, range, monthsInRange(range.from, range.to)).reduce((sum, line) => {
    console.log(`        ✖ ${line}`);
    return sum + 1;
  }, 0);
}

/** Was die API garantieren muss – hier fällt es auf, nicht erst im Kalender. */
function findings(events: CalendarEvent[], range: MonthRange, months: string[]): string[] {
  const lines: string[] = [];
  const list = (values: string[]) => `${values.slice(0, 3).join(', ')}${values.length > 3 ? ' …' : ''}`;

  const incomplete = events
    .filter(
      (event) =>
        !event.title ||
        !event.category ||
        !event.venue.name ||
        !event.url ||
        Number.isNaN(Date.parse(event.start)),
    )
    .map((event) => event.id);
  if (incomplete.length) lines.push(`${incomplete.length}× Pflichtfeld fehlt: ${list(incomplete)}`);

  const ids = events.map((event) => event.id);
  const doubledIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (doubledIds.length) lines.push(`${doubledIds.length}× ID doppelt: ${list(doubledIds)}`);

  const keys = new Map<string, number>();
  for (const event of events) {
    const key = `${event.start}|${event.title.toLowerCase()}|${event.venue.name.toLowerCase()}`;
    keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  const doubled = [...keys].filter(([, n]) => n > 1).map(([key]) => key);
  if (doubled.length) lines.push(`${doubled.length}× gleicher Termin doppelt: ${list(doubled)}`);

  const outside = events
    .filter((event) => event.start.slice(0, 10) < range.from || event.start.slice(0, 10) > range.to)
    .map((event) => `${event.id} (${event.start.slice(0, 10)})`);
  if (outside.length) {
    lines.push(`${outside.length}× ausserhalb ${months.join('/')}: ${list(outside)}`);
  }

  return lines;
}

function share(events: CalendarEvent[], of: (event: CalendarEvent) => string): string {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(of(event), (counts.get(of(event)) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, n]) => `${key} ${n}`)
    .join(', ');
}

function count(events: CalendarEvent[], is: (event: CalendarEvent) => boolean): number {
  return events.filter(is).length;
}

function describe(event: CalendarEvent): string {
  return [
    event.start,
    event.venue.name,
    event.title,
    event.availability,
    event.url,
  ].join(' | ');
}
