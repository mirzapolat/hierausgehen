import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseProgramme } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const programm = () => parseProgramme(fixture('programm.html'));

test('liest das gesamte veröffentlichte Programm', () => {
  const { events, skipped, empty } = programm();
  assert.equal(events.length, 78);
  assert.equal(skipped, 0);
  assert.equal(empty, false);

  // Die Seite reicht über die Saison, nicht über einen Monat.
  const monate = [...new Set(events.map((e) => e.start.slice(0, 7)))].sort();
  assert.deepEqual(monate, [
    '2026-09', '2026-10', '2026-11', '2026-12',
    '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
  ]);
});

test('normalisiert eine Lesung vollständig', () => {
  const lesung = programm().events.find((e) => e.id === 'literaturhaus:alleinruhelage-2026-09-15');
  assert.ok(lesung, 'Eva Menasse am 15.9. gefunden');
  assert.equal(lesung.sourceId, 'literaturhaus');
  assert.equal(lesung.title, 'Alleinruhelage');
  assert.equal(lesung.subtitle, 'Lesung mit Eva Menasse');
  assert.equal(lesung.description, undefined, 'die Liste führt keinen Programmtext');
  assert.equal(lesung.start, '2026-09-15T19:00:00+02:00');
  assert.equal(lesung.end, undefined, 'die Liste kennt keine Endzeit');
  assert.equal(lesung.allDay, false);
  // "Saal & Stream<br>Foyer-Bar ab 18 Uhr": der Hinweis ist keine Spielstätte.
  assert.deepEqual(lesung.venue, { name: 'Saal & Stream' });
  assert.deepEqual(lesung.notes, ['Foyer-Bar ab 18 Uhr']);
  assert.equal(lesung.availability, 'unknown');
  assert.equal(lesung.ticketUrl, undefined, 'der Kartenlink steht erst auf der Detailseite');
  assert.equal(lesung.url, 'https://www.literaturhaus-muenchen.de/veranstaltung/alleinruhelage/');
});

test('erkennt Ausverkauftes am eigenen Zeichen der Liste', () => {
  const { events } = programm();
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  // Mehr sagt die Liste über Karten nicht – erfunden wird hier nichts.
  assert.deepEqual(counts, { unknown: 77, soldout: 1 });

  const ausverkauft = events.find((e) => e.availability === 'soldout');
  assert.equal(ausverkauft!.id, 'literaturhaus:dran-bleiben-2026-10-17');
  assert.equal(ausverkauft!.availabilityLabel, 'Tickets ausverkauft');
});

test('hält Reihe und Ausstellung als Hinweise fest', () => {
  const imaginarium = programm().events.find((e) => e.id === 'literaturhaus:imaginarium-2026-10-03');
  assert.ok(imaginarium);
  assert.deepEqual(imaginarium.notes, ['CZECHIA 2026', 'IMAGINARIUM']);
  assert.equal(imaginarium.title, 'Imaginarium', 'die Reihe ist nicht der Titel');
});

test('erfindet für auswärtige Spielstätten keine Stadt', () => {
  const { events } = programm();
  assert.equal(events.filter((e) => e.venue.city).length, 0);
  const gastspiel = events.find((e) => e.venue.name === 'Münchner Kammerspiele');
  assert.ok(gastspiel, 'Literatur(ausser)haus in den Kammerspielen gefunden');
  assert.equal(gastspiel.venue.city, undefined);
});

test('vergibt eindeutige IDs und gültige Pflichtfelder', () => {
  const { events } = programm();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gültiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.venue.name.length > 0);
    assert.ok(event.url.startsWith('https://www.literaturhaus-muenchen.de/veranstaltung/'));
    assert.equal(event.allDay, false, 'jeder Termin nennt eine Uhrzeit');
  }
});

test('nimmt die Uhrzeit des Termins, nicht die aus dem Hinweis', () => {
  const fragment = (datum: string) =>
    parseProgramme(`<div class="termine-container"><div class="termin-container">
      <div class="event-datum">${datum}</div>
      <div class="item-title-container"><a href="/veranstaltung/x/">
        <div class="item-title">Test</div></a></div>
    </div></div>`).events[0];

  // Die Bar-Zeile darf den Beginn nicht überschreiben.
  const abend = fragment(
    `<span class="tag">Mi 4.3.27</span> <span class="sep">//</span> 20 Uhr
     <span class="sep">//</span> <span class="zeitraum">Saal<br>Bar ab 19.30 Uhr</span>`,
  );
  assert.equal(abend.start, '2027-03-04T20:00:00+01:00');
  assert.equal(abend.venue.name, 'Saal');
  assert.deepEqual(abend.notes, ['Bar ab 19.30 Uhr']);

  assert.equal(
    fragment('<span class="tag">Sa 1.8.26</span> // 19.30 Uhr').start,
    '2026-08-01T19:30:00+02:00',
  );

  // Ohne Uhrzeit bleibt der Termin ganztägig, statt eine zu erfinden.
  const ohneZeit = fragment('<span class="tag">Sa 1.8.26</span>');
  assert.equal(ohneZeit.allDay, true);
  assert.equal(ohneZeit.start, '2026-08-01T00:00:00+02:00');
});

test('liest den Programmtext von der Veranstaltungsseite', () => {
  const text = parseDetailDescription(fixture('detail-alleinruhelage.html'));
  assert.match(text!, /^Nach dem Ende einer Ehe bleibt ein Haus/);
  assert.match(text!, /Kiepenheuer & Witsch/);
  // Keine Navigations-, Fuss- oder Bildunterschriftentexte.
  assert.ok(!text!.includes('Zum Inhalt springen'));
  assert.ok(!text!.includes('Newsletter'));

  const mehrteilig = parseDetailDescription(fixture('detail-musik-im-cafe.html'));
  assert.match(mehrteilig!, /Internationale Musikwettbewerb der ARD/);
  assert.ok(mehrteilig!.includes('\n\n'), 'mehrere Absätze bleiben getrennt');
});

test('erkennt eine gerenderte, aber leere Liste und meldet sie nicht als Fehler', () => {
  assert.deepEqual(parseProgramme('<div class="termine-container"></div>'), {
    events: [],
    skipped: 0,
    empty: true,
  });
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  // Ohne Container ist "empty" bewusst false – das ist ein Layoutfehler.
  const kaputt = { events: [], skipped: 0, empty: false };
  assert.deepEqual(parseProgramme(''), kaputt);
  assert.deepEqual(parseProgramme('<html><body>Wartungsseite</body></html>'), kaputt);
  assert.deepEqual(
    parseProgramme('<div class="termine-container"><div class="termin-container"></div></div>'),
    { events: [], skipped: 1, empty: true },
  );
  assert.equal(parseDetailDescription('<html></html>'), undefined);
});
