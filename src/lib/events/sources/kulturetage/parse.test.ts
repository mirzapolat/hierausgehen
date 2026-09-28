import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dayOrdinals, mergeProduction, parseProductionPage, parseProgramme } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

// Der Tag, an dem die Fixture gespeichert wurde – er bestimmt das Jahr der
// Daten ohne Jahreszahl.
const programm = () => parseProgramme(fixture('programm-2026-09.html'), '2026-09-28');

test('liest das ganze veröffentlichte Programm', () => {
  const { events, skipped, empty } = programm();
  assert.equal(events.length, 115);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  // „29.09.“ ohne Jahr ist das laufende, „16.12.2027“ trägt seins.
  assert.equal(events[0].start, '2026-09-29T00:00:00+02:00');
  assert.equal(events.at(-1)!.start, '2027-12-16T00:00:00+01:00');
});

test('normalisiert einen Termin der Liste', () => {
  const nightwash = programm().events.find((e) => e.id === 'kulturetage:835197');
  assert.ok(nightwash);
  assert.equal(nightwash.title, 'NightWash');
  assert.equal(nightwash.category, 'Comedy');
  assert.equal(nightwash.start, '2027-01-08T00:00:00+01:00');
  assert.equal(nightwash.allDay, true, 'die Uhrzeit kommt erst von der Produktionsseite');
  assert.deepEqual(nightwash.venue, { name: 'Kulturetage' });
  assert.equal(nightwash.availability, 'available');
  assert.equal(nightwash.ticketUrl, 'https://kulturetage.reservix.de/p/reservix/event/2613975');
  // Ohne die wandernde Listenposition am Ende.
  assert.equal(nightwash.url, 'https://www.kulturetage.de/nightwash_12---1193.html');
});

test('liest die Ticketlage aus den Hinweisen', () => {
  const { events } = programm();
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { soldout: 9, limited: 13, available: 92, unknown: 1 });

  const alarm = events.find((e) => e.availability === 'limited');
  assert.equal(alarm!.availabilityLabel, 'Ticket-Alarm');

  // Andere Hinweise sind keine Ticketlage.
  const spende = events.find((e) => e.id === 'kulturetage:835864');
  assert.equal(spende!.availability, 'unknown');
  assert.deepEqual(spende!.notes, ['Eintritt frei - Spende erbeten']);
});

test('vergibt eindeutige IDs', () => {
  const { events } = programm();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
});

test('ergänzt Uhrzeit, Saal, Untertitel, Text und Preis von der Produktionsseite', () => {
  const detail = parseProductionPage(fixture('detail-nightwash.html'))!;
  assert.equal(detail.room, 'Halle');
  assert.equal(detail.price, 'ab 30,90 €');
  assert.equal(detail.subtitle, 'Comedy ist LIVE am lustigsten!');
  assert.equal(detail.dates.length, 5);
  assert.deepEqual(detail.dates[2], { id: '835197', day: 8, month: 1, year: 2027, time: '20:00' });
  assert.equal(detail.dates[0].id, undefined, 'ausverkaufte Termine haben keinen Ticketknopf');

  const nightwash = programm().events.find((e) => e.id === 'kulturetage:835197')!;
  const merged = mergeProduction(nightwash, detail);
  assert.equal(merged.start, '2027-01-08T20:00:00+01:00');
  assert.equal(merged.allDay, false);
  assert.deepEqual(merged.venue, { name: 'Halle' });
  assert.equal(merged.subtitle, 'Comedy ist LIVE am lustigsten!');
  assert.deepEqual(merged.notes, ['Eintritt ab 30,90 €']);

  const text = parseProductionPage(fixture('detail-till-reiners.html'))!.description!;
  assert.match(text, /^Eigene Fernsehshows und Preise sind schön und gut/);
  assert.ok(text.includes('\n\n'), 'Absätze bleiben getrennt');
});

test('ordnet zwei Vorstellungen am selben Tag richtig zu', () => {
  const { events } = programm();
  const detail = parseProductionPage(fixture('detail-winter-variete.html'))!;
  const ordinals = dayOrdinals(events);
  const samstag = events
    .filter((e) => e.url.endsWith('---381809.html') && e.start.startsWith('2026-12-05'))
    .map((e) => mergeProduction(e, detail, ordinals.get(e.id)).start);
  assert.deepEqual(samstag, ['2026-12-05T15:00:00+01:00', '2026-12-05T20:00:00+01:00']);

  // Auch ohne Termin-ID auf der Seite entscheidet die Reihenfolge des Tages.
  const ohneIds = { ...detail, dates: detail.dates.map((entry) => ({ ...entry, id: undefined })) };
  const [erste, zweite] = events.filter(
    (e) => e.url.endsWith('---381809.html') && e.start.startsWith('2026-12-06'),
  );
  assert.equal(mergeProduction(erste, ohneIds, 0).start, '2026-12-06T15:00:00+01:00');
  assert.equal(mergeProduction(zweite, ohneIds, 1).start, '2026-12-06T19:00:00+01:00');
});

test('ohne passenden Block bleibt der Termin ganztägig', () => {
  const nightwash = programm().events.find((e) => e.id === 'kulturetage:835197')!;
  const merged = mergeProduction(nightwash, { dates: [{ day: 9, month: 1, year: 2027, time: '20:00' }] });
  assert.equal(merged.allDay, true);
});

test('nennt Daten ohne Jahr um den Jahreswechsel richtig', () => {
  const block = (datum: string) => `<div class="veranstaltung_bild"><div class="veranst_bild">
    <a id="hm1" class="v_anker"></a><div class="info"><div class="datum">Mo <span>${datum}</span></div></div>
    <div class="interpret"><h4>Test</h4></div>
    <div class="infos"><a class="button" href="test_12---5-0.html">infos</a></div></div></div>`;
  assert.equal(parseProgramme(block('05.01.'), '2026-12-28').events[0].start.slice(0, 10), '2027-01-05');
  assert.equal(parseProgramme(block('30.12.'), '2026-12-28').events[0].start.slice(0, 10), '2026-12-30');
});

test('eine leere Liste ist leer, eine fremde Seite nicht erkannt', () => {
  assert.deepEqual(parseProgramme('<div class="veranstaltung_bild"></div>', '2026-09-28'), {
    events: [],
    skipped: 0,
    empty: true,
  });
  assert.deepEqual(parseProgramme('', '2026-09-28'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseProgramme('<html><body>Wartung</body></html>', '2026-09-28'), {
    events: [],
    skipped: 0,
    empty: false,
  });
  assert.equal(parseProductionPage('<html></html>'), undefined);
});
