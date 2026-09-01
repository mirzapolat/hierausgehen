import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyPostDetails,
  parseCategoryNames,
  parseMonthFragment,
  parseMonthResponse,
  parsePostDetails,
} from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const september = () => parseMonthResponse(fixture('monat-2026-09.json'), '2026-09');
const juni = () => parseMonthResponse(fixture('monat-2026-06.json'), '2026-06');

const details = () =>
  parsePostDetails(fixture('beitraege-2026-09.json'), parseCategoryNames(fixture('kategorien.json')));

const angereichert = () => applyPostDetails(september().events, details());

test('liest alle Termine des Monats', () => {
  const { events, skipped, empty, reported } = september();
  assert.equal(events.length, 15);
  assert.equal(reported, 15, 'so viele meldet der Umschlag selbst');
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  for (const event of events) assert.ok(event.start.startsWith('2026-09'), event.start);
});

test('normalisiert einen Termin vollständig', () => {
  const slam = angereichert().find((e) => e.id === 'lostweekend:2802-2026-09-15-1900');
  assert.ok(slam, 'Lost Poets am 15.9. gefunden');
  assert.equal(slam.sourceId, 'lostweekend');
  assert.equal(slam.title, 'Lost Poets: An Open Poetry Slam');
  assert.equal(slam.subtitle, undefined);
  assert.equal(slam.category, 'Poetry & Readings');
  assert.equal(slam.start, '2026-09-15T19:00:00+02:00');
  assert.equal(slam.end, undefined, 'die Liste kennt keine Endzeit');
  assert.equal(slam.allDay, false);
  assert.deepEqual(slam.venue, { name: 'Lost Weekend' });
  assert.equal(slam.availability, 'unknown');
  assert.equal(slam.ticketUrl, undefined, 'kein Kartenlink in der Liste');
  assert.equal(
    slam.url,
    'https://lostweekend.de/events/lost-poets-an-open-poetry-slam-2-443-773-693-724-981-330/',
  );
  assert.match(slam.description!, /Experience the Power of Poetry/);
});

test('unterscheidet zwei Vorstellungen desselben Abends', () => {
  const kiwi = september().events.filter((e) => e.title.startsWith('Kiwi Comedy'));
  assert.equal(kiwi.length, 2, 'derselbe Beitrag, zwei Uhrzeiten am 6.9.');
  assert.deepEqual(
    kiwi.map((e) => e.start),
    ['2026-09-06T18:00:00+02:00', '2026-09-06T20:00:00+02:00'],
  );
  assert.deepEqual(kiwi.map((e) => e.id), [
    'lostweekend:2873-2026-09-06-1800',
    'lostweekend:2873-2026-09-06-2000',
  ]);
});

test('vergibt eindeutige IDs und gültige Zeitstempel', () => {
  const { events } = september();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gültiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.url.startsWith('https://lostweekend.de/'));
    assert.equal(event.availability, 'unknown', 'die Quelle sagt nichts über Karten');
  }
});

test('nennt die Reihe wiederkehrender Termine unter einer Post-ID', () => {
  const { events, postIds } = september();
  const openStage = events.filter((e) => e.title === 'Open Stage');
  assert.equal(openStage.length, 4);
  assert.ok(openStage.every((e) => e.id.startsWith('lostweekend:2713-')));
  assert.equal(postIds.length, 9, '15 Termine verteilen sich auf 9 Beiträge');
  assert.deepEqual([...postIds].sort((a, b) => a - b), [
    2713, 2716, 2802, 2826, 2873, 2922, 2928, 2954, 2968,
  ]);
});

test('übernimmt eine abweichende Spielstätte, statt sie zu vereinheitlichen', () => {
  const orte = new Set(juni().events.map((e) => e.venue.name));
  assert.deepEqual([...orte].sort(), ['Live Evil', 'Lost Weekend']);
  const lipsync = juni().events.find((e) => e.venue.name === 'Live Evil');
  assert.equal(lipsync!.venue.city, undefined, 'die Quelle bedient nur München');
});

