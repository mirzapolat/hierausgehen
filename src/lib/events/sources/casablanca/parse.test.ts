import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseProgramme } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const programm = () => parseProgramme(fixture('startseite-2026-09-28.html'));

test('liest jede Vorstellung der Tabelle genau einmal', () => {
  const { events, skipped, empty } = programm();
  // Das Raster daneben zeigt dieselben 104 Vorstellungen noch einmal.
  assert.equal(events.length, 104);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, 104);
  assert.equal(events.filter((e) => e.start.startsWith('2026-09-28')).length, 14);
});

test('normalisiert eine Vorstellung vollständig', () => {
  const film = programm().events.find((e) => e.id === 'casablanca:95247');
  assert.ok(film);
  assert.equal(film.title, 'Drei Abschiede - Tre ciotole');
  assert.equal(film.start, '2026-09-28T17:45:00+02:00');
  assert.equal(film.allDay, false);
  assert.deepEqual(film.venue, { name: 'Salon' });
  assert.equal(film.availability, 'available');
  assert.equal(film.ticketUrl, 'https://kinotickets.express/casablanca-ol/booking/95247');
  assert.equal(film.url, 'https://www.casablanca-kino.de/filme/drei-abschiede-tre-ciotole-51941/');
  assert.deepEqual(film.notes, ['OmU', 'Cinema! Italia!']);
});

test('eine begonnene Vorstellung ist nicht mehr buchbar, aber nicht ausverkauft', () => {
  const begonnen = programm().events.find((e) => e.id === 'casablanca:95859');
  assert.equal(begonnen!.availability, 'unknown');
  assert.ok(programm().events.every((e) => e.availability !== 'soldout'));
});

test('liest die Säle', () => {
  const saele = new Set(programm().events.map((e) => e.venue.name));
  assert.deepEqual([...saele].sort(), ['Kino 1', 'Kino 2', 'Kinolounge', 'Salon']);
});

test('liest den Programmtext der Filmseite', () => {
  assert.match(parseDetailDescription(fixture('film-bad-apples.html'))!, /^Die Grundschullehrerin Maria/);
  assert.equal(parseDetailDescription('<html></html>'), undefined);
});

test('eine fremde Seite wird nicht als leeres Programm gemeldet', () => {
  assert.deepEqual(parseProgramme(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseProgramme('<html><body>Wartung</body></html>'), { events: [], skipped: 0, empty: false });
});
