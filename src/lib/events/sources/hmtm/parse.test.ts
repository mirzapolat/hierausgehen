import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyEventTypes,
  parseEventTypes,
  parseListFragment,
  parseMonthResponse,
  parseNonce,
  parseTypeAssignments,
} from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const mai = () => parseMonthResponse(fixture('monat-2026-05.json'));
const november = () => parseMonthResponse(fixture('monat-2026-11.json'));
const arten = () => parseEventTypes(fixture('veranstaltungen.html'));

test('liest alle Termine des Monats', () => {
  const { events, skipped, empty, hasMore } = mai();
  assert.equal(events.length, 103);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(hasMore, false, 'die Abfrage war gross genug');
  for (const event of events) assert.ok(event.start.startsWith('2026-05'), event.start);
});

test('normalisiert einen Termin mit Kartenverkauf vollständig', () => {
  const oper = mai().events.find((e) => e.id === 'hmtm:musiktheater-im-reaktor-5');
  assert.ok(oper, '»Der Kaiser von Atlantis« am 1.5. gefunden');
  assert.equal(oper.sourceId, 'hmtm');
  assert.equal(oper.title, 'Musiktheater im Reaktor');
  assert.equal(oper.subtitle, '»Der Kaiser von Atlantis« von Viktor Ullmann');
  assert.equal(oper.description, undefined, 'die Liste führt keinen Programmtext');
  assert.equal(oper.start, '2026-05-01T19:00:00+02:00');
  assert.equal(oper.end, undefined, 'die Liste kennt keine Endzeit');
  assert.equal(oper.allDay, false);
  assert.deepEqual(oper.venue, { name: 'Luisenstraße / Reaktorhalle' });
  assert.equal(oper.availability, 'available');
  assert.equal(oper.availabilityLabel, 'Tickets');
  assert.equal(
    oper.ticketUrl,
    'https://www.muenchenticket.de/event/musiktheater-im-reaktor-2026-37177/',
  );
  assert.equal(oper.url, 'https://hmtm.de/veranstaltungen/musiktheater-im-reaktor-5/');
  assert.deepEqual(oper.notes, ['€ 30,00 / € 15,00 (erm.)']);
});

test('bildet die Ticketlage aus Absage, Knopf und Preiszeile', () => {
  const { events } = mai();
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { not_on_sale: 73, available: 30 });
  assert.equal(events.filter((e) => e.ticketUrl).length, 30, 'nur mit Knopf gibt es einen Link');

  const abgesagt = events.filter((e) => e.availabilityLabel === 'entfällt!');
  assert.equal(abgesagt.length, 5);
  for (const event of abgesagt) {
    assert.equal(event.availability, 'not_on_sale');
    assert.equal(event.ticketUrl, undefined, 'ein abgesagter Termin verkauft nichts');
  }

  const frei = events.find((e) => e.id === 'hmtm:vortrag-zur-entstehung-der-oper-der-kaiser-von-atlantis');
  assert.equal(frei!.availability, 'not_on_sale');
  assert.equal(frei!.availabilityLabel, 'Eintritt frei');
});

test('übernimmt die Hinweisfahne der Quelle als Notiz', () => {
  const hinweis = mai().events.find(
    (e) => e.id === 'hmtm:konzert-der-trompetenklasse-prof-juergen-ellensohn-6',
  );
  assert.ok(hinweis);
  assert.deepEqual(hinweis.notes, ['neue Uhrzeit', 'Eintritt frei']);
});

test('vergibt eindeutige IDs und gültige Pflichtfelder', () => {
  const { events } = mai();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gültiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.venue.name.length > 0);
    assert.ok(event.url.startsWith('https://hmtm.de/veranstaltungen/'));
  }
});

test('lässt Kürzel und Eigennamen in Titeln unangetastet', () => {
  const titel = mai().events.map((e) => e.title);
  assert.ok(titel.includes('HMTM vor Ort'), 'kein "Hmtm"');
  assert.ok(titel.includes('WERKSTATTkonzert des HSO München'));
  assert.ok(titel.includes('Klaviertage München (III): Schattenbilder und ferne Szenen'));
  assert.ok(titel.includes('V01CES//B0D1EZ'));
});

