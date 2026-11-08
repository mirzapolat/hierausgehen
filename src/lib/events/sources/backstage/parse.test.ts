import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEventsPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixture wurde am 8.11.2026 geholt: die Seite trägt die ersten 200 von
 * 356 kommenden Terminen (8.11.2026 bis 2.2.2027).
 */
const NOW = new Date('2026-11-08T12:00:00Z');
const page = () => parseEventsPage(fixture('events-upcoming-2026-11.html'), NOW);

test('liest alle Termine der Seite und die Gesamtzahl', () => {
  const result = page();
  assert.equal(result.empty, false);
  assert.equal(result.skipped, 0);
  assert.equal(result.loaded, 200);
  assert.equal(result.total, 356);
  assert.equal(result.events.length, 200);

  const perMonth: Record<string, number> = {};
  for (const event of result.events) {
    const month = event.start.slice(0, 7);
    perMonth[month] = (perMonth[month] ?? 0) + 1;
  }
  assert.deepEqual(perMonth, { '2026-11': 81, '2026-12': 73, '2027-01': 45, '2027-02': 1 });
});

test('IDs sind eindeutig', () => {
  const ids = page().events.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('ein vollständiger Termin', () => {
  const event = page().events.find((e) => e.id === 'backstage:0506cdc4-bd28-4aaa-b66d-7a660d857421');
  assert.deepEqual(event, {
    id: 'backstage:0506cdc4-bd28-4aaa-b66d-7a660d857421',
    sourceId: 'backstage',
    title: 'The Browning - Europe Fall 2026',
    subtitle: 'Supports: Within Destruction + Abbie Falls',
    category: 'Live',
    start: '2026-11-08T19:30:00+01:00',
    allDay: false,
    venue: { name: 'Backstage Werk' },
    availability: 'unknown',
    url: 'https://www.backstage.eu/event/0506cdc4-bd28-4aaa-b66d-7a660d857421',
    notes: ['Genre: Deathcore, Metalcore', 'Preis: ab 41,95 €'],
  });
});

test('Termin im Vorverkauf mit Ticketlink', () => {
  const event = page().events.find((e) => e.availability === 'available')!;
  assert.equal(event.ticketUrl, event.url);
});

test('Verteilung der Ticketlagen', () => {
  const counts: Record<string, number> = {};
  for (const event of page().events) {
    const key = event.availabilityLabel ? `${event.availability}:${event.availabilityLabel}` : event.availability;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    available: 78,
    soldout: 7,
    'not_on_sale:Abgesagt': 2,
    'not_on_sale:Verlegt': 4,
    unknown: 109,
  });
});

test('Statuszusätze werden aus dem Titel gelöst', () => {
  const events = page().events;
  const soldOut = events.find((e) => e.id === 'backstage:78d6c822-00d0-4d74-9e8d-8391538c8f36')!;
  assert.equal(soldOut.title, 'President - Live 2026');
  assert.equal(soldOut.availability, 'soldout');

  const cancelled = events.find((e) => e.title.startsWith('Undacava'))!;
  assert.equal(cancelled.title, 'Undacava - Echter Berliner Tour');
  assert.equal(cancelled.availability, 'not_on_sale');
  assert.equal(cancelled.availabilityLabel, 'Abgesagt');

  const moved = events.find((e) => e.title.startsWith('Black Sabbitch'))!;
  assert.equal(moved.availability, 'not_on_sale');
  assert.equal(moved.availabilityLabel, 'Verlegt');
  assert.ok(moved.notes?.includes('Hinweis: verlegt auf den 19.04.27'));

  const dated = events.find((e) => e.title === 'Backstage Comedy Night')!;
  assert.equal(dated.start.slice(0, 10), '2026-11-11');

  assert.ok(events.some((e) => e.title.endsWith('| Nations League')));
  assert.ok(events.every((e) => !/\|\s*(ausverkauft|leider abgesagt)/i.test(e.title)));
});

test('Arten im Wortlaut, Jubiläumsreihe als Hinweis', () => {
  const counts: Record<string, number> = {};
  for (const event of page().events) {
    const key = event.category ?? '(keine)';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    Live: 151,
    Feiern: 24,
    'Fussball Live im Backstage': 20,
    Märkte: 1,
    '(keine)': 4,
  });
  const anniversary = page().events.find((e) => e.title.startsWith('Pyogenesis'))!;
  assert.ok(anniversary.notes?.includes('Reihe: 36 Jahre Backstage'));
});

test('leeres oder fremdes HTML: nichts erkannt', () => {
  for (const html of ['', '<html><body><p>Wartung</p></body></html>']) {
    const result = parseEventsPage(html, NOW);
    assert.equal(result.events.length, 0);
    assert.equal(result.empty, false);
  }
});

test('leere Abfrage: erkannt, aber leer', () => {
  const payload = JSON.stringify([
    1,
    '7:["$","$L21",null,{"state":{"mutations":[],"queries":[{"state":{"data":[]},"queryKey":["upcoming",{"limit_count":200,"offset_count":0}]}]}}]\n',
  ]);
  const html = `<script>self.__next_f.push(${payload})</script>`;
  const result = parseEventsPage(html, NOW);
  assert.equal(result.empty, true);
  assert.equal(result.events.length, 0);
});
