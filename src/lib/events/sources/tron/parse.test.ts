import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attribute, buildEvents, parseEvents, parseInstances } from '../spektrix.ts';
import { LIST_URL, TIME_ZONE, parseEventList, parseSchedule, titleKey } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 4.9.2026 geholt: Spektrix führt 12 Produktionen, im
 * Oktober 2026 19 Vorstellungen. Januar 2020 liegt vor dem
 * Aufbewahrungsfenster und ist leer.
 */
const productions = () => parseEvents(fixture('events.json'));
const october = () => parseInstances(fixture('instances-2026-10.json'));
const links = () => parseEventList(fixture('liste-whats-on.html')).links;

/** Wie `index.ts` die Termine baut – ohne Netz und mit fester Uhr. */
const built = () =>
  buildEvents({
    sourceId: 'tron',
    timeZone: TIME_ZONE,
    events: productions(),
    instances: october(),
    include: (event) => attribute(event, 'WebsitePlacement') === 'Theatre',
    category: (event) =>
      [attribute(event, 'TAASubGenre'), attribute(event, 'TAAArtform')]
        .filter(Boolean)
        .join(' / ') || undefined,
    venue: (event) => {
      const location = attribute(event, 'Location');
      return location ? `Tron Theatre – ${location}` : 'Tron Theatre';
    },
    url: (event) => links()[titleKey(event.name)] ?? LIST_URL,
    ticketUrl: (_event, instance) => `https://www.tron.co.uk/book-online/${instance.id}`,
    notes: (event) => {
      const notes: string[] = [];
      const prices = attribute(event, 'Prices');
      if (prices) notes.push(`Tickets: ${prices}`);
      const presenter = [attribute(event, 'EventInfo'), attribute(event, 'EventInfo2')]
        .filter(Boolean)
        .join(' ');
      if (presenter) notes.push(presenter);
      return notes;
    },
    now: new Date('2026-09-04T09:00:00Z'),
  });

test('liest Produktionen und Vorstellungen der Schnittstelle', () => {
  assert.equal(productions().length, 12);
  assert.equal(october().length, 19);
});

test('lässt Tischreservierungen und Vermittlung draussen', () => {
  const events = built();
  assert.equal(events.length, 19, 'im Oktober steht nur Spielplan an');
  assert.equal(
    events.some((event) => event.title === 'Table Reservation'),
    false,
    'der Tischverkauf des Café/Bar ist kein Termin',
  );
  // Über das ganze Jahr gerechnet macht der Filter den Unterschied aus:
  // 177 der 291 Vorstellungen sind Tischreservierungen.
  const alle = parseEvents(fixture('events.json'));
  const versteckt = alle.filter((e) => attribute(e, 'WebsitePlacement') !== 'Theatre');
  assert.deepEqual(
    versteckt.map((e) => e.name).sort(),
    ['Community Ensemble 18+ | Recruitment Workshop', 'Table Reservation'],
  );
});

test('ein leerer Zeitraum ist gültig, kein Ausfall', () => {
  assert.deepEqual(parseInstances(fixture('instances-2020-01-leer.json')), []);
});

test('eine Antwort ohne Liste wirft', () => {
  assert.throws(() => parseEvents('<html>503</html>'), /kein JSON/);
  assert.throws(() => parseInstances('{"error":"nope"}'), /keine Liste/);
});

test('normalisiert einen Termin vollständig', () => {
  const event = built().find((e) => e.id === 'tron:560000AGBRSGBDQKMVKVTHJNNCRRHJTSP');
  assert.ok(event);
  assert.equal(event.sourceId, 'tron');
  assert.equal(event.title, 'Antigone');
  assert.equal(event.start, '2026-10-01T19:30:00+01:00');
  // Ende aus der Spieldauer (90 Minuten).
  assert.equal(event.end, '2026-10-01T21:00:00+01:00');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Tron Theatre – Main Auditorium');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.category, 'Drama New Writing / Plays/Drama');
  assert.equal(event.availability, 'unknown', 'Spektrix kennt keine Sitzplatzauskunft');
  assert.equal(
    event.ticketUrl,
    'https://www.tron.co.uk/book-online/560000AGBRSGBDQKMVKVTHJNNCRRHJTSP',
  );
  assert.equal(event.url, 'https://www.tron.co.uk/shows/antigone/');
  assert.deepEqual(event.notes, [
    'Tickets: Previews: £16 | Main Run: £19, £23 or £26',
    'Tron Theatre Company presents in association with Groupwork',
  ]);
  assert.match(event.description ?? '', /^The battle has been won/);
});

