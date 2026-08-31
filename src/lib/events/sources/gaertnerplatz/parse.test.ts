import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseScheduleFragment, parseSparten } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const sparten = parseSparten(fixture('index.html'));
const october = () => parseScheduleFragment(fixture('spielplan-2026-10.html'), sparten);
const november = () => parseScheduleFragment(fixture('spielplan-2026-11.html'), sparten);

test('liest die Gattungen aus den Filtern der Spielplanseite', () => {
  assert.equal(sparten['sparte-14'], 'Oper');
  assert.equal(sparten['sparte-3'], 'Musical');
  assert.equal(sparten['sparte-4'], 'Ballett');
  assert.equal(sparten['sparte-0'], undefined, '"Alle Sparten" ist keine Gattung');
});

test('liest alle Termine eines Monats', () => {
  const { events, skipped, end, blocks } = october();
  assert.equal(events.length, 28);
  assert.equal(skipped, 0);
  assert.equal(end, false);
  // Ein Block mehr als Termine: der Hinweiskasten "Theaterferien".
  assert.equal(blocks, 29);
  for (const event of events) assert.ok(event.start.startsWith('2026-10'), event.start);
});

test('überspringt den Hinweiskasten ohne Termin-ID', () => {
  const { events } = october();
  assert.ok(
    !events.some((e) => e.title.includes('Theaterferien')),
    'der Ferienhinweis ist kein Termin',
  );
});

test('normalisiert einen Opernabend vollständig', () => {
  const traviata = october().events.find((e) => e.id === 'gaertnerplatz:5397');
  assert.ok(traviata, 'La traviata am 2.10. gefunden');
  assert.equal(traviata.title, 'La traviata');
  assert.equal(traviata.category, 'Oper');
  assert.equal(traviata.start, '2026-10-02T19:30:00+02:00');
  assert.equal(traviata.end, '2026-10-02T22:00:00+02:00');
  assert.equal(traviata.allDay, false);
  assert.equal(traviata.venue.name, 'Staatstheater am Gärtnerplatz');
  assert.equal(traviata.venue.city, undefined);
  assert.equal(traviata.availability, 'available');
  assert.equal(traviata.availabilityLabel, 'Tickets');
  assert.match(traviata.ticketUrl!, /^https:\/\/tickets\.staatstheater\.bayern\/gpt\.webshop\//);
  assert.equal(
    traviata.url,
    'https://www.gaertnerplatztheater.de/de/spielplan/produktionen/la-traviata.html?ID_Vorstellung=5397&m=489',
  );
  assert.deepEqual(traviata.notes, ['U30']);
});

test('erkennt Ausverkauftes am Text ohne Kartenlink', () => {
  const soldout = october().events.find((e) => e.id === 'gaertnerplatz:5310');
  assert.ok(soldout);
  assert.equal(soldout.availability, 'soldout');
  assert.equal(soldout.availabilityLabel, 'Ausverkauft');
  assert.equal(soldout.ticketUrl, undefined, 'kein Kartenlink bei ausverkauft');
});

test('bildet alle Verfügbarkeitszustände ab', () => {
  const counts = october().events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { available: 17, limited: 5, not_on_sale: 4, soldout: 1, unknown: 1 });
});

test('liest verlinkte und unverlinkte Spielstätten', () => {
  // "Foyer" hängt an einem Saalplan-Link, "Kempten" ist blosser Text.
  const foyer = october().events.find((e) => e.venue.name === 'Foyer');
  assert.ok(foyer, 'Foyer als Spielstätte erkannt');

  const gastspiel = november().events.find((e) => e.id === 'gaertnerplatz:5179');
  assert.ok(gastspiel, 'Gastspiel am 4.11. gefunden');
  assert.equal(gastspiel.venue.name, 'Kempten');
  assert.equal(gastspiel.venue.city, undefined, 'keine Stadt erfinden');

  assert.deepEqual(
    [...new Set(october().events.map((e) => e.venue.name))].sort(),
    ['Foyer', 'Probebühne', 'Staatstheater am Gärtnerplatz', 'Studiobühne'],
  );
});

test('vergibt eindeutige IDs und gültige Zeitstempel', () => {
  const { events } = october();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gültiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.url.startsWith('https://'));
  }
});

test('erkennt einen leeren Monat und das Ende des Spielplans', () => {
  assert.deepEqual(parseScheduleFragment(fixture('spielplan-leer-2026-08.html'), sparten), {
    events: [],
    skipped: 0,
    end: false,
    empty: true,
    blocks: 0,
  });
  assert.deepEqual(parseScheduleFragment(fixture('spielplan-ende.html'), sparten), {
    events: [],
    skipped: 0,
    end: true,
    empty: true,
    blocks: 0,
  });
});

test('meldet Inhalt ohne Terminblock als Layoutfehler', () => {
  // Weder leer noch Ende, aber kein Block: das muss `index.ts` auffallen.
  const result = parseScheduleFragment('<div class="row"><p>Etwas anderes</p></div>', sparten);
  assert.deepEqual(result, { events: [], skipped: 0, end: false, empty: false, blocks: 0 });
});
