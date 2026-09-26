import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const programme = () => parseProgrammePage(fixture('programm-2026-09.html'));

test('liest die ganze Spielzeit aus einer Antwort', () => {
  const { events, skipped } = programme();
  // 174 `li.preview-event` auf der Seite, verteilt auf 112 Spieltage.
  assert.equal(events.length, 174);
  assert.equal(skipped, 0);
  assert.equal(new Set(events.map((e) => e.start.slice(0, 10))).size, 112);
  assert.equal(events[0].start.slice(0, 10), '2026-09-21');
  assert.equal(events[events.length - 1].start.slice(0, 10), '2027-10-20');
});

test('vergibt eindeutige IDs aus der Vorstellungsnummer', () => {
  const { events } = programme();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) assert.match(event.id, /^kammerspiele:\d+$/);
});

test('normalisiert eine Premiere vollständig', () => {
  const { events } = programme();
  const danton = events.find((e) => e.id === 'kammerspiele:52293');
  assert.ok(danton, 'Danton am 23.9. gefunden');
  assert.equal(danton.sourceId, 'kammerspiele');
  assert.equal(danton.title, 'Danton');
  assert.equal(
    danton.subtitle,
    'Eine revolutionäre Spurensuche nach Georg Büchner von Post Paradies und Ensemble',
  );
  assert.equal(danton.start, '2026-09-23T20:00:00+02:00');
  assert.equal(danton.end, undefined);
  assert.equal(danton.allDay, false);
  assert.equal(danton.venue.name, 'Schauspielhaus');
  assert.equal(danton.venue.city, undefined);
  assert.equal(danton.availability, 'limited');
  assert.equal(danton.availabilityLabel, 'Wenige Tickets');
  assert.equal(
    danton.ticketUrl,
    'https://tickets.muenchner-kammerspiele.de/de/buyingflow/tickets/16481/39481',
  );
  assert.equal(
    danton.url,
    'https://www.muenchner-kammerspiele.de/de/programm/51507-danton?activity=52293',
  );
  assert.equal(
    danton.icsUrl,
    'https://www.muenchner-kammerspiele.de/de/programm/51507-danton/52293.ics',
  );
  // Der Absatz mit der eigenen Uhrzeit ist ein Hinweis, nicht der Beginn.
  assert.deepEqual(danton.notes, [
    'Premiere',
    'MK: 100',
    'Premierenabo',
    '19:45 Eröffnung der Jubiläumsspielzeit "MK: 100" mit Oberbürgermeister Dominik Krause und Intendantin Barbara Mundel',
  ]);
});

test('nimmt die Endzeit mit, wenn die Quelle eine nennt', () => {
  const { events } = programme();
  const enjoy = events.find((e) => e.id === 'kammerspiele:52974');
  assert.ok(enjoy);
  assert.equal(enjoy.start, '2026-09-26T20:00:00+02:00');
  assert.equal(enjoy.end, '2026-09-26T21:40:00+02:00');
  assert.equal(events.filter((e) => e.end).length, 30);
});

test('lässt Anschlussprogramm nicht zur Spielstätte werden', () => {
  const { events } = programme();
  const prachttier = events.find((e) => e.id === 'kammerspiele:50777');
  assert.ok(prachttier);
  assert.equal(prachttier.venue.name, 'Schauspielhaus');
  assert.ok(prachttier.notes?.includes('Anschl. Publikumsgespräch'));
  assert.ok(prachttier.notes?.includes('Einführung ab 19:30'));
});