test('erfindet für auswärtige Termine keine Stadt', () => {
  // Erding und Gasteig stehen im selben Kalender wie die eigenen Säle.
  assert.equal(mai().events.filter((e) => e.venue.city).length, 0);
  const erding = november().events.find((e) => e.venue.name === 'Kreismusikschule Erding');
  assert.ok(erding, 'Symposium in Erding gefunden');
  assert.equal(erding.venue.city, undefined);
});

test('nimmt für einen Termin ohne Spielstätte die Hochschule', () => {
  const ohneOrt = mai().events.filter((e) => e.venue.name === 'HMTM');
  assert.equal(ohneOrt.length, 3);
});

test('liest Datum und Uhrzeit samt zweistelligem Jahr', () => {
  const fragment = (label: string) =>
    parseListFragment(`<div class="eventlistitem">
      <div class="eventlistitem__date"><span>${label}</span></div>
      <div class="eventlistitem__headline"><a href="/veranstaltungen/x/"><h2>Test</h2></a></div>
    </div>`).events[0];

  assert.equal(fragment("Fr. 1. Mai '26 / 19:00 Uhr").start, '2026-05-01T19:00:00+02:00');
  assert.equal(fragment("Do. 1. Januar '27 / 09:05 Uhr").start, '2027-01-01T09:05:00+01:00');
  assert.equal(fragment("Mi. 4. März '26 / 20:30 Uhr").start, '2026-03-04T20:30:00+01:00');

  // Ohne Uhrzeit bleibt der Termin ganztägig, statt eine zu erfinden.
  const ohneZeit = fragment("Mi. 4. März '26");
  assert.equal(ohneZeit.allDay, true);
  assert.equal(ohneZeit.start, '2026-03-04T00:00:00+01:00');
});

test('liest Nonce und Gattungsnamen aus der Veranstaltungsseite', () => {
  const page = fixture('veranstaltungen.html');
  assert.match(parseNonce(page)!, /^[a-z0-9]{10}$/);
  assert.equal(parseNonce('<html>ohne Filter</html>'), undefined);

  const namen = arten();
  assert.equal(namen.size, 8);
  assert.equal(namen.get(240), 'Wettbewerb');
  assert.equal(namen.get(1318), 'Theater/Oper/Musical');
});

test('ergänzt die Gattung aus der REST-Schnittstelle', () => {
  const zuordnung = parseTypeAssignments(fixture('arten-rest.json'));
  assert.equal(zuordnung.size, 24);

  const events = applyEventTypes(november().events, zuordnung, arten());
  assert.deepEqual(
    events.map((e) => e.category),
    // Der Jazz-Jam trägt keine Gattung – dort greift später `defaultCategory`.
    [undefined, 'Vortrag/Konferenz', 'Vortrag/Konferenz'],
  );
});

test('lässt die Termine stehen, wenn die Gattungen fehlen', () => {
  const events = november().events;
  assert.equal(applyEventTypes(events, new Map(), arten()), events);
  assert.equal(applyEventTypes(events, parseTypeAssignments(fixture('arten-rest.json')), new Map()), events);
  assert.deepEqual(parseTypeAssignments('<html>Fehlerseite</html>'), new Map());
  assert.deepEqual(parseEventTypes(''), new Map());
});

test('erkennt einen leeren Zeitraum und meldet ihn nicht als Fehler', () => {
  const result = parseMonthResponse(fixture('monat-leer-2026-12.json'));
  assert.deepEqual(result, { events: [], skipped: 0, empty: true, hasMore: false });
});

test('leere oder kaputte Antworten werfen nicht', () => {
  // Kein „empty" – eine Antwort ohne Terminblock ist ein Layoutfehler.
  const kaputt = { events: [], skipped: 0, empty: false, hasMore: false };
  assert.deepEqual(parseMonthResponse(''), kaputt);
  assert.deepEqual(parseMonthResponse('<html>Fehlerseite</html>'), kaputt);
  assert.deepEqual(parseMonthResponse('{"success":true,"html":"<div>Neues Layout</div>"}'), kaputt);
  assert.deepEqual(parseListFragment('<div class="eventlistitem"></div>'), {
    events: [],
    skipped: 1,
    empty: false,
  });
});
