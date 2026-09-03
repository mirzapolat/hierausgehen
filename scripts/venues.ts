/**
 * Orte prüfen – welcher Ortsname der Quellen wird zu welchem Punkt?
 *
 *   npm run venues                     # alle Quellen, laufender Monat
 *   npm run venues -- staatsoper       # nur eine Quelle
 *   npm run venues -- staatsoper 2026-11
 *
 * Ruft die Adapter live auf und löst ihre Ortsnamen über
 * `src/lib/events/geocode.ts` auf – dieselbe Auflösung, die auch die tägliche
 * Erhebung benutzt, mitsamt ihrem Zwischenspeicher. Der ist hier ausdrücklich
 * eingeschaltet: ein Name wird einmal bei Nominatim erfragt, danach nie wieder.
 *
 * Gelesen wird die Ausgabe in drei Spalten: Name der Quelle, gefundener Ort,
 * Herkunft. `Haus` heisst, dass nicht der Raumname gefunden wurde, sondern das
 * Haus der Quelle – für "Silbersaal" oder "Bühne 1" ist das richtig so. Mit
 * `*` markiert sind Namen ohne Ort; die stehen in der Kartenansicht unter
 * "ohne Ort". Das ist kein Fehler, sondern die ehrliche Antwort – aber die
 * Stelle zum Hinschauen, wenn ein Haus auf der Karte fehlt.
 *
 * Gehört zum Hinzufügen einer Quelle, nach `npm run categories`.
 */

import type { CalendarEvent, EventSource } from '../src/lib/events/types.ts';

const { sources, sourceById } = await import('../src/lib/events/registry.ts');
const { normalizeSourceEvents } = await import('../src/lib/events/normalize.ts');
const { locateEvents } = await import('../src/lib/events/geocode.ts');

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
const range = monthRange(months[0] ?? currentMonth());

const collected: CalendarEvent[] = [];
for (const source of selected) {
  const events = await load(source, range);
  console.log(`${source.definition.id.padEnd(20)} ${String(events.length).padStart(5)} Termine`);
  collected.push(...events);
}

console.log('\nOrte auflösen (höchstens eine Abfrage je Sekunde) …\n');
const located = await locateEvents(
  collected,
  selected.map((source) => source.definition),
  { cityId: selected[0]?.definition.cityId ?? 'muenchen', budgetMs: 10 * 60_000, maxLookups: 500 },
);

/** Quelle -> Ortsname -> { Anzahl, gefundener Ort }. */
const table = new Map<string, Map<string, { count: number; event: CalendarEvent }>>();
for (const event of located) {
  const perSource = table.get(event.sourceId) ?? new Map();
  const entry = perSource.get(event.venue.name);
  if (entry) entry.count++;
  else perSource.set(event.venue.name, { count: 1, event });
  table.set(event.sourceId, perSource);
}

let placed = 0;
let missing = 0;

console.log('='.repeat(96));
for (const [sourceId, venues] of table) {
  console.log(`\n${sourceId}`);
  for (const [name, { count, event }] of [...venues].sort((a, b) => b[1].count - a[1].count)) {
    const place = event.venue.place;
    if (place) placed += count;
    else missing += count;
    const marker = place ? ' ' : '*';
    const target = place
      ? `${place.name}  (${place.point.latitude.toFixed(5)}, ${place.point.longitude.toFixed(5)})`
      : '— ohne Ort';
    console.log(
      `  ${marker} ${String(count).padStart(4)}  ${name.slice(0, 38).padEnd(38)} ${target.padEnd(46)}` +
        `${place ? (place.from === 'house' ? 'Haus' : 'Ort') : ''}`,
    );
  }
}

console.log(`\n${'='.repeat(96)}`);
console.log(`${placed} Termine mit Ort, ${missing} ohne (*).`);

/* ------------------------------------------------------------------ */

async function load(source: EventSource, target: { from: string; to: string }) {
  try {
    const raw = await source.fetchEvents(target, undefined, {
      requestTimeoutMs: 15_000,
      descriptionBudgetMs: 15_000,
    });
    return normalizeSourceEvents(raw, source.definition);
  } catch (error) {
    console.log(`${source.definition.id.padEnd(20)}   ✖ ${(error as Error).message}`);
    return [];
  }
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${last}` };
}
