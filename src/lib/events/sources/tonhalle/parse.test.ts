import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evisIdOf, parseEventPage, parseEvents, parseMetadata } from './parse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');
const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
const metadata = () => parseMetadata(fixture('metadata-2026-11.json'));
const termine = () => parseEvents(fixture('events-2026-11.json'), metadata());

test('legt jede Vorstellung als eigenen Termin an', () => {
  const { events, skipped, empty } = termine();
  assert.equal(events.length, 264);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, 264);
});

test('normalisiert einen Termin und rechnet UTC in Ortszeit', () => {
  const [first, second] = termine().events.filter((e) => e.title === 'Enigma');
  assert.deepEqual(first, {
    id: 'tonhalle:000000e9-0011784a',
    sourceId: 'tonhalle',
    title: 'Enigma',
    subtitle: undefined,
    start: '2026-11-06T20:00:00+01:00',
    allDay: false,
    venue: { name: 'Tonhalle Düsseldorf' },
    availability: 'available',
    availabilityLabel: undefined,
    ticketUrl: 'https://webshop.tonhalle.de/api/1/redirect/product/performance?id=10229671017586&lang=de',
    url: 'https://www.tonhalle.de/veranstaltung/sternzeichen/20791-enigma',
  });
  assert.equal(second.start, '2026-11-08T11:00:00+01:00');
  assert.equal(second.ticketUrl, undefined);
  assert.equal(evisIdOf(first), '000000e9:0011784a');
});

test('verteilt die Ticketlage aus den Metadaten', () => {
  assert.deepEqual(count(termine().events.map((e) => e.availability)), {
    available: 213,
    soldout: 3,
    unknown: 46,
    limited: 2,
  });
  assert.equal(parseEvents(fixture('events-2026-11.json')).events.filter((e) => e.availability === 'soldout').length, 0);
});

test('eine leere Antwort ist leer, kaputtes JSON nicht', () => {
  assert.deepEqual(parseEvents(fixture('events-leer-2026-11.json')), { events: [], skipped: 0, empty: true });
  assert.deepEqual(parseEvents('<html>'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseMetadata('kaputt'), []);
});

test('liest Saal, Reihe, Veranstalter und Text der Veranstaltungsseite', () => {
  const detail = parseEventPage(fixture('veranstaltung-enigma-2026-11.html'))!;
  assert.equal(detail.venue, 'Mendelssohn-Saal');
  assert.equal(detail.category, undefined);
  assert.deepEqual(detail.notes, ['Reihe: Sternzeichen', 'Star-Talk: 19:00', 'Veranstalter: Tonhalle Düsseldorf gGmbH']);
  assert.match(detail.description!, /^Elgars „Enigma Variations“/);
  assert.equal(detail.urls['000000e9:0011784e'], 'https://www.tonhalle.de/veranstaltung/sternzeichen/20792-enigma');
  assert.equal(parseEventPage('<html></html>'), undefined);
});