test('rechnet 12-Stunden-Zeiten korrekt um', () => {
  const rave = september().events.find((e) => e.id.startsWith('lostweekend:2954-'));
  assert.equal(rave!.start, '2026-09-12T12:00:00+02:00', '"12:00 pm" ist Mittag');

  const fragment = (label: string) =>
    parseMonthFragment(
      `<div class="mec-event-list-standard"><article class="mec-event-article">
         <h3 class="mec-event-title"><a data-event-id="1" href="/events/x/">Test</a></h3>
         <span class="mec-start-date-label">05 Mar</span>
         <span class="mec-start-time">${label}</span>
       </article></div>`,
      '2026-03',
    ).events[0];

  assert.equal(fragment('12:00 am').start, '2026-03-05T00:00:00+01:00');
  assert.equal(fragment('9:30 pm').start, '2026-03-05T21:30:00+01:00');
  // Ohne lesbare Uhrzeit bleibt der Termin ganztägig, statt eine zu erfinden.
  const ohneZeit = fragment('');
  assert.equal(ohneZeit.allDay, true);
  assert.equal(ohneZeit.start, '2026-03-05T00:00:00+01:00');
});

test('leitet das Jahr aus dem angefragten Monat ab', () => {
  const html = `<div class="mec-event-list-standard"><article class="mec-event-article">
      <h3 class="mec-event-title"><a data-event-id="7" href="/events/y/">Silvester</a></h3>
      <span class="mec-start-date-label">02 Jan</span>
      <span class="mec-start-time">8:00 pm</span>
    </article></div>`;
  assert.equal(parseMonthFragment(html, '2026-12').events[0].start, '2027-01-02T20:00:00+01:00');
  assert.equal(parseMonthFragment(html, '2027-01').events[0].start, '2027-01-02T20:00:00+01:00');
});

test('ergänzt Gattung und langen Programmtext aus der REST-Schnittstelle', () => {
  const kurz = september().events.find((e) => e.id.startsWith('lostweekend:2713-'))!;
  const lang = angereichert().find((e) => e.id === kurz.id)!;

  assert.match(kurz.description!, /\[…\]$/, 'die Liste kürzt den Text');
  assert.ok(lang.description!.length > kurz.description!.length);
  assert.match(lang.description!, /Maximum 2 slots per night/);
  assert.equal(lang.category, 'Live Music');
});

test('wählt aus mehreren Gattungen eine aus und überspringt den Sammeleimer', () => {
  // Beitrag 2826 trägt "Dance", "Other" und "Party".
  const namen = parseCategoryNames(fixture('kategorien.json'));
  assert.equal(namen.get(52), 'Dance');
  assert.equal(namen.get(19), 'Poetry & Readings', 'HTML-Entities aufgelöst');

  const lineDance = angereichert().find((e) => e.id.startsWith('lostweekend:2826-'));
  assert.equal(lineDance!.category, 'Dance');

  const gattungen = new Set(angereichert().map((e) => e.category));
  assert.deepEqual([...gattungen].sort(), ['Comedy', 'Dance', 'Live Music', 'Party', 'Poetry & Readings']);
});

test('erfindet keinen Text, wo der Beitrag keinen hat', () => {
  const leer = angereichert().find((e) => e.id.startsWith('lostweekend:2968-'));
  assert.ok(leer, 'SOULBOII & FRIENDSS gefunden');
  assert.equal(leer.description, undefined);
  assert.equal(leer.category, 'Live Music');
});

test('lässt die Termine stehen, wenn die REST-Schnittstelle nichts liefert', () => {
  const events = september().events;
  assert.equal(applyPostDetails(events, new Map()), events);
  assert.deepEqual(parsePostDetails('<html>Fehlerseite</html>', new Map()), new Map());
  assert.deepEqual(parseCategoryNames('kein json'), new Map());
});

test('erkennt einen leeren Monat und meldet ihn nicht als Fehler', () => {
  const result = parseMonthResponse(fixture('monat-leer-2024-01.json'), '2024-01');
  assert.deepEqual(result, { events: [], skipped: 0, empty: true, reported: 0, postIds: [] });
});

test('leere oder kaputte Antworten werfen nicht', () => {
  // Ohne Container ist "empty" bewusst false – das ist ein Layoutfehler.
  const kaputt = { events: [], skipped: 0, empty: false, postIds: [] };
  assert.deepEqual(parseMonthResponse('', '2026-09'), kaputt);
  assert.deepEqual(parseMonthResponse('<html>Fehlerseite</html>', '2026-09'), kaputt);
  assert.deepEqual(parseMonthResponse('{"html":"<div>Neues Layout</div>"}', '2026-09'), {
    ...kaputt,
    reported: undefined,
  });
  assert.deepEqual(
    parseMonthFragment('<div class="mec-event-list-standard"><article class="mec-event-article"></article></div>', '2026-09'),
    { events: [], skipped: 1, empty: true, postIds: [] },
  );
});
