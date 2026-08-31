import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCalendarFragment } from './parse.ts';
import { displayAvailability, isPast } from '../../display.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const html = fixture('calendar-2026-07.html');

test('liest alle Termine des Monats', () => {
  const { events, skipped, empty } = parseCalendarFragment(html);
  assert.equal(events.length, 83);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
});

test('normalisiert einen Opernabend vollständig', () => {
  const { events } = parseCalendarFragment(html);
  const macbeth = events.find((e) => e.id === 'staatsoper:15674');
  assert.ok(macbeth, 'Macbeth am 2.7. gefunden');
  assert.equal(macbeth.title, 'Macbeth');
  assert.equal(macbeth.subtitle, 'Giuseppe Verdi');
  assert.equal(macbeth.category, 'Oper');
  assert.equal(macbeth.start, '2026-07-02T19:00:00+02:00');
  assert.equal(macbeth.allDay, false);
  assert.equal(macbeth.venue.name, 'Nationaltheater');
  assert.equal(macbeth.availability, 'limited');
  assert.equal(macbeth.availabilityLabel, 'Letzte Tickets');
  assert.match(macbeth.ticketUrl!, /^https:\/\/tickets\.staatstheater\.bayern\//);
  assert.equal(macbeth.url, 'https://www.staatsoper.de/stuecke/macbeth/2026-07-02-1900-15674');
  assert.equal(macbeth.icsUrl, 'https://www.staatsoper.de/stuecke/macbeth/2026-07-02-1900-15674/calendar.ics');
  assert.deepEqual(macbeth.notes, [
    'Preise M: 193 / 168 / 14 €',
    'Münchner Opernfestspiele, <30',
  ]);
});

test('bildet alle Verfügbarkeitszustände ab', () => {
  const { events } = parseCalendarFragment(html);
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { available: 43, limited: 13, soldout: 11, not_on_sale: 16 });
});

test('vergibt eindeutige IDs und gültige Zeitstempel', () => {
  const { events } = parseCalendarFragment(html);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const e of events) {
    assert.ok(!Number.isNaN(Date.parse(e.start)), `${e.id} hat gültiges Datum`);
    assert.ok(e.title.length > 0);
    assert.ok(e.url.startsWith('https://'));
  }
});

test('erkennt einen ausdrücklich leeren Monat', () => {
  const result = parseCalendarFragment(fixture('calendar-leer.html'));
  assert.deepEqual(result, { events: [], skipped: 0, empty: true });
});

test('trennt Spielstätte von Hinweisen wie "PREMIERE"', () => {
  const { events } = parseCalendarFragment(fixture('calendar-2026-10.html'));
  const premiere = events.find((e) => e.id === 'staatsoper:16123');
  assert.ok(premiere, 'Siegfried am 29.10. gefunden');
  assert.equal(premiere.title, 'Siegfried');
  assert.equal(premiere.venue.name, 'Nationaltheater');
  assert.ok(premiere.notes?.includes('Premiere'), 'Premiere als Hinweis, nicht als Spielstätte');
});

test('glättet geschriene Titel wortweise', () => {
  const { events } = parseCalendarFragment(fixture('calendar-2026-10.html'));
  const gastspiel = events.find((e) => e.id === 'staatsoper:16100');
  assert.ok(gastspiel);
  assert.equal(gastspiel.title, 'Illusionen - Wie Schwanensee (Gastspiel in Baden-Baden)');
  // Gastspiele finden ausserhalb Münchens statt – keine erfundene Stadt.
  assert.equal(gastspiel.venue.name, 'Baden-Baden');
  assert.equal(gastspiel.venue.city, undefined);
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  assert.deepEqual(parseCalendarFragment(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseCalendarFragment('<div class="activity-list__row"></div>'), {
    events: [],
    skipped: 1,
    empty: false,
  });
});

test('vergangene Termine melden keine verfügbaren Karten', () => {
  const { events } = parseCalendarFragment(html);
  const macbeth = events.find((e) => e.id === 'staatsoper:15674')!;

  // Was die Quelle gemeldet hat, bleibt in den Daten erhalten …
  assert.equal(macbeth.availability, 'limited');
  // … die Anzeige rechnet den Zeitpunkt aber mit ein.
  assert.equal(displayAvailability(macbeth, new Date('2026-08-31T10:00:00Z')), 'past');
  assert.equal(displayAvailability(macbeth, new Date('2026-06-01T10:00:00Z')), 'limited');
  assert.equal(isPast(macbeth, new Date('2026-07-02T18:00:00+02:00')), false);
  assert.equal(isPast(macbeth, new Date('2026-07-02T22:00:00+02:00')), true);
});
