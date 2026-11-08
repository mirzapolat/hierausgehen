import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCalendar, parseProductionDetail } from './parse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');
const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
const november = () => parseCalendar(fixture('kalender-2026-11.html'));

test('liest jeden Termin des Monats genau einmal', () => {
  const { events, skipped, empty, window } = november();
  assert.equal(events.length, 43);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, 43);
  assert.deepEqual(window, { from: '2026-11-01', to: '2026-11-30' });
});

test('normalisiert eine Vorstellung vollständig', () => {
  const event = november().events.find((e) => e.id === 'operamrhein:3707');
  assert.deepEqual(event, {
    id: 'operamrhein:3707',
    sourceId: 'operamrhein',
    title: 'Die Meistersinger von Nürnberg',
    subtitle: 'Richard Wagner',
    description: '„Wahn, überall Wahn“ – ein Meister-Werk',
    category: 'Oper',
    start: '2026-11-01T15:00:00+01:00',
    end: '2026-11-01T20:20:00+01:00',
    allDay: false,
    venue: { name: 'Opernhaus Düsseldorf' },
    availability: 'unknown',
    availabilityLabel: undefined,
    ticketUrl: undefined,
    url: 'https://www.operamrhein.de/spielplan/kalender/2026-11/duesseldorf/die-meistersinger-von-nuernberg/3707/',
    icsUrl: undefined,
    notes: ['Preise: 115 / 99 / 89 / 79 / 67 / 55 / 40 / 28 €', 'Abo: Sonntagnachmittags-Abo 2', 'Im Anschluss: Nachgefragt'],
  });
});

test('verteilt die Ticketlage aus Knopf und Klasse', () => {
  assert.deepEqual(count(november().events.map((e) => e.availability)), {
    unknown: 12,
    not_on_sale: 2,
    available: 24,
    limited: 1,
    soldout: 4,
  });
  const soldout = november().events.find((e) => e.id === 'operamrhein:4002')!;
  assert.equal(soldout.availability, 'soldout');
  assert.ok(soldout.notes?.includes('evtl. Restkarten an der Abendkasse'));
  const closed = november().events.find((e) => e.id === 'operamrhein:3797')!;
  assert.equal(closed.availabilityLabel, 'Tanzprojekt bereits gestartet, nicht mehr buchbar.');
  assert.equal(closed.notes, undefined);
});

test('liest beide Titelbauarten ohne weiche Trennzeichen', () => {
  const titles = november().events.map((e) => e.title);
  assert.ok(titles.includes('Mixed-Abled Tanzprojekt'));
  assert.ok(titles.every((t) => !t.includes('­')));
  const film = november().events.find((e) => e.id === 'operamrhein:3878')!;
  assert.equal(film.title, 'TanzFilm');
  assert.equal(film.subtitle, 'Mit dem Ballett am Rhein ins Kino');
});

test('ein Monat vor Spielzeitbeginn ist leer, kein Layoutbruch', () => {
  assert.deepEqual(parseCalendar(fixture('kalender-leer-vor-spielzeit-2026-07.html')), {
    events: [],
    skipped: 0,
    empty: true,
    window: { from: '2026-07-31', to: '2026-07-31' },
  });
});

test('ein Monat hinter dem Ladefenster liefert einen anderen Zeitraum', () => {
  const { events, window } = parseCalendar(fixture('kalender-angefragt-2027-08-geliefert-2027-07.html'));
  assert.deepEqual(window, { from: '2027-07-18', to: '2027-07-18' });
  assert.ok(events.every((e) => e.start.startsWith('2027-07-18')));
});

test('liest Programmtext und Tabellenangaben der Produktionsseite', () => {
  const detail = parseProductionDetail(fixture('produktion-meistersinger-2026-11.html'))!;
  assert.match(detail.description!, /^Der junge Ritter Walther von Stolzing/);
  assert.doesNotMatch(detail.description!, /ERSTER AUFZUG/);
  assert.deepEqual(detail.notes?.slice(0, 3), [
    'Sprache: In deutscher Sprache mit Übertiteln',
    'Dauer: ca. 5¼ Stunden, zwei Pausen',
    'Alter: Empfohlen ab 16 Jahren',
  ]);
  assert.equal(parseProductionDetail('<html></html>'), undefined);
});

test('eine fremde Seite wird nicht als leerer Monat gemeldet', () => {
  assert.equal(parseCalendar('').empty, false);
  assert.equal(parseCalendar('<html><body>Wartung</body></html>').empty, false);
});
