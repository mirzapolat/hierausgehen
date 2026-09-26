import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseEventsPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const eventsPage = () => parseEventsPage(fixture('events-2026-09.html'));

test('liest die kommende Eventliste', () => {
  const { events, skipped, empty } = eventsPage();
  assert.equal(events.length, 28);
  assert.equal(skipped, 0);
  assert.equal(empty, false);

  const proTag = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.start.slice(0, 10)] = (acc[event.start.slice(0, 10)] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(proTag, {
    '2026-09-01': 2,
    '2026-09-02': 1,
    '2026-09-03': 2,
    '2026-09-04': 3,
    '2026-09-05': 3,
    '2026-09-06': 3,
    '2026-09-07': 2,
    '2026-09-08': 2,
    '2026-09-09': 2,
    '2026-09-10': 2,
    '2026-09-11': 3,
    '2026-09-12': 3,
  });
});

test('normalisiert eine Vorstellung vollständig', () => {
  const film = eventsPage().events.find(
    (event) => event.id === 'kinoamolympiasee:same-sun-mit-dem-fahrrad-durch-afrika-2026-09-01-1800',
  );
  assert.ok(film, 'Same Sun um 18:00 gefunden');
  assert.equal(film.sourceId, 'kinoamolympiasee');
  assert.equal(film.title, 'Wiebke präsentiert ihren Film. Same Sun – mit dem Fahrrad durch Afrika (OmeU)');
  assert.equal(film.category, undefined);
  assert.equal(film.start, '2026-09-01T18:00:00+02:00');
  assert.equal(film.end, undefined);
  assert.equal(film.allDay, false);
  assert.deepEqual(film.venue, { name: 'Kino am Olympiasee' });
  assert.equal(film.availability, 'available');
  assert.equal(film.availabilityLabel, 'Tickets');
  assert.equal(
    film.ticketUrl,
    'https://www.kinoheld.de/kino/muenchen/kino-am-olympiasee/vorstellung/3605399765?mode=widget&appView=1&cid=ODA1OTgw#panel-seats',
  );
  assert.equal(
    film.url,
    'https://kinoamolympiasee.de/show/same-sun-mit-dem-fahrrad-durch-afrika-2026-09-01-1800/',
  );
});

test('liest Kategorien, wenn die Quelle sie am Termin fuehrt', () => {
  const events = eventsPage().events;
  assert.equal(events.filter((event) => event.category === 'Plus Event').length, 6);

  const plus = events.find((event) => event.id === 'kinoamolympiasee:mamma-mia-2026-09-04-2020');
  assert.equal(plus?.category, 'Plus Event');
});

test('bildet Ticketlage und eindeutige IDs ab', () => {
  const { events } = eventsPage();
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.availability] = (acc[event.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { available: 28 });
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);

  const mehrfach = events.filter((event) => event.title.includes('Steckerlfischfiasko'));
  assert.equal(mehrfach.length, 11);
  assert.equal(new Set(mehrfach.map((event) => event.id)).size, mehrfach.length);
});

test('nimmt die sichtbare Uhrzeit vor der Uhrzeit aus dem URL-Slug', () => {
  const michael = eventsPage().events.find(
    (event) => event.id === 'kinoamolympiasee:michael-2026-09-11-2015',
  );
  assert.equal(michael?.start, '2026-09-11T20:20:00+02:00');
});

test('liest Detailbeschreibungen aus Metadaten', () => {
  const description = parseDetailDescription(fixture('detail-same-sun-2026-09-01.html'));
  assert.match(description!, /^Unglaublich, is aber so:/);
  assert.ok(description!.includes('430-tägigen Reise durch 22 Länder'));
});

test('erkennt leere und kaputte Antworten', () => {
  assert.deepEqual(parseEventsPage('<div class="fusion-post-cards"><ul class="fusion-grid"></ul></div>'), {
    events: [],
    skipped: 0,
    empty: true,
  });
  assert.deepEqual(parseEventsPage('<html>Wartung</html>'), {
    events: [],
    skipped: 0,
    empty: false,
  });
});

test('erkennt die leere Liste ausserhalb der Saison', () => {
  assert.deepEqual(parseEventsPage(fixture('events-leer-2026-09-27.html')), {
    events: [],
    skipped: 0,
    empty: true,
  });
});
