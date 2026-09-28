import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailPage, parseListPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

test('liest eine volle Seite und erkennt die nächste', () => {
  const { events, skipped, empty, hasNext } = parseListPage(fixture('spielplan-seite1-2026-09.html'));
  assert.equal(events.length, 10);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(hasNext, true);
});

test('die letzte Seite hat kein „weiter“, dahinter ist die Liste leer', () => {
  const letzte = parseListPage(fixture('spielplan-seite6-2026-09.html'));
  assert.equal(letzte.events.length, 8);
  assert.equal(letzte.hasNext, false);

  assert.deepEqual(parseListPage(fixture('spielplan-hinter-letzter-seite-2026-09.html')), {
    events: [],
    skipped: 0,
    empty: true,
    hasNext: false,
  });
});

test('normalisiert einen Termin vollständig', () => {
  const watchout = parseListPage(fixture('spielplan-seite1-2026-09.html')).events.find(
    (e) => e.id === 'theater-unikum:watchout-2026-10-17-2000',
  );
  assert.ok(watchout);
  assert.equal(watchout.title, 'WatchOUT');
  assert.equal(watchout.category, 'Spielzeiteröffnung');
  assert.equal(watchout.start, '2026-10-17T20:00:00+02:00');
  assert.equal(watchout.end, '2026-10-17T22:00:00+02:00');
  assert.equal(watchout.allDay, false);
  assert.deepEqual(watchout.venue, { name: 'Unikum Bühne 1' });
  assert.equal(watchout.availability, 'unknown', 'eine Ticketlage je Termin nennt die Seite nicht');
  assert.equal(watchout.ticketUrl, undefined);
  assert.equal(watchout.description, undefined, 'der gekürzte Listentext wird nicht übernommen');
  assert.equal(watchout.url, 'https://www.theater-unikum.de/events/watchout/');
});

test('mehrere Termine eines Stücks bekommen eigene IDs', () => {
  const { events } = parseListPage(fixture('spielplan-seite6-2026-09.html'));
  const mord = events.filter((e) => e.url.endsWith('/mord-on-backstage/'));
  assert.equal(mord.length, 3);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(events.at(-1)!.start, '2027-09-16T20:00:00+02:00');
});

test('liest Programmtext und Eintritt der Stückseite', () => {
  const detail = parseDetailPage(fixture('stueck-girl-interrupted.html'))!;
  assert.match(detail.description!, /^USA in den 1960er Jahren/);
  assert.deepEqual(detail.notes, ['Eintritt 6/11']);
  assert.equal(parseDetailPage('<html></html>'), undefined);
});

test('nimmt den Platzhalter des CMS nicht als Preis', () => {
  const page = (price: string) =>
    `<div class="em-event-content"><p>Text</p></div>
     <span class="elementor-post-info__item--type-custom">${price}</span>`;
  assert.equal(parseDetailPage(page('Eintritt: Preis eintragen'))!.notes, undefined);
  assert.deepEqual(parseDetailPage(page('Eintritt: Eintritt frei'))!.notes, ['Eintritt frei']);
  assert.deepEqual(parseDetailPage(page('Eintritt: 23'))!.notes, ['Eintritt 23']);
});

test('leeres oder fremdes HTML wird nicht als leere Liste gemeldet', () => {
  const kaputt = { events: [], skipped: 0, empty: false, hasNext: false };
  assert.deepEqual(parseListPage(''), kaputt);
  assert.deepEqual(parseListPage('<html><body>Wartung</body></html>'), kaputt);
});
