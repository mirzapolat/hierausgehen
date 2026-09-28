import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFilmPage, parseFragment, parseProgrammeLinks, toEvent } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

test('findet die Fragment-Links der Programmseite samt cHash', () => {
  const { week, preview } = parseProgrammeLinks(fixture('programm-2026-09.html'));
  assert.match(week!, /dateRange%5D=week&.*dateRangeStart%5D=2026-09-28.*&cHash=622e075a4af09f689c7ac6e98bfd0447$/);
  assert.match(preview!, /dateRange%5D=preview&.*&cHash=9724af028f11a63d3bb76d99303552be$/);
  assert.deepEqual(parseProgrammeLinks('<html></html>'), { week: undefined, preview: undefined });
});

test('liest die Vorstellungen dieser Woche', () => {
  const week = parseFragment(fixture('woche-2026-09-28.html'));
  assert.equal(week.recognised, true);
  assert.equal(week.films.length, 7);
  const screenings = week.films.flatMap((film) => film.screenings);
  assert.equal(screenings.length, 19);
  assert.equal(new Set(screenings.map((s) => s.id)).size, 19);
});

test('die Vorschau nennt Filme, aber keine Uhrzeiten', () => {
  const preview = parseFragment(fixture('vorschau-2026-09.html'));
  assert.equal(preview.films.length, 43);
  assert.ok(preview.films.every((film) => film.screenings.length === 0));
  assert.ok(preview.films.some((film) => film.url === 'https://www.cine-k.de/programm/film/the-rocky-horror-picture-show/'));
});

test('liest alle Vorstellungen einer Filmseite', () => {
  const page = parseFilmPage(fixture('film-everytime.html'))!;
  assert.equal(page.title, 'Everytime');
  assert.match(page.description!, /^Die Sonne geht über Berlin auf/);
  assert.equal(page.screenings.length, 8);

  const event = toEvent({ ...page, url: 'https://www.cine-k.de/programm/film/everytime/' }, page.screenings[0]);
  assert.equal(event.id, 'cine-k:16407');
  assert.equal(event.title, 'Everytime');
  assert.equal(event.start, '2026-09-28T19:30:00+02:00');
  assert.deepEqual(event.venue, { name: 'Muvi' });
  assert.equal(event.availability, 'available');
  assert.equal(event.ticketUrl, 'https://kinotickets.express/oldenburg_cinek/booking/16407');
  assert.equal(event.notes, undefined);
});

test('Sprachfassung und Hinweis der Vorstellung werden Hinweise', () => {
  const page = parseFilmPage(fixture('film-rocky-horror-omu.html'))!;
  const event = toEvent({ ...page, url: 'u' }, page.screenings[0]);
  assert.equal(event.start, '2026-10-26T20:15:00+01:00');
  assert.deepEqual(event.venue, { name: 'Studio' });
  assert.deepEqual(event.notes, ['OmU', '11€ / 5€ ermäßigt']);
});

test('„Ausverkauft“ am Film gilt nur, wenn er genau eine Vorstellung hat', () => {
  const page = parseFilmPage(fixture('film-weinprobe-ausverkauft.html'))!;
  assert.equal(page.message, 'Ausverkauft - nächster Termin am 7. Januar');
  const event = toEvent({ ...page, url: 'u' }, page.screenings[0]);
  assert.equal(event.availability, 'soldout');
  assert.equal(event.availabilityLabel, 'Ausverkauft - nächster Termin am 7. Januar');

  // Mit zwei Vorstellungen ist unklar, welche gemeint ist – dann nur ein Hinweis.
  const zwei = { ...page, screenings: [page.screenings[0], { ...page.screenings[0], id: 'x' }] };
  const unklar = toEvent({ ...zwei, url: 'u' }, zwei.screenings[0]);
  assert.equal(unklar.availability, 'available');
  assert.ok(unklar.notes!.includes('Ausverkauft - nächster Termin am 7. Januar'));
});

test('fremde oder leere Seiten werden erkannt', () => {
  assert.deepEqual(parseFragment('<html></html>'), { recognised: false, films: [] });
  assert.deepEqual(parseFragment('<div class="tx-cinekmanager-program-list"></div>'), { recognised: true, films: [] });
  assert.equal(parseFilmPage('<html></html>'), undefined);
});
