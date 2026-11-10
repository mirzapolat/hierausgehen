import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEventTable } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const table = () => parseEventTable(fixture('tabelle-2026-11.html'));

test('liest alle Termine der Tabellenansicht', () => {
  const { events, skipped, empty } = table();
  assert.equal(events.length, 9);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
});

test('vergibt eindeutige IDs aus dem Shop-Kürzel', () => {
  const { events } = table();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) assert.match(event.id, /^lieberscholli:[A-Za-z0-9]+$/);
});

test('normalisiert einen Termin vollständig', () => {
  const event = table().events.find((e) => e.id === 'lieberscholli:tEKnoVvz');
  assert.deepEqual(event, {
    id: 'lieberscholli:tEKnoVvz',
    sourceId: 'lieberscholli',
    title: 'Dark Pulse',
    description:
      'Dark Pulse geht in die nächste Runde. Am 13.11.26 geben wir wieder im Lieberscholli gas. Für euch und mit euch! Zwei Floors, zwei unterschiedliche Sounds, eine gemeinsame Nacht.🔊 UPSTAIRS: Bounce • Hardtechno🔊 DOWNSTAIRS: Groove • Techno • Hypnotic …',
    start: '2026-11-13T22:00:00+01:00',
    end: '2026-11-14T05:00:00+01:00',
    allDay: false,
    venue: { name: 'Lieber Scholli' },
    availability: 'available',
    ticketUrl: 'https://lieberscholli.ticket.io/tEKnoVvz/',
    url: 'https://lieberscholli.ticket.io/tEKnoVvz/',
    notes: ['Tickets ab: 12,00 Euro'],
  });
});

test('Ticketlage: Vorverkauf und ein Termin ohne Online-Verkauf', () => {
  const counts: Record<string, number> = {};
  for (const e of table().events) counts[e.availability] = (counts[e.availability] ?? 0) + 1;
  assert.deepEqual(counts, { available: 8, not_on_sale: 1 });
  const offline = table().events.find((e) => e.id === 'lieberscholli:5jH05CcJ');
  assert.equal(offline?.availabilityLabel, 'Online-Vorverkauf nicht möglich');
  assert.equal(offline?.notes, undefined);
});

test('mehrtägiger Termin behält sein Ende', () => {
  const escon = table().events.find((e) => e.id === 'lieberscholli:KuQEihDq');
  assert.equal(escon?.start, '2026-12-11T14:00:00+01:00');
  assert.equal(escon?.end, '2026-12-13T05:00:00+01:00');
});

test('leere Tabelle ist ein gültiger leerer Stand', () => {
  const html = fixture('tabelle-2026-11.html').replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>');
  assert.deepEqual(parseEventTable(html), { events: [], skipped: 0, empty: true });
});

test('Sicherheitsprüfung statt Tabelle: nichts erkannt', () => {
  assert.deepEqual(parseEventTable(fixture('sicherheitspruefung-layoutbruch.html')), {
    events: [],
    skipped: 0,
    empty: false,
  });
  assert.deepEqual(parseEventTable(''), { events: [], skipped: 0, empty: false });
});
