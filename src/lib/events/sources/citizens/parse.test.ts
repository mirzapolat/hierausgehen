import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attribute, buildEvents, parseEvents, parseInstances } from '../spektrix.ts';
import { LIST_URL, TIME_ZONE, parseEventList, parseSchedule, titleKey } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 4.9.2026 geholt: Spektrix führt 157 Produktionen
 * (davon 79 im Spielplan „Shows"/„Heritage Tours", der Rest Kurse und
 * Vergangenes) und im Oktober 2026 71 Vorstellungen. Januar 2020 liegt vor dem
 * Aufbewahrungsfenster und ist leer. „1984" spielt 26-mal, „The Singer"
 * siebenmal und ist ausverkauft.
 */
const productions = () => parseEvents(fixture('events.json'));
const october = () => parseInstances(fixture('instances-2026-10.json'));
const links = () => parseEventList(fixture('liste-whats-on.html')).links;

/** Wie `index.ts` die Termine baut – ohne Netz und mit fester Uhr. */
const built = () =>
  buildEvents({
    sourceId: 'citizens',
    timeZone: TIME_ZONE,
    events: productions(),
    instances: october(),
    include: (event) => ['Shows', 'Heritage Tours'].includes(attribute(event, 'EventType') ?? ''),
    category: (event) =>
      attribute(event, 'EventType') === 'Heritage Tours' ? 'Heritage Tours' : undefined,
    venue: (event) => attribute(event, 'Venue') ?? 'Citizens Theatre',
    url: (event) => links()[titleKey(event.name)] ?? LIST_URL,
    now: new Date('2026-09-04T09:00:00Z'),
  });

test('liest Produktionen und Vorstellungen der Schnittstelle', () => {
  assert.equal(productions().length, 157);
  assert.equal(october().length, 71);
});

test('nimmt nur den Spielplan, nicht den Kursbetrieb', () => {
  // 71 Vorstellungen im Oktober, davon 47 aus „Shows"/„Heritage Tours".
  const events = built();
  assert.equal(events.length, 47);
  const rooms = new Set(events.map((event) => event.venue.name));
  assert.equal(rooms.has('Citizens Theatre - Participate Studio'), false, 'kein Kursraum');
});

test('ein leerer Zeitraum ist gültig, kein Ausfall', () => {
  assert.deepEqual(parseInstances(fixture('instances-2020-01-leer.json')), []);
});

test('eine Antwort ohne Liste wirft', () => {
  assert.throws(() => parseEvents('<html>503 Service Unavailable</html>'), /kein JSON/);
  assert.throws(() => parseInstances('{"message":"nope"}'), /keine Liste/);
  assert.throws(() => parseEvents(''), /kein JSON/);
});

test('normalisiert einen Termin vollständig', () => {
  const event = built().find((e) => e.id === 'citizens:74201ACMVPHLJKTRRBJKKLCTRPJVKGDGS');
  assert.ok(event);
  assert.equal(event.sourceId, 'citizens');
  assert.equal(event.title, 'Tristan & Yseult');
  assert.equal(event.start, '2026-10-01T14:00:00+01:00');
  // Ende aus der Spieldauer der Produktion (120 Minuten).
  assert.equal(event.end, '2026-10-01T16:00:00+01:00');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Citizens Theatre - Main Theatre');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.category, undefined, 'das Haus nennt keine Gattung');
  assert.equal(event.availability, 'unknown', 'Spektrix kennt keine Sitzplatzauskunft');
  assert.equal(event.url, 'https://citz.co.uk/whats-on/tristan-yseult/');
});

test('rechnet über die Zeitumstellung hinweg richtig', () => {
  // Die britischen Uhren gehen am 25.10.2026 zurück.
  const events = built();
  const bst = events.find((e) => e.start.startsWith('2026-10-24'));
  const gmt = events.find((e) => e.start.startsWith('2026-10-27'));
  assert.match(bst?.start ?? '', /\+01:00$/);
  assert.match(gmt?.start ?? '', /\+00:00$/);
  assert.equal(gmt?.start, '2026-10-27T19:30:00+00:00');
});

test('vergibt eindeutige IDs und Pflichtfelder', () => {
  const events = built();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(event.title, event.id);
    assert.ok(event.venue.name, event.id);
    assert.ok(event.url.startsWith('https://citz.co.uk/'), event.url);
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  }
});

test('übernimmt den Programmtext der Produktion', () => {
  const event = built().find((e) => e.title === 'East is East');
  assert.ok(event);
  assert.match(event.description ?? '', /\w{40,}|\w+\s\w+/);
  assert.equal(event.description?.includes('<'), false, 'ohne Auszeichnungen');
});

test('findet die Adresse der Produktionsseite über den Titel', () => {
  const map = links();
  assert.equal(Object.keys(map).length, 29);
  assert.equal(map[titleKey('1984')], 'https://citz.co.uk/whats-on/1984-play/');
  // Spektrix hängt Leerzeichen an, die Website nicht; das Apostroph ist
  // einmal gerade und einmal typografisch.
  assert.equal(titleKey('The Singer  '), titleKey('The Singer'));
  assert.equal(titleKey("Queer Folks' Tales: Sep 26 "), titleKey('Queer Folks’ Tales: Sep 26'));
  assert.equal(parseEventList('<html></html>').recognised, false);
});

test('liest die Ticketlage aus dem Spielplan der Produktionsseite', () => {
  const schedule = parseSchedule(fixture('detail-1984.html'));
  assert.equal(Object.keys(schedule).length, 26);
  assert.deepEqual(schedule['2026-09-04T19:30'], {
    availability: 'limited',
    availabilityLabel: 'Limited tickets',
    // Der einzige Ticketlink, den diese Quelle kennt – Spektrix nennt keinen.
    ticketUrl: 'https://citz.co.uk/whats-on/1984/book/62602',
    notes: [],
  });
  assert.equal(schedule['2026-09-05T19:30'].availability, 'available');
  // Barrierefreiheit steht als eigene Spalte daneben.
  assert.deepEqual(schedule['2026-09-19T14:00'].notes, ['Audio Described and Captioned']);
  // Eine Schulvorstellung hat gar keinen Knopf – das ist nicht ausverkauft,
  // sondern nicht öffentlich buchbar.
  assert.equal(schedule['2026-09-22T10:30'].availability, 'unknown');
  assert.deepEqual(schedule['2026-09-22T10:30'].notes, ['Schools']);
});

test('erkennt eine ausverkaufte Produktion', () => {
  // Spektrix meldet für alle sieben Abende `isOnSale: true`; nur die Website
  // weiss es besser.
  const schedule = parseSchedule(fixture('detail-the-singer-ausverkauft.html'));
  assert.equal(Object.keys(schedule).length, 7);
  const zustaende = new Set(Object.values(schedule).map((row) => row.availability));
  assert.deepEqual([...zustaende], ['soldout']);
  assert.equal(schedule['2026-09-15T19:45'].availabilityLabel, 'Sold Out');
  // Ohne Knopf gibt es auch keinen Ticketlink.
  assert.equal(schedule['2026-09-15T19:45'].ticketUrl, undefined);
});

test('leeres und kaputtes HTML liefert nichts, wirft aber nicht', () => {
  assert.deepEqual(parseSchedule(''), {});
  assert.deepEqual(parseSchedule('<html><body>Wartung</body></html>'), {});
  assert.deepEqual(parseEventList('').links, {});
});
