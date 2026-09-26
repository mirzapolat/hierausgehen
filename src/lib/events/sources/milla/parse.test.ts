import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Die Fixture wurde am 1.9.2026 geholt – das ist der Bezugstag fürs Jahr. */
const programme = (today = '2026-09-01') =>
  parseProgrammePage(fixture('programm-2026-09.html'), today);

test('liest das ganze angekündigte Programm aus einer Antwort', () => {
  const { events, skipped } = programme();
  assert.equal(events.length, 121);
  assert.equal(skipped, 0);
  assert.equal(events[0].start.slice(0, 10), '2026-09-01');
  assert.equal(events[events.length - 1].start.slice(0, 10), '2027-05-22');

  const perMonth: Record<string, number> = {};
  for (const event of events) {
    const month = event.start.slice(0, 7);
    perMonth[month] = (perMonth[month] ?? 0) + 1;
  }
  assert.deepEqual(perMonth, {
    '2026-09': 28, '2026-10': 29, '2026-11': 22, '2026-12': 14,
    '2027-01': 4, '2027-02': 9, '2027-03': 7, '2027-04': 6, '2027-05': 2,
  });
});

test('lässt den Kopf-Slider aussen vor', () => {
  // Die fünf `featured-event`-Blöcke wiederholen die nächsten Termine.
  // Wer sie mitzählt, bekommt jeden davon doppelt.
  const { events } = programme();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(new Set(events.map((e) => e.url)).size, events.length);
});

test('normalisiert einen Termin vollständig', () => {
  const { events } = programme();
  const event = events.find((e) => e.id === 'milla:horsegirl-presented-by-corechaosconcerts');
  assert.ok(event, 'Horsegirl am 1.9. gefunden');
  assert.equal(event.sourceId, 'milla');
  assert.equal(event.title, 'Horsegirl + Byinoar – präsentiert von CoreChaosConcerts');
  assert.equal(event.subtitle, undefined);
  assert.equal(event.description, undefined, 'die Liste führt keinen Programmtext');
  assert.equal(event.start, '2026-09-01T19:00:00+02:00');
  assert.equal(event.end, undefined, 'die Quelle nennt keine Endzeit');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Milla');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.availability, 'available');
  assert.equal(
    event.ticketUrl,
    'https://rausgegangen.de/events/horsegirl-tba-presented-by-corechaosconcerts-0/',
  );
  assert.equal(event.url, 'https://milla-club.de/horsegirl-presented-by-corechaosconcerts/');
  assert.equal(event.notes, undefined);
});

test('setzt das fehlende Jahr über die Sortierung der Liste', () => {
  // Die Seite nennt nur "Sep 01". Der Rücksprung Dez → Jan ist der einzige
  // Hinweis auf den Jahreswechsel – genau einer in dieser Fixture.
  const { events } = programme();
  assert.ok(
    events.every((event, i) => i === 0 || events[i - 1].start <= event.start),
    'aufsteigend sortiert',
  );
  const dezember = events.filter((e) => e.start.startsWith('2026-12'));
  const januar = events.filter((e) => e.start.startsWith('2027-01'));
  assert.ok(dezember.length > 0 && januar.length > 0);

  // Derselbe Abruf einen Monat später verschiebt nichts.
  assert.deepEqual(
    programme('2026-09-28').events.map((e) => e.start),
    events.map((e) => e.start),
  );
});

test('erkennt Ausverkauftes am Bild, nicht am Knopf', () => {
  const { events } = programme();
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.availability] = (counts[event.availability] ?? 0) + 1;
  assert.deepEqual(counts, { available: 110, soldout: 4, unknown: 7 });

  const soldout = events.find((e) => e.id === 'milla:fruchtiger-beigeschmack-zusatzshow');
  assert.ok(soldout);
  assert.equal(soldout.availability, 'soldout');
  assert.equal(soldout.availabilityLabel, 'Sold out');
  // Der Knopf heisst auch hier "Tickets" – der Link wäre irreführend.
  assert.equal(soldout.ticketUrl, undefined);

  // Ohne Vorverkauf (Jam Sessions, Partys) macht die Quelle keine Angabe.
  const jam = events.find((e) => e.id === 'milla:jazz-jam-28');
  assert.equal(jam?.availability, 'unknown');
  assert.equal(jam?.ticketUrl, undefined);
});

test('liest den Programmtext der Detailseite', () => {
  const description = parseDetailDescription(fixture('detail-annie-taylor-2026-09.html'));
  assert.ok(description);
  // Die erste Zeile ist die Gattung – die einzige Stelle, an der die Quelle
  // sagt, um was für einen Abend es geht.
  assert.match(description, /^KONZERT\n\n/);
  assert.match(description, /Out of Scale/);
  assert.match(description, /Support: Deer Park Avenue/);
});

test('meldet nichts statt zu raten, wenn die Antwort unbrauchbar ist', () => {
  assert.deepEqual(parseProgrammePage('', '2026-09-01'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseProgrammePage('<html><body><p>Wartung</p>', '2026-09-01'), {
    events: [],
    skipped: 0,
    empty: false,
  });
  assert.equal(parseDetailDescription(''), undefined);
  // Ein einzelnes Gattungswort ist noch kein Programmtext.
  assert.equal(parseDetailDescription('<article><div class="content"><p>KONZERT</p></div></article>'), undefined);
});

test('hält die Spielpause von einem geänderten Aufbau auseinander', () => {
  assert.deepEqual(parseProgrammePage('<main><section class="events"></section></main>', '2026-09-01'), {
    events: [],
    skipped: 0,
    empty: true,
  });
});
