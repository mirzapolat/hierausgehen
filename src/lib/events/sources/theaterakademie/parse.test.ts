import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const programme = () => parseProgrammePage(fixture('programm-2026-09-2027-06.html'));

test('liest jeden Termin der Spielzeit genau einmal', () => {
  const { events, skipped, empty } = programme();

  // Jeder Termin steht dreimal im Markup (small/middle/large).
  assert.equal(events.length, 236);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test('normalisiert eine Premiere vollstaendig', () => {
  const { events } = programme();
  const trionfo = events.find((event) => event.id === 'theaterakademie:2820-117132');

  assert.ok(trionfo, 'Premiere von "Il trionfo" gefunden');
  assert.equal(trionfo.title, 'Il trionfo. Inventar eines Lebens');
  assert.equal(trionfo.subtitle, 'Musiktheater von Georg Friedrich Händel');
  assert.equal(trionfo.start, '2026-11-02T19:30:00+01:00');
  assert.equal(trionfo.allDay, false);
  assert.equal(trionfo.venue.name, 'Akademietheater');
  assert.equal(trionfo.venue.city, undefined);
  assert.equal(trionfo.availability, 'available');
  assert.equal(
    trionfo.ticketUrl,
    'https://tickets.staatstheater.bayern/pth.webshop/webticket/shop?event=43133',
  );
  assert.equal(
    trionfo.url,
    'https://theaterakademie.de/de/theater/programm/il-trionfo-inventar-eines-lebens',
  );
  assert.deepEqual(trionfo.notes, ['Premiere', '19:00 Uhr Werkeinführung', 'Vorverkauf ab 02.10.26']);
});

test('trennt Spielstaette und Saal an den Zeilenumbruechen', () => {
  const { events } = programme();
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.venue.name] = (acc[event.venue.name] ?? 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, {
    'Prinzregententheater – Großes Haus': 189,
    'Prinzregententheater – Gartensaal': 17,
    'Prinzregententheater – Führung': 4,
    Akademietheater: 26,
  });
});

test('bildet die Ticketlage aus Knopf und Hinweiszeile ab', () => {
  const { events } = programme();
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.availability] = (acc[event.availability] ?? 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, { available: 185, not_on_sale: 18, unknown: 33 });

  const nochNicht = events.find((event) => event.id === 'theaterakademie:2820-117134');
  assert.equal(nochNicht?.availability, 'not_on_sale');
  assert.equal(nochNicht?.availabilityLabel, 'Vorverkauf ab 02.10.26');
  assert.equal(nochNicht?.ticketUrl, undefined);

  const ohneAngabe = events.find((event) => event.id === 'theaterakademie:2770-129481');
  assert.equal(ohneAngabe?.availability, 'unknown');
  assert.equal(ohneAngabe?.ticketUrl, undefined);
});

test('haelt Untertitel und Hinweise getrennt', () => {
  const { events } = programme();
  const wettbewerb = events.find((event) => event.id === 'theaterakademie:2036-79457');

  assert.ok(wettbewerb);
  assert.equal(wettbewerb.subtitle, 'Bayerischer Rundfunk Internationaler Musikwettbewerb der ARD');
  assert.deepEqual(wettbewerb.notes, [
    'Vorverkauf ab 04.08.26, 09:00 Uhr',
    'Semifinale Fagott mit dem Münchener Kammerorchester',
  ]);

  const musicaViva = events.find((event) => event.id === 'theaterakademie:2770-129481');
  assert.equal(musicaViva?.subtitle, 'Gesang, Tanz und Instrumentalmusik · Bayerischer Rundfunk musica viva');
  assert.equal(musicaViva?.notes, undefined);
});

test('traegt die Spielzeit ueber den Jahreswechsel', () => {
  const { events } = programme();
  const days = events.map((event) => event.start).sort();

  assert.equal(days[0], '2026-09-08T16:00:00+02:00');
  assert.equal(days.at(-1), '2027-06-12T15:00:00+02:00');
  assert.equal(
    events.find((event) => event.id === 'theaterakademie:1981-74128')?.start,
    '2027-06-12T15:00:00+02:00',
  );
});

test('liefert gueltige Pflichtfelder', () => {
  const { events } = programme();

  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gueltiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.venue.name.length > 0);
    assert.ok(event.url.startsWith('https://theaterakademie.de/de/theater/programm/'));
    assert.equal(event.allDay, false);
  }
});

test('merkt sich, welche Produktionen eine eigene Seite mit Text haben', () => {
  const { events, described } = programme();

  // Nur Produktionen des Hauses sind in der Liste verlinkt; Gastspielseiten
  // tragen ausser Titel und Terminen nichts.
  assert.equal(described.length, 7);
  assert.ok(
    described.includes('https://theaterakademie.de/de/theater/programm/il-trionfo-inventar-eines-lebens'),
  );
  assert.ok(
    !described.includes('https://theaterakademie.de/de/theater/programm/kanze-no-theater-ensemble-tokio'),
  );
  assert.ok(described.every((url) => events.some((event) => event.url === url)));
});

test('liest den langen Programmtext der Produktionsseite', () => {
  const description = parseDetailDescription(fixture('detail-natascha-pierre.html'));

  assert.match(description!, /^Haben Sie schon einmal einen Kometen/);
  assert.match(description!, /deutsche Erstaufführung/);
  assert.ok(!description!.includes('Musikalische Leitung'), 'ohne Besetzungsliste');
});

test('nimmt bei Zusatzseiten den ersten Textblock, nicht die Ticket-Hinweise', () => {
  const description = parseDetailDescription(fixture('detail-fuehrung-prinzregententheater.html'));

  assert.match(description!, /^Führungen durch das Prinzregententheater/);
  assert.ok(!description!.includes('Tageskasse'), 'ohne Ticket-Hinweise');
});

test('meldet eine Seite ohne Spielplanliste als nicht erkannt', () => {
  // Die Spielzeitseite ist kein Kalender: dann muss der Adapter werfen,
  // statt "keine Termine" zu melden.
  assert.deepEqual(parseProgrammePage(fixture('spielzeit-2025-2026-ohne-kalender.html')), {
    events: [],
    skipped: 0,
    empty: false,
    described: [],
  });
});

test('erkennt eine leere, aber gerenderte Liste', () => {
  assert.deepEqual(parseProgrammePage('<ul id="calendar"></ul>'), {
    events: [],
    skipped: 0,
    empty: true,
    described: [],
  });
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  assert.deepEqual(parseProgrammePage(''), { events: [], skipped: 0, empty: false, described: [] });
  assert.deepEqual(parseProgrammePage('<ul id="calendar"><li class="datarecord"></li>'), {
    events: [],
    skipped: 1,
    empty: true,
    described: [],
  });
  assert.equal(parseDetailDescription(''), undefined);
});
