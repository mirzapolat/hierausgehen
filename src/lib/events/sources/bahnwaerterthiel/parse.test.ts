import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Die Fixture wurde am 3.9.2026 geholt: Archiv ab August, Vorschau bis Oktober. */
const programme = () => parseProgrammePage(fixture('programm-2026-09.html'));

test('liest das ganze angekündigte Programm aus einer Antwort', () => {
  const { events, skipped } = programme();
  assert.equal(events.length, 34);
  assert.equal(skipped, 0);

  const perMonth: Record<string, number> = {};
  for (const event of events) {
    const month = event.start.slice(0, 7);
    perMonth[month] = (perMonth[month] ?? 0) + 1;
  }
  // 14 im Archiv, 19 im laufenden Monat, 1 bereits angekündigter Oktobertermin.
  assert.deepEqual(perMonth, { '2026-08': 14, '2026-09': 19, '2026-10': 1 });
});

test('nimmt die Monatsabschnitte nicht für Termine', () => {
  // "Archiv", "September" und "Oktober" tragen dieselbe Klasse wie die
  // Termine; ohne Datum in der Beschriftung zählen sie nicht.
  const { events } = programme();
  assert.equal(events.filter((e) => /^(Archiv|September|Oktober)$/.test(e.title)).length, 0);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
});

test('normalisiert einen Termin vollständig', () => {
  const { events } = programme();
  const event = events.find((e) => e.id === 'bahnwaerterthiel:2026-09-05-vegan-beats');
  assert.ok(event, 'Vegan Beats am 5.9. gefunden');
  assert.equal(event.sourceId, 'bahnwaerterthiel');
  assert.equal(event.title, 'Vegan Beats');
  assert.equal(event.subtitle, undefined);
  assert.equal(event.start, '2026-09-05T16:00:00+02:00');
  assert.equal(event.end, '2026-09-05T22:00:00+02:00');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Bahnwärter Thiel');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.category, undefined, 'die Seite nennt keine Gattung');
  assert.equal(event.availability, 'available');
  assert.equal(event.ticketUrl, 'https://billetto.eu/e/vegan-beats-Tickets-1933814');
  assert.equal(event.url, 'https://www.bahnwaerterthiel.de/');
  assert.deepEqual(event.notes, ['ab 16 € Vorverkauf, 25€ Kasse']);
  assert.ok(event.description?.startsWith('Animals United Begrüßungsgrede'));
});

test('nimmt Line-up und Ankündigungstext als Programmtext', () => {
  const { events } = programme();
  const slam = events.find((e) => e.id === 'bahnwaerterthiel:2026-09-02-bahnwoerter-poetry-slam');
  assert.ok(slam);
  // Ohne Line-up bleibt der Ankündigungstext für sich.
  assert.ok(slam.description?.startsWith('Hier ist DER Clubslam Münchens!'));

  const club = events.find((e) => e.id === 'bahnwaerterthiel:2026-09-03-135-mit-uhrwerk-der-nacht-808-kollektive');
  assert.ok(club);
  // Mit Line-up steht es zeilenweise vorn.
  assert.ok(club.description?.startsWith('Aerobic [8:08AM / München]\nChezzta'));
});

test('liest Einlass, Spielzeit und die Nacht über Mitternacht', () => {
  const { events } = programme();
  const comedy = events.find((e) => e.id.endsWith('2026-09-24-powerpoint-karaoke'));
  assert.ok(comedy);
  // "Einlass: 19:00 / 19:30-21:30 Uhr" – der Einlass ist nicht der Beginn.
  assert.equal(comedy.start, '2026-09-24T19:30:00+02:00');
  assert.equal(comedy.end, '2026-09-24T21:30:00+02:00');
  assert.ok(comedy.notes?.includes('Einlass: 19:00'));

  const night = events.find((e) => e.id.endsWith('2026-09-25-isarbass-eulentreff'));
  assert.ok(night);
  // "22-6 Uhr" endet am Folgetag.
  assert.equal(night.start, '2026-09-25T22:00:00+02:00');
  assert.equal(night.end, '2026-09-26T06:00:00+02:00');
});

test('leitet die Ticketlage aus dem Vorverkaufslink ab', () => {
  const { events } = programme();
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.availability] = (counts[event.availability] ?? 0) + 1;
  // Kein Link in der Preiszeile heisst: Verkauf nur an der Abendkasse.
  assert.deepEqual(counts, { available: 20, not_on_sale: 14 });
  assert.equal(events.filter((e) => e.ticketUrl).length, 20);
  // Der Vorverkauf läuft mal über das Haus, mal über einen fremden Shop.
  assert.ok(events.some((e) => e.ticketUrl === 'https://www.bahnwaerterthiel.de/tickets/'));
  assert.ok(events.some((e) => e.ticketUrl?.startsWith('https://de.ra.co/')));
});

test('kommt mit leerer und kaputter Antwort klar', () => {
  assert.deepEqual(parseProgrammePage(''), { events: [], skipped: 0 });
  assert.deepEqual(parseProgrammePage('<html><body><div class="bmt-wrap">'), {
    events: [],
    skipped: 0,
  });
});
