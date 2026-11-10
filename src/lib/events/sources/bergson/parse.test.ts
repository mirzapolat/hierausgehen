import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Die Fixture wurde am 8.11.2026 geholt. */
const programme = () => parseProgrammePage(fixture('programm-2026-11.html'));

test('liest das ganze angekündigte Programm aus einer Antwort', () => {
  const { events, skipped, empty } = programme();
  assert.equal(events.length, 245);
  assert.equal(skipped, 0);
  assert.equal(empty, false);

  const perMonth: Record<string, number> = {};
  for (const event of events) {
    const month = event.start.slice(0, 7);
    perMonth[month] = (perMonth[month] ?? 0) + 1;
  }
  assert.deepEqual(perMonth, {
    '2026-11': 43, '2026-12': 59, '2027-01': 39, '2027-02': 21, '2027-03': 25,
    '2027-04': 18, '2027-05': 14, '2027-06': 15, '2027-07': 8, '2027-10': 1,
    '2027-11': 1, '2028-01': 1,
  });
});

test('vergibt eindeutige IDs', () => {
  const { events } = programme();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
});

test('normalisiert einen Termin vollständig', () => {
  const event = programme().events.find((e) => e.id === 'bergson:noten-neuronen-08-november-2026-1');
  assert.deepEqual(event, {
    id: 'bergson:noten-neuronen-08-november-2026-1',
    sourceId: 'bergson',
    title: 'Noten & Neuronen I',
    subtitle: 'Musik für die Gehirngesundheit mit Mitgliedern des BRSO',
    category: 'Klassik',
    start: '2026-11-08T11:00:00+01:00',
    end: '2026-11-08T14:45:00+01:00',
    allDay: false,
    venue: { name: 'Elektra Tonquartier' },
    availability: 'limited',
    availabilityLabel: 'Nur noch wenige Tickets verfügbar',
    ticketUrl: 'https://tickets.bergson.com/de/buyingflow/tickets/17654/44836/',
    url: 'https://bergson.com/event/noten-neuronen-08-november-2026-1',
  });
});

test('mehrere Schlagworte bleiben im Wortlaut, ohne Schlagwort keine Art', () => {
  const { events } = programme();
  const categories = new Set(events.map((e) => e.category));
  assert.ok(categories.has('Klassik, Kind & Familie'));
  assert.ok(categories.has('Partys & Festivals'));
  const brunch = events.find((e) => e.id === 'bergson:brunch-im-bergson-08-november-2026');
  assert.equal(brunch?.category, undefined);
  assert.equal(brunch?.availability, 'unknown');
  assert.equal(brunch?.venue.name, 'Bergson Kunstkraftwerk');
});

test('verteilt die Ticketlagen', () => {
  const counts: Record<string, number> = {};
  for (const event of programme().events) {
    counts[event.availability] = (counts[event.availability] ?? 0) + 1;
  }
  assert.deepEqual(counts, { available: 207, limited: 15, soldout: 7, unknown: 16 });
});

test('ausverkauft auch ohne Ticketknopf', () => {
  const event = programme().events.find((e) => e.id === 'bergson:alessandro-capasso-03-dezember-2026');
  assert.equal(event?.availability, 'soldout');
  assert.equal(event?.ticketUrl, undefined);
});

test('leere Liste ist leer, fremdes HTML ist nichts', () => {
  const emptyList = parseProgrammePage(
    '<html><body><div class="theme-block block-program-list" data-controller="filter-events"></div></body></html>',
  );
  assert.deepEqual(emptyList, { events: [], skipped: 0, empty: true });

  assert.deepEqual(parseProgrammePage(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseProgrammePage('<html><body><p>Wartung</p></body></html>'), {
    events: [],
    skipped: 0,
    empty: false,
  });
});

test('liest den langen Programmtext der Detailseite', () => {
  const text = parseDetailDescription(fixture('detail-noten-neuronen-2026-11.html'));
  assert.ok(text);
  assert.ok(text.startsWith('Was passiert im Gehirn, wenn Musik uns berührt?'));
  assert.ok(text.includes('\n\n»Noten & Neuronen – Musik für die Gehirngesundheit«'));
  assert.ok(text.endsWith('Familien, Kinder und Jugendliche sind besonders herzlich willkommen.'));
  assert.equal(parseDetailDescription('<html></html>'), undefined);
});
