/**
 * Entwicklungshilfe: befüllt den Event-Cache aus den abgelegten Fixtures.
 *
 * Sinnvoll, wenn eine Quelle gerade nicht erreichbar ist (die Seite der
 * Staatsoper war beim Aufsetzen des Projekts über Stunden nicht abrufbar) und
 * man die Oberfläche trotzdem mit echten Daten sehen will.
 *
 *   npm run seed
 *
 * Die Daten stammen 1:1 aus der gespeicherten Antwort der Quelle; es wird
 * nichts erfunden und nichts umdatiert.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCalendarFragment } from '../src/lib/events/sources/staatsoper/parse.ts';
import { writeCache } from '../src/lib/events/cache.ts';
import { endOfMonth, startOfMonth, addMonths } from '../src/lib/calendar.ts';

const fixture = path.join(
  import.meta.dirname,
  '../src/lib/events/sources/staatsoper/__fixtures__/calendar-2026-10.html',
);

const { events } = parseCalendarFragment(readFileSync(fixture, 'utf8'));
if (events.length === 0) {
  console.error('Fixture enthält keine Termine – Parser prüfen.');
  process.exit(1);
}

const month = events[0].start.slice(0, 7);
const first = `${month}-01`;

// Die Oberfläche lädt immer Vormonat–Folgemonat; beide Zuschnitte ablegen.
const ranges = [
  { from: first, to: endOfMonth(first) },
  { from: startOfMonth(addMonths(first, -1)), to: endOfMonth(addMonths(first, 1)) },
];

for (const range of ranges) {
  const key = `staatsoper_${range.from}_${range.to}`;
  await writeCache(key, events, 60 * 60 * 24 * 30);
  console.log(`✓ ${key} — ${events.length} Termine`);
}

console.log(`\nIm Kalender zu ${month} blättern, um die Daten zu sehen.`);
