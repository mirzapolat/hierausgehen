import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEvents } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Geholt am 8.11.2026: alle kommenden Termine in einer Antwort. */
const upcoming = () => parseEvents(fixture('events-2026-11.json'));

test('liest alle angekündigten Termine', () => {
  const { events, skipped, empty } = upcoming();
  assert.equal(events.length, 3);
  assert.equal(skipped, 0);
  assert.equal(empty, false);

  const perMonth: Record<string, number> = {};
  for (const event of events) perMonth[event.start.slice(0, 7)] = (perMonth[event.start.slice(0, 7)] ?? 0) + 1;
  assert.deepEqual(perMonth, { '2026-11': 1, '2026-12': 1, '2027-01': 1 });
});

test('bildet einen Termin vollständig ab', () => {
  const [first] = upcoming().events;
  assert.deepEqual(first, {
    id: 'printhouse:6ad272b1a851f16fdbde3d0f',
    sourceId: 'printhouse',
    title: 'Edition 0003',
    subtitle: undefined,
    description: [
      'Printhouse: Techno',
      'RECONDITE (live)',
      '.VRIL (live)',
      'KINZUA',
      'IZZYA',
      'EUPHRAT',
      'Paper Warehouse: House',
      'NATHALIE SERES',
      'SEVENSOL',
      'QNETE',
    ].join('\n'),
    category: 'Techno',
    start: '2026-11-14T20:00:00+01:00',
    end: '2026-11-15T05:00:00+01:00',
    allDay: false,
    venue: { name: 'Printhouse' },
    availability: 'available',
    availabilityLabel: undefined,
    ticketUrl: 'https://samt-sonders-gastronomie-gmbh-muhd.vivenushop.com/event/6ad272b1a851f16fdbde3d0f',
    url: 'https://samt-sonders-gastronomie-gmbh-muhd.vivenushop.com/event/6ad272b1a851f16fdbde3d0f',
    notes: ['Final Release: 25 €', 'From: 15 €'],
  });
});

test('Ticketlage und eindeutige IDs', () => {
  const { events } = upcoming();
  assert.deepEqual(events.map((e) => e.availability), ['available', 'available', 'available']);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
});

test('erkennt ausverkauft und Vorverkauf demnächst', () => {
  const json = JSON.stringify({
    events: [
      { id: 'a', title: 'A', start: '2026-07-04T20:00:00.000Z', sale: { status: 'soldOut' } },
      { id: 'b', title: 'B', start: '2026-07-05T20:00:00.000Z', sale: { status: 'soon', start: '2026-06-01T08:00:00.000Z' } },
      { id: 'c', title: 'C', start: '2026-07-06T20:00:00.000Z' },
    ],
  });
  const { events } = parseEvents(json);
  assert.deepEqual(
    events.map((e) => [e.availability, e.availabilityLabel, e.start]),
    [
      ['soldout', 'Sold out', '2026-07-04T22:00:00+02:00'],
      ['not_on_sale', 'On sale 01.06.2026', '2026-07-05T22:00:00+02:00'],
      ['unknown', undefined, '2026-07-06T22:00:00+02:00'],
    ],
  );
});

test('leere Liste ist leer, kaputte Antwort nicht erkannt', () => {
  assert.deepEqual(parseEvents('{"events":[]}'), { events: [], skipped: 0, empty: true });
  assert.deepEqual(parseEvents(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseEvents('<!doctype html><html></html>'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseEvents('{"items":[]}'), { events: [], skipped: 0, empty: false });
});

test('überspringt Einträge ohne ID, Titel oder Beginn', () => {
  const { events, skipped } = parseEvents(JSON.stringify({ events: [{ id: 'x', title: '' }, { title: 'Y', start: '2026-07-01T20:00:00Z' }] }));
  assert.equal(events.length, 0);
  assert.equal(skipped, 2);
});