test('stellt die genauere Gattung voran', () => {
  const kategorien = new Set(built().map((event) => event.category));
  // `categories.ts` nimmt aus einer zusammengesetzten Angabe das erste
  // bekannte Glied – deshalb steht das Untergenre vorn.
  assert.equal(kategorien.has('Drama New Writing / Plays/Drama'), true);
  assert.equal(kategorien.has('Other Talks / Other Artforms'), true);
  // Produktionen ohne Gattung bleiben leer und bekommen den Quellen-Fallback.
  assert.equal(kategorien.has(undefined), true);
});

test('vergibt eindeutige IDs und Pflichtfelder', () => {
  const events = built();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(event.title, event.id);
    assert.ok(event.venue.name, event.id);
    assert.ok(event.url.startsWith('https://www.tron.co.uk/'), event.url);
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  }
});

test('findet die Adresse der Produktionsseite über den Titel', () => {
  const map = links();
  assert.equal(Object.keys(map).length, 9);
  // Der Slug trägt eine Nummer aus der WordPress-Historie und lässt sich
  // aus dem Namen nicht ableiten.
  assert.equal(
    map[titleKey('The Big Comedy Roadshow')],
    'https://www.tron.co.uk/shows/the-big-comedy-roadshow-3/',
  );
  assert.equal(parseEventList('<html></html>').recognised, false);
  assert.deepEqual(parseEventList('').links, {});
});

test('liest die Ticketlage aus dem Vorstellungskasten', () => {
  // Die Pantomime ist die einzige Produktion, an der alle vier Zustände
  // vorkommen: 41-mal frei, 13-mal "Last Few", 10-mal "Limited", einmal
  // ausverkauft, dazu eine Pressevorstellung ohne Knopf.
  const schedule = parseSchedule(fixture('detail-the-snaw-queen.html'));
  const zaehler: Record<string, number> = {};
  for (const row of Object.values(schedule)) {
    zaehler[row.availability] = (zaehler[row.availability] ?? 0) + 1;
  }
  assert.deepEqual(zaehler, { available: 41, limited: 23, soldout: 1, unknown: 1 });

  const soldout = Object.values(schedule).find((row) => row.availability === 'soldout');
  assert.equal(soldout?.availabilityLabel, 'SOLD OUT');
  // Ausgerechnet die ausverkaufte Zeile trägt keinen Link – deshalb wird über
  // Tag und Uhrzeit zugeordnet und nicht über die ID aus dem Link.
  assert.equal(soldout?.ticketUrl, undefined);

  const hinweise = new Set(Object.values(schedule).flatMap((row) => row.notes));
  assert.equal(hinweise.has('Preview'), true);
  assert.equal(hinweise.has('with British Sign Language'), true);
  assert.equal(hinweise.has('Relaxed Performance'), true);
});

test('rechnet 12-Stunden-Zeiten der Seite um', () => {
  const schedule = parseSchedule(fixture('detail-the-snaw-queen.html'));
  const keys = Object.keys(schedule).sort();
  assert.match(keys[0], /^2026-11-\d\dT\d\d:\d\d$/);
  // "7:00pm" wird 19:00, "1:00pm" wird 13:00, "10:30am" bleibt 10:30 – und
  // keine Zeile landet auf 24.
  const zeiten = new Set(keys.map((key) => key.slice(11)));
  assert.equal(zeiten.has('19:00'), true);
  assert.equal(zeiten.has('13:00'), true);
  assert.equal(zeiten.has('10:30'), true);
  assert.equal([...zeiten].every((time) => Number(time.slice(0, 2)) < 24), true);
});

test('leeres und kaputtes HTML liefert nichts, wirft aber nicht', () => {
  assert.deepEqual(parseSchedule(''), {});
  assert.deepEqual(parseSchedule('<html><body>Wartung</body></html>'), {});
});
