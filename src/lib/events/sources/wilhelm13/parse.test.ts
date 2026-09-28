import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEvents } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const startseite = () => parseEvents(fixture('startseite-2026-09.html'));

test('liest alle kommenden Veranstaltungen der Startseite', () => {
  const { events, skipped, empty } = startseite();
  assert.equal(events.length, 57);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(events[0].start, '2026-10-01T20:00:00+02:00');
  assert.equal(events.at(-1)!.start, '2027-07-01T20:00:00+02:00');
});

test('normalisiert ein Konzert vollständig', () => {
  const konzert = startseite().events.find((e) => e.id === 'wilhelm13:1243');
  assert.ok(konzert);
  assert.equal(konzert.title, 'Project Smok & Ainsley Hamill (Scottland)');
  assert.equal(konzert.start, '2026-10-05T20:00:00+02:00');
  assert.equal(konzert.allDay, false);
  assert.deepEqual(konzert.venue, { name: 'Wilhelm13' });
  assert.equal(konzert.category, undefined, 'Musik fällt auf die Voreinstellung der Quelle');
  assert.equal(konzert.availability, 'available');
  assert.equal(konzert.availabilityLabel, undefined, '„Reservieren“ ist eine Handlung, kein Zustand');
  assert.equal(konzert.ticketUrl, 'https://wilhelm13.de/reservieren.php?eventid=1243');
  assert.equal(konzert.url, 'https://wilhelm13.de/?preview_event=1243');
  assert.deepEqual(konzert.notes, ['Vorverkauf 30 EUR, ermäßigt 23 EUR', 'Abendkasse 33 EUR, ermäßigt 26 EUR']);
  // Kurz- und Langtext, als Absätze.
  assert.match(konzert.description!, /^Ainsley Hamill\/Gesang/);
  assert.match(konzert.description!, /\n\nAinsley Hamill, eine der herausragendsten Stimmen/);
});

test('Lesungen des Literaturhauses sind Literatur, mit fremdem Vorverkauf', () => {
  const { events } = startseite();
  const lesungen = events.filter((e) => e.category === 'Literatur');
  assert.equal(lesungen.length, 9);
  assert.ok(lesungen.every((e) => e.ticketUrl?.startsWith('https://www.oldenburg.de/')));

  const fremd = events.find((e) => e.id === 'wilhelm13:1138');
  assert.equal(fremd!.ticketUrl, 'https://ticket2go.de/tickets-kaufen/wolfgang-lackerschmid-quartet-oldenburg-31-10-2026-5558');
});

test('freier Eintritt steht als Hinweis, nicht als Preis', () => {
  const jam = startseite().events.find((e) => e.id === 'wilhelm13:1199');
  assert.deepEqual(jam!.notes, ['Eintritt frei']);
});

test('vergibt eindeutige IDs und kennt jede Uhrzeit', () => {
  const { events } = startseite();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.ok(events.every((e) => !e.allDay && e.availability === 'available'));
});

test('ein leeres Raster ist leer, eine fremde Seite nicht erkannt', () => {
  assert.deepEqual(parseEvents('<div class="grid events-grid"></div>'), { events: [], skipped: 0, empty: true });
  assert.deepEqual(parseEvents(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseEvents('<html><body>Wartung</body></html>'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(
    parseEvents('<div class="events-grid"><article class="event-card"><h3 class="event-title">x</h3></article></div>'),
    { events: [], skipped: 1, empty: true },
  );
});

test('ohne JSON liest der Parser das Markup', () => {
  const { events } = parseEvents(`<div class="events-grid">
    <article class="event-card" data-event-id="7">
      <div class="event-meta-line">03.12.2026 - 19:30 Uhr</div>
      <h3 class="event-title">Test</h3>
      <div class="card-actions"><a href="https://wilhelm13.de/reservieren.php?eventid=7">Reservieren</a></div>
    </article></div>`);
  assert.equal(events[0].start, '2026-12-03T19:30:00+01:00');
  assert.equal(events[0].ticketUrl, 'https://wilhelm13.de/reservieren.php?eventid=7');
});
