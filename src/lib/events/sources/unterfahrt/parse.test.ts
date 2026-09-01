import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { parseAvailableMonths, parseMonthPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const september = () => parseMonthPage(fixture('programm-2026-09.html'));
const november = () => parseMonthPage(fixture('programm-2026-11.html'));

test('liest alle Konzerte des Monats', () => {
  const { events, skipped, empty } = september();
  assert.equal(events.length, 27);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  for (const event of events) assert.ok(event.start.startsWith('2026-09'), event.start);

  const later = november();
  assert.equal(later.events.length, 11);
  for (const event of later.events) assert.ok(event.start.startsWith('2026-11'), event.start);
});

test('vergibt eindeutige IDs aus der dateID', () => {
  const { events } = september();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) assert.match(event.id, /^unterfahrt:\d+$/);
});

test('normalisiert ein Konzert vollständig', () => {
  const { events } = september();
  const jisr = events.find((e) => e.id === 'unterfahrt:11621');
  assert.ok(jisr, 'JISR vs. Fakir Trio am 1.9. gefunden');
  assert.equal(jisr.sourceId, 'unterfahrt');
  assert.equal(jisr.title, 'Jisr Vs. Fakir Trio');
  assert.equal(jisr.subtitle, undefined, 'die Quelle führt keinen Untertitel');
  assert.match(jisr.description!, /^JISR bedeutet Brücke\./);
  assert.equal(jisr.start, '2026-09-01T20:30:00+02:00');
  assert.equal(jisr.end, undefined, 'die Quelle nennt keine Endzeit');
  assert.equal(jisr.allDay, false);
  assert.equal(jisr.venue.name, 'Unterfahrt');
  assert.equal(jisr.venue.city, undefined);
  assert.equal(jisr.availability, 'available');
  assert.equal(
    jisr.ticketUrl,
    'https://www.unterfahrt.de/programm-detail.php?dateID=11621#ticketform',
  );
  assert.equal(jisr.url, 'https://www.unterfahrt.de/programm-detail.php?dateID=11621');
  assert.deepEqual(jisr.notes, [
    'Summer Week',
    'Eintritt: 28 €',
    'Mitglieder: 14 €',
    'Studenten: 14 €',
  ]);
});

test('erkennt Ausverkauftes hinter dem <br> in der Terminzeile', () => {
  const { events } = september();
  const soldout = events.find((e) => e.id === 'unterfahrt:11638');
  assert.ok(soldout);
  assert.equal(soldout.title, 'Jazz Sabbath');
  // Ohne <br>-Behandlung klebte "AUSVERKAUFT!" an "20••30".
  assert.equal(soldout.start, '2026-09-18T20:30:00+02:00');
  assert.equal(soldout.availability, 'soldout');
  assert.equal(soldout.availabilityLabel, 'Ausverkauft!');
  assert.equal(soldout.ticketUrl, undefined, 'kein Kartenlink bei ausverkauft');

  const counts: Record<string, number> = {};
  for (const event of events) counts[event.availability] = (counts[event.availability] ?? 0) + 1;
  assert.deepEqual(counts, { available: 26, soldout: 1 });
  assert.deepEqual(
    Object.keys(november().events.reduce<Record<string, true>>((a, e) => ({ ...a, [e.availability]: true }), {})),
    ['available'],
  );
});

test('führt die Reihe "Einstein Kultur" als eigene Spielstätte', () => {
  const { events } = november();
  const einstein = events.filter((e) => e.venue.name === 'Einstein Kultur');
  assert.equal(einstein.length, 3);
  // Die Quelle sagt es doppelt: im Schlagwort und im Programmtext.
  for (const event of einstein) {
    assert.ok(event.notes?.includes('Einstein Kultur'));
    assert.match(event.description!, /Einstein/);
  }
  assert.equal(events.filter((e) => e.venue.name === 'Unterfahrt').length, 8);
});

test('deckt sich mit dem data-ts der Quelle', () => {
  // Zweites Signal für den Termin – und die Falle dabei: `data-ts` trägt eine
  // UTC-Marke, meint aber Münchner Wanduhrzeit. Verglichen wird deshalb gegen
  // die UTC-Bestandteile, nicht gegen den umgerechneten Zeitpunkt.
  for (const name of ['programm-2026-09.html', 'programm-2026-11.html']) {
    const $ = cheerio.load(fixture(name));
    const expected = new Map<string, string>();
    $('.b-events__el').each((_, element) => {
      const id = $(element).find('a.o-btn-hex__link').attr('href')?.match(/dateID=(\d+)/)?.[1];
      const ts = Number($(element).attr('data-ts'));
      if (id && Number.isFinite(ts)) expected.set(id, new Date(ts).toISOString().slice(0, 16));
    });

    const { events } = parseMonthPage(fixture(name));
    assert.equal(expected.size, events.length);
    for (const event of events) {
      const id = event.id.slice('unterfahrt:'.length);
      assert.equal(event.start.slice(0, 16), expected.get(id), `${event.title} (${id})`);
    }
  }
});

test('liest die bespielten Monate aus dem Datepicker', () => {
  // Kostet keine eigene Anfrage und ist das zweite Signal für "leerer Monat".
  const months = parseAvailableMonths(fixture('programm-2026-09.html'));
  assert.deepEqual(months, [
    '2026-09', '2026-10', '2026-11', '2026-12',
    '2027-01', '2027-02', '2027-03', '2027-05',
  ]);
  assert.deepEqual(parseAvailableMonths('<html></html>'), []);
});

test('ein Monat ohne Konzert ist leer, nicht kaputt', () => {
  const { events, skipped, empty } = parseMonthPage(fixture('programm-leer-2027-04.html'));
  assert.equal(events.length, 0);
  assert.equal(skipped, 0);
  assert.equal(empty, true, 'der Container ist da, nur ohne Konzert');
  // Und die Seite selbst führt den April 2027 nicht als bespielt.
  assert.ok(!parseAvailableMonths(fixture('programm-leer-2027-04.html')).includes('2027-04'));
});

test('meldet nichts statt zu raten, wenn die Antwort unbrauchbar ist', () => {
  assert.deepEqual(parseMonthPage(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseMonthPage('<html><body><p>Wartung</p>'), {
    events: [],
    skipped: 0,
    empty: false,
  });
});
