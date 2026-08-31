import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseSchedulePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const schedule = () => parseSchedulePage(fixture('spielplan-2026-09-2027-03.html'), '2026-09');

test('liest alle Termine des veroeffentlichten Spielplans', () => {
  const { events, skipped, empty } = schedule();
  assert.equal(events.length, 71);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
});

test('normalisiert eine Premiere vollstaendig', () => {
  const { events } = schedule();
  const geierwally = events.find((event) => event.id === 'volkstheater:449834');

  assert.ok(geierwally, 'DIE GEIERWALLY am 24.9. gefunden');
  assert.equal(geierwally.title, 'Die Geierwally');
  assert.match(geierwally.subtitle!, /^nach dem Roman von Wilhelmine von Hillern/);
  assert.equal(geierwally.category, 'Schauspiel');
  assert.equal(geierwally.start, '2026-09-24T19:30:00+02:00');
  assert.equal(geierwally.allDay, false);
  assert.equal(geierwally.venue.name, 'Bühne 1');
  assert.equal(geierwally.availability, 'available');
  assert.equal(geierwally.availabilityLabel, 'Karten');
  assert.equal(geierwally.ticketUrl, 'https://tickets.muenchenticket.net/shop/215/link/event/449834');
  assert.equal(geierwally.url, 'https://www.muenchner-volkstheater.de/programm/schauspiel/die-geierwally');
  assert.deepEqual(geierwally.notes, ['Premiere']);
});

test('bildet alle Verfuegbarkeitszustaende der Quelle ab', () => {
  const { events } = schedule();
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.availability] = (acc[event.availability] ?? 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, { available: 63, soldout: 6, limited: 2 });
  assert.equal(events.find((event) => event.id === 'volkstheater:449878')?.availability, 'soldout');
});

test('liest Kategorien aus Titelzusatz oder Eventklasse', () => {
  const { events } = schedule();
  assert.equal(events.find((event) => event.id === 'volkstheater:447091')?.category, 'Konzert');
  assert.equal(events.find((event) => event.id === 'volkstheater:444293')?.category, 'Musikalische Lesung');
  assert.equal(events.find((event) => event.id === 'volkstheater:449993')?.category, 'Schauspiel');
});

test('uebernimmt Hinweise getrennt von Beschreibung und Spielstaette', () => {
  const { events } = schedule();
  const echtzeitalter = events.find((event) => event.id === 'volkstheater:450004');
  assert.ok(echtzeitalter);
  assert.equal(echtzeitalter.venue.name, 'Bühne 1');
  assert.ok(echtzeitalter.notes?.includes('Deutsche Erstaufführung in einer Fassung von Jan Friedrich'));
  assert.ok(echtzeitalter.notes?.includes('19:00 Uhr Einführung | Bühne 3'));
});

test('rollt Jahre ueber den Spielzeitwechsel weiter', () => {
  const { events } = schedule();
  assert.equal(events.find((event) => event.id === 'volkstheater:447375')?.start, '2027-01-17T20:00:00+01:00');
  assert.equal(events.find((event) => event.id === 'volkstheater:449227')?.start, '2027-03-07T20:00:00+01:00');
});

test('vergibt eindeutige IDs und gueltige Pflichtfelder', () => {
  const { events } = schedule();
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);

  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gueltiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.category);
    assert.ok(event.venue.name);
    assert.ok(event.url.startsWith('https://'));
  }
});

test('liest langen Programmtext aus der Stueckseite', () => {
  const description = parseDetailDescription(fixture('detail-die-geierwally.html'));

  assert.match(description!, /^Walburga Stromminger ist schon früh/);
  assert.match(description!, /radikaler Selbstbestimmung/);
  assert.ok(!description!.includes('Kommende Vorstellungen'));
});

test('erkennt einen leeren gerenderten Spielplan', () => {
  const html = '<div class="schedule view-display-id-schedule"><div class="view-content view-rows"></div></div>';
  assert.deepEqual(parseSchedulePage(html, '2026-09'), { events: [], skipped: 0, empty: true });
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  assert.deepEqual(parseSchedulePage('', '2026-09'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseSchedulePage('<div class="schedule view-display-id-schedule"><div class="schedule--month-wrapper"></div></div>', '2026-09'), {
    events: [],
    skipped: 0,
    empty: true,
  });
});
