import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEventDetail, parseProgramme } from './parse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');
const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
const programme = () => parseProgramme(fixture('events-alle-2026-11.html'), '2026-11-08');

test('liest jeden Termin genau einmal, Hinweiskästen zählen nicht', () => {
  const { events, skipped, empty } = programme();
  // 216 Blöcke: 1 Hinweis („ab 02.11.26“), 212 Einzeltermine, 3 Blöcke mit je zwei Tagen.
  assert.equal(events.length, 218);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.ok(!events.some((e) => e.title.startsWith('Bargeldlose Zahlung')));
});

test('normalisiert einen Termin vollständig', () => {
  const event = programme().events.find((e) => e.id === 'muffatwerk:8341');
  assert.deepEqual(event, {
    id: 'muffatwerk:8341',
    sourceId: 'muffatwerk',
    title: 'Dominik Hartz',
    subtitle: 'verstr!ckt Tour 2026',
    category: 'Konzert',
    start: '2026-11-23T20:00:00+01:00',
    allDay: false,
    venue: { name: 'Hansa 39' },
    availability: 'available',
    availabilityLabel: undefined,
    ticketUrl: 'https://www.eventim.de/event/dominik-hartz-verstrckt-tour-2026-feierwerk-22156754/',
    url: 'https://www.muffatwerk.de/de/events/view/8341/dominik-hartz',
    notes: ['Support: Jenny & Joy', 'Hinweis: verlegt aus der Muffathalle'],
  });
});

test('Ticketlage aus Statushinweis und Ticketlink', () => {
  const { events } = programme();
  assert.deepEqual(count(events.map((e) => e.availability)), {
    available: 184,
    soldout: 15,
    not_on_sale: 11,
    unknown: 8,
  });
  const moved = events.find((e) => e.id === 'muffatwerk:8014');
  assert.equal(moved?.availability, 'not_on_sale');
  assert.equal(moved?.availabilityLabel, 'Verlegt auf den 23.11.26');
  assert.equal(moved?.start, '2026-11-08T20:00:00+01:00'); // „Heute“
  assert.equal(moved?.ticketUrl, undefined);
  const soldout = events.find((e) => e.id === 'muffatwerk:7935');
  assert.equal(soldout?.availability, 'soldout');
  assert.equal(soldout?.subtitle, 'Herzlich Willkommen - Im Club Tour 2026');
  assert.equal(events.filter((e) => e.availabilityLabel === 'Abgesagt').length, 6);
});

test('Arten im Wortlaut der Quelle', () => {
  assert.deepEqual(count(programme().events.map((e) => e.category ?? '–')), {
    Konzert: 204,
    clubbing: 4,
    'Clubbing & Live Act': 1,
    'Poetry Slam': 3,
    'Tanz / Theater': 2,
    'Tanz Performance': 2,
    Tanz: 2,
  });
});

test('mehrtägige Termine und Termine ohne Uhrzeit sind ganztägig', () => {
  const { events } = programme();
  const days = events.filter((e) => e.id.startsWith('muffatwerk:8322:'));
  assert.deepEqual(
    days.map((e) => [e.id, e.start, e.allDay]),
    [
      ['muffatwerk:8322:2027-01-12', '2027-01-12T00:00:00+01:00', true],
      ['muffatwerk:8322:2027-01-13', '2027-01-13T00:00:00+01:00', true],
    ],
  );
  const noTime = events.find((e) => e.id === 'muffatwerk:8277');
  assert.equal(noTime?.allDay, true);
  assert.equal(noTime?.start, '2026-12-02T00:00:00+01:00');
  const title = events.find((e) => e.id === 'muffatwerk:8284');
  assert.equal(title?.title, 'Element Sound 20th Anniversary');
  assert.equal(title?.subtitle, 'Reggae, Dancehall, Afrobeat, Rap · Mit Element Sound, Max Rubadub, Suluin Sound');
});

test('leere oder fremde Seite: nichts erkannt', () => {
  for (const html of ['', '<html><body><p>Wartung</p></body></html>']) {
    const result = parseProgramme(html, '2026-11-08');
    assert.equal(result.events.length, 0);
    assert.equal(result.empty, false);
  }
  const empty = parseProgramme(
    '<div id="content" class="container"><div class="row"><div class="entry entry-big opened"><div class="entry-content"><h1>Gesamt im Muffatwerk</h1></div></div></div></div>',
    '2026-11-08',
  );
  assert.equal(empty.empty, true);
});

test('Detailseite: Text, Einlass, Beginn, Preise', () => {
  const detail = parseEventDetail(fixture('detail-8322.html'));
  assert.ok(detail?.description?.startsWith('Ein fremder Horizont: staubig, leer'));
  assert.ok(detail?.description?.includes('\nChoreografie: Moritz Ostruschnjak'));
  assert.equal(detail?.startTime, '20:00');
  assert.deepEqual(detail?.notes, [
    'Einlass: 19:00',
    'Preise: VVK / AK € 25, erm. € 15 zzgl. Gebühren (Ermäßigung: Schüler*innen, Studierende, Kolleg*innen)',
  ]);

  const mine = parseEventDetail(fixture('detail-7879.html'));
  assert.deepEqual(mine?.notes, ['Einlass: 19:00', 'Preise: VVK ab € 46,95 inkl. Gebühren']);

  const noTime = parseEventDetail(fixture('detail-8277.html'));
  assert.equal(noTime?.startTime, undefined);
  assert.deepEqual(noTime?.notes, ['Preise: VVK € ab 69,25 (inkl. Geb.)']);

  assert.equal(parseEventDetail('<html></html>'), undefined);
});
