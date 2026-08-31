import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildEvents, parseDetailDescription, parseDetailPage, parseProgrammeList } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const september = () => parseProgrammeList(fixture('filter-2026-09.html'));
const all = () => parseProgrammeList(fixture('filter-all.html'));

test('liest Programmfragmente und erkennt leere Antworten', () => {
  const { entries, skipped, empty } = september();
  assert.equal(entries.length, 4);
  assert.equal(skipped, 0);
  assert.equal(empty, false);

  assert.deepEqual(parseProgrammeList(fixture('filter-empty-2026-08.html')), {
    entries: [],
    skipped: 0,
    empty: true,
  });
});

test('normalisiert eine Einzelveranstaltung aus Listen- und Detaildaten', () => {
  const entry = september().entries.find((item) => item.id === 'mervenzusammenbruch');
  assert.ok(entry);
  assert.equal(entry.dateRange?.from, '2026-09-12');
  assert.equal(entry.category, 'Comedy');
  assert.equal(entry.venue, 'Theatersaal');
  assert.equal(entry.availability, 'limited');
  assert.equal(entry.availabilityLabel, 'Letzte Tickets');
  assert.match(entry.ticketUrl!, /^https:\/\/tickets\.muenchenticket\.net\/shop\/214\/link\/category\/34928/);

  const detail = parseDetailPage(fixture('detail-mervenzusammenbruch.html'));
  const [event] = buildEvents(entry, detail);
  assert.equal(event.id, 'deutsches-theater:mervenzusammenbruch:2026-09-12-1930');
  assert.equal(event.title, 'MERVEnzusammenbruch');
  assert.match(event.description!, /^Mit ihrem feministischen und scharfen Blick/);
  assert.equal(event.category, 'Comedy');
  assert.equal(event.start, '2026-09-12T19:30:00+02:00');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Theatersaal');
  assert.equal(event.availability, 'limited');
  assert.ok(event.notes?.includes('Preise: 40,00 €'));
});

test('erkennt Ausverkauftes aus dem Keyvisual-Signal', () => {
  const entry = september().entries.find((item) => item.id === 'farin-urlaub-uebers-reisen');
  assert.ok(entry);
  assert.equal(entry.availability, 'soldout');

  const [event] = buildEvents(entry, parseDetailPage(fixture('detail-farin-urlaub-uebers-reisen.html')));
  assert.equal(event.title, 'Farin Urlaub übers Reisen');
  assert.equal(event.start, '2026-09-30T19:30:00+02:00');
  assert.equal(event.availabilityLabel, 'Ausverkauft');
});

test('expandiert Datumsbereiche nur anhand expliziter Vorstellungsbeginn-Regeln', () => {
  const entry = september().entries.find((item) => item.id === 'fack-ju-goehte');
  assert.ok(entry);

  const events = buildEvents(entry, parseDetailPage(fixture('detail-fack-ju-goehte.html')));
  assert.equal(events.length, 7);
  assert.deepEqual(events.map((event) => event.start), [
    '2026-09-15T19:30:00+02:00',
    '2026-09-16T19:30:00+02:00',
    '2026-09-17T19:30:00+02:00',
    '2026-09-18T19:30:00+02:00',
    '2026-09-19T15:00:00+02:00',
    '2026-09-19T19:30:00+02:00',
    '2026-09-20T14:30:00+02:00',
  ]);
  assert.ok(events.every((event) => event.title === 'Fack Ju Göhte – Das Musical'));
  assert.ok(events.every((event) => event.notes?.includes('Zeitraum: 15.09. bis 20.09.26')));
});

test('liest Details mit Beginn statt Vorstellungsbeginn', () => {
  const entry = all().entries.find((item) => item.id === 'flowermind');
  assert.ok(entry);
  const [event] = buildEvents(entry, parseDetailPage(fixture('detail-flowermind.html')));
  assert.equal(event.title, 'Hannah Köpf & Band – Flowermind');
  assert.equal(event.category, 'Konzert / Weltmusik');
  assert.equal(event.venue.name, 'Silbersaal');
  assert.equal(event.start, '2026-10-06T20:00:00+02:00');
});

test('vergibt eindeutige IDs und gültige Grundfelder', () => {
  const { entries } = all();
  assert.equal(entries.length, 116);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  for (const entry of entries) {
    assert.ok(entry.title.length > 0);
    assert.ok(entry.url.startsWith('https://www.deutsches-theater.de/'));
    assert.ok(entry.dateRange?.from);
    assert.ok(entry.dateRange?.to);
  }
});

test('bildet die Verfügbarkeitszustände aus dem Listenfragment ab', () => {
  const counts = all().entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.availability] = (acc[entry.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { limited: 11, available: 99, soldout: 3, not_on_sale: 2, unknown: 1 });
});

test('liest langen Programmtext aus der Detailseite', () => {
  const description = parseDetailDescription(fixture('detail-fack-ju-goehte.html'));
  assert.match(description!, /^Oh nein, die Chaosklasse/);
  assert.match(description!, /Leise heulen und Tickets sichern/);
  assert.doesNotMatch(description!, /Hauptrollen/);
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  assert.deepEqual(parseProgrammeList(''), { entries: [], skipped: 0, empty: false });
  assert.deepEqual(parseProgrammeList('<div class="vc_row"><div class="wpb_column"></div></div>'), {
    entries: [],
    skipped: 0,
    empty: true,
  });
});
