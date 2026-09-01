import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProgrammeStart, parseProjections } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const starts = () => parseProgrammeStart(fixture('wichtiges.json'));
const kommend = () => parseProjections(fixture('projections-aktuell.json'), starts());
const saison = () => parseProjections(fixture('projections-saison-2026.json'), starts());

test('liest die kommenden Vorstellungen', () => {
  const { events, skipped, empty } = kommend();
  assert.equal(events.length, 12);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  // Ohne Jahresangabe gibt die Schnittstelle nur, was noch aussteht.
  for (const event of events) assert.ok(event.start.startsWith('2026-09'), event.start);
});

test('liest eine ganze Saison über die Monatsgruppen hinweg', () => {
  const { events, skipped } = saison();
  assert.equal(events.length, 105);
  assert.equal(skipped, 0);

  const proMonat = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.start.slice(0, 7)] = (acc[e.start.slice(0, 7)] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(proMonat, { '2026-06': 27, '2026-07': 33, '2026-08': 33, '2026-09': 12 });
});

test('normalisiert eine Vorstellung vollständig', () => {
  const film = kommend().events.find((e) => e.id === 'kinomondsterne:the-invite-omu-2026-09-06');
  assert.ok(film, 'The Invite am 6.9. gefunden');
  assert.equal(film.sourceId, 'kinomondsterne');
  assert.equal(film.title, 'The Invite (OmU)');
  assert.equal(film.subtitle, undefined);
  assert.match(film.description!, /^Filmfest München präsentiert/);
  assert.equal(film.category, undefined, 'die Quelle führt keine Gattung');
  assert.equal(film.start, '2026-09-06T20:15:00+02:00');
  assert.equal(film.end, undefined);
  assert.equal(film.allDay, false);
  assert.deepEqual(film.venue, { name: 'Seebühne im Westpark' });
  assert.equal(film.availability, 'available');
  assert.equal(film.ticketUrl, 'https://kms.mobi/index.php?standard');
  assert.equal(film.url, 'https://www.kino-mond-sterne.de/movie/the-invite-omu/06/09/2026');
  assert.deepEqual(film.notes, ['Originalversion', '107 Min.']);
});

test('bildet die Ticketlage aus dem Verkaufskennzeichen ab', () => {
  const counts = saison().events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  // `afp` fällt weg, sobald der Abend vorbei ist – daher die 93 aus Juni bis
  // August. Dass sie vergangen sind, leitet die Anzeige selbst ab.
  assert.deepEqual(counts, { not_on_sale: 93, available: 12 });

  const ohneVerkauf = saison().events.find((e) => e.availability === 'not_on_sale');
  assert.equal(ohneVerkauf!.ticketUrl, undefined, 'kein Kartenlink ohne Verkauf');
  assert.equal(kommend().events.every((e) => e.ticketUrl), true);
});

test('vergibt eindeutige IDs, obwohl ein Film mehrere Abende läuft', () => {
  const { events } = saison();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);

  const mehrfach = events.filter((e) => e.title === 'Steckerlfischfiasko');
  assert.ok(mehrfach.length > 1, 'Steckerlfischfiasko läuft mehrmals');
  assert.equal(new Set(mehrfach.map((e) => e.url)).size, mehrfach.length, 'je Abend eine Adresse');

  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gültiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.url.startsWith('https://www.kino-mond-sterne.de/movie/'));
  }
});

test('liest die Anfangszeiten je Monat aus dem FAQ', () => {
  const zeiten = starts();
  assert.deepEqual(
    [...zeiten.entries()].sort((a, b) => a[0] - b[0]),
    [
      [6, { hour: 21, minute: 30 }],
      [7, { hour: 21, minute: 15 }],
      [8, { hour: 21, minute: 0 }],
      [9, { hour: 20, minute: 15 }],
    ],
  );

  // Die Einlass- und Abendkassenzeiten aus derselben Antwort dürfen nicht
  // durchschlagen – im September ist das 19.00 statt 20.15 Uhr.
  assert.equal(zeiten.get(9)?.hour, 20);

  // "Im Juni & Juli 20.00 Uhr": eine Zeit für mehrere Monate.
  const geteilt = parseProgrammeStart(
    JSON.stringify({ faq: [{ answer: '<p><strong>Programmstart:</strong> Im Juni & Juli 20.00 Uhr</p>' }] }),
  );
  assert.deepEqual(geteilt.get(6), { hour: 20, minute: 0 });
  assert.deepEqual(geteilt.get(7), { hour: 20, minute: 0 });
});

test('lässt Termine ganztägig, wenn die Quelle keine Anfangszeit nennt', () => {
  const { events } = parseProjections(fixture('projections-aktuell.json'), new Map());
  assert.equal(events.length, 12);
  for (const event of events) {
    assert.equal(event.allDay, true, `${event.id} ohne erfundene Uhrzeit`);
    assert.ok(event.start.endsWith('T00:00:00+02:00'));
  }
});

test('erkennt eine leere Antwort und meldet sie nicht als Fehler', () => {
  // Ausserhalb der Spielzeit steht nichts mehr an.
  assert.deepEqual(parseProjections('{"data":[],"meta":{}}', starts()), {
    events: [],
    skipped: 0,
    empty: true,
  });
  assert.deepEqual(parseProjections('{"data":[{"month":"Mai","items":[]}]}', starts()), {
    events: [],
    skipped: 0,
    empty: true,
  });
});

test('leere oder kaputte Antworten werfen nicht', () => {
  // Kein "empty": ohne `data`-Liste ist das ein Formatwechsel.
  const kaputt = { events: [], skipped: 0, empty: false };
  assert.deepEqual(parseProjections('', starts()), kaputt);
  assert.deepEqual(parseProjections('<html>Wartung</html>', starts()), kaputt);
  assert.deepEqual(parseProjections('{"meta":{}}', starts()), kaputt);

  // Vorstellungen ohne Datum oder Titel werden gezählt, nicht verschluckt.
  assert.deepEqual(
    parseProjections('{"data":[{"items":[{"movie":{"t":"Ohne Datum","s":"x"}}]}]}', starts()),
    { events: [], skipped: 1, empty: false },
  );

  assert.deepEqual(parseProgrammeStart('kein json'), new Map());
  assert.deepEqual(parseProgrammeStart('{"faq":[{"answer":"<p>Nichts dazu</p>"}]}'), new Map());
});