test('kennt die Ticketlage in allen vier Zuständen der Quelle', () => {
  const { events } = programme();
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.availability] = (counts[event.availability] ?? 0) + 1;
  assert.deepEqual(counts, { soldout: 7, limited: 4, not_on_sale: 79, available: 84 });

  // Ausverkauft steht als Knopf mit Warteliste – der Zusatz ist ein Hinweis.
  const soldout = events.find((e) => e.id === 'kammerspiele:52717');
  assert.equal(soldout?.availability, 'soldout');
  assert.equal(soldout?.availabilityLabel, 'Ausverkauft');
  assert.equal(soldout?.ticketUrl, undefined, 'kein Kartenlink bei ausverkauft');
  assert.ok(soldout?.notes?.includes('mit Warteliste'));

  // Noch nicht im Verkauf: ein <span>, kein Knopf.
  const upcoming = events.find((e) => e.id === 'kammerspiele:51816');
  assert.equal(upcoming?.availability, 'not_on_sale');
  assert.equal(upcoming?.availabilityLabel, 'Im VVK ab 1.10.');
  assert.equal(upcoming?.ticketUrl, undefined);

  // Kostenfreies wird nicht verkauft, ist aber auch nicht gesperrt.
  const free = events.find((e) => e.id === 'kammerspiele:53416');
  assert.equal(free?.availability, 'not_on_sale');
  assert.equal(free?.availabilityLabel, 'Kostenfrei');
});

test('erfindet keine Uhrzeit, wo die Quelle noch keine nennt', () => {
  const { events } = programme();
  const allDay = events.filter((e) => e.allDay);
  assert.equal(allDay.length, 21);
  for (const event of allDay) assert.match(event.start, /T00:00:00/);

  // Ein Block mit nur einem Absatz führt die zweite Zeile, keine Spielstätte.
  const kurs = events.find((e) => e.id === 'kammerspiele:51958');
  assert.equal(kurs?.allDay, true);
  assert.equal(kurs?.subtitle, 'Ein performativer Kurs über Geschichte als Besitz von Franz Wanner');
  assert.equal(kurs?.venue.name, 'Münchner Kammerspiele');
});

test('deckt sich mit der aria-Beschriftung des iCal-Knopfs', () => {
  // Zweites, unabhängiges Signal für Tag und Uhrzeit – bricht der Aufbau der
  // Textabsätze, fällt es hier auf.
  const $ = cheerio.load(fixture('programm-2026-09.html'));
  const expected = new Map<string, string>();
  $('li.preview-event').each((_, element) => {
    const button = $(element).find('.event-button--ical').first();
    const id = button.attr('href')?.match(/\/(\d+)\.ics$/)?.[1];
    const label = button.attr('aria-label')?.match(/am (\d{1,2})\.(\d{1,2})\.(\d{4}) um (\d{1,2}:\d{2})?/);
    if (id && label) {
      const day = `${label[3]}-${label[2].padStart(2, '0')}-${label[1].padStart(2, '0')}`;
      expected.set(id, `${day} ${label[4] ?? ''}`);
    }
  });

  const { events } = programme();
  assert.equal(expected.size, events.length);
  for (const event of events) {
    const id = event.id.slice('kammerspiele:'.length);
    const actual = `${event.start.slice(0, 10)} ${event.allDay ? '' : event.start.slice(11, 16)}`;
    assert.equal(actual, expected.get(id), `${event.title} (${id})`);
  }
});

test('liest den Programmtext der Produktionsseite', () => {
  const description = parseDetailDescription(fixture('detail-danton-2026-09.html'));
  assert.ok(description);
  assert.match(description, /^1926 eröffnete Otto Falckenberg/);
  assert.match(description, /Post Paradies/);
  // Keine Besetzungsliste, kein Ticketshop, keine Navigation.
  assert.doesNotMatch(description, /Warenkorb|Newsletter|Spielplan/);
});

test('meldet nichts statt zu raten, wenn die Antwort unbrauchbar ist', () => {
  assert.deepEqual(parseProgrammePage(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseProgrammePage('<html><body><p>Wartung</p>'), { events: [], skipped: 0, empty: false });
  assert.equal(parseDetailDescription(''), undefined);
  assert.equal(parseDetailDescription('<html><body><p>kurz</p>'), undefined);
});

test('hält die Spielpause von einem geänderten Aufbau auseinander', () => {
  assert.deepEqual(parseProgrammePage('<div class="block block--calendar-a"></div>'), {
    events: [],
    skipped: 0,
    empty: true,
  });
});
