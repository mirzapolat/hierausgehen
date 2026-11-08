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
  assert.equal(events.length, 14);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
});

test('vergibt eindeutige IDs aus dem Shop-Kürzel', () => {
  const { events } = table();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) assert.match(event.id, /^rotesonne:[A-Za-z0-9]+$/);
});

test('normalisiert einen Termin vollständig', () => {
  const event = table().events.find((e) => e.id === 'rotesonne:kTZMW4vZ');
  assert.deepEqual(event, {
    id: 'rotesonne:kTZMW4vZ',
    sourceId: 'rotesonne',
    title: 'Little Barrie',
    description: undefined,
    start: '2026-11-15T19:30:00+01:00',
    end: '2026-11-15T22:30:00+01:00',
    allDay: false,
    venue: { name: 'Rote Sonne' },
    availability: 'available',
    ticketUrl: 'https://rotesonne.ticket.io/kTZMW4vZ/',
    url: 'https://rotesonne.ticket.io/kTZMW4vZ/',
    notes: ['Tickets ab: 31,00 Euro'],
  });
});

test('Ticketlage: alle Termine im Vorverkauf', () => {
  const counts: Record<string, number> = {};
  for (const e of table().events) counts[e.availability] = (counts[e.availability] ?? 0) + 1;
  assert.deepEqual(counts, { available: 14 });
});

test('Beschreibung: gekürzter Teaser endet am Wort, „N/A“ fällt weg', () => {
  const { events } = table();
  const ulla = events.find((e) => e.id === 'rotesonne:E2MWM6Hw');
  assert.equal(ulla?.description, undefined);
  assert.equal(ulla?.title, 'Ulla Suspekt & Band "Antrag abgelehnt" Tour');
  const garry = events.find((e) => e.id === 'rotesonne:HFANgKfh');
  assert.match(garry!.description!, /^garry klein Barbetrieb mit kostenlosem Eintritt ab 22:00!/);
  assert.match(garry!.description!, /\S …$/);
});

test('Einlass-Hinweis des Clubs ist keine Beschreibung', () => {
  const { events } = table();
  const withText = events.filter((e) => e.description);
  assert.equal(withText.length, 4);
  for (const e of withText) assert.doesNotMatch(e.description!, /^Bitte beachtet/);
});

test('24-Stunden-Termin behält sein Ende', () => {
  const ritual = table().events.find((e) => e.id === 'rotesonne:bGjceAwK');
  assert.equal(ritual?.start, '2026-11-28T23:00:00+01:00');
  assert.equal(ritual?.end, '2026-11-29T23:00:00+01:00');
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
