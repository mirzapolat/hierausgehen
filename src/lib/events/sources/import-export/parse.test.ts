import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Die Fixture wurde am 3.9.2026 geholt – das ist der Bezugstag fürs Jahr. */
const programme = (today = '2026-09-03') =>
  parseProgrammePage(fixture('programm-2026-09.html'), today);

test('liest Vorschau und Archiv aus einer Antwort', () => {
  const { events, skipped } = programme();
  assert.equal(events.length, 1052);
  assert.equal(skipped, 0);

  // 53 angekündigte Termine vor dem Trenner "Archiv", danach das Archiv
  // zurück bis Februar 2023.
  assert.equal(events[0].start.slice(0, 10), '2026-09-04');
  assert.equal(events[52].start.slice(0, 10), '2027-01-28');
  assert.equal(events[53].start.slice(0, 10), '2026-09-02');
  assert.equal(events[events.length - 1].start.slice(0, 10), '2023-02-04');
});

test('vergibt die fehlenden Jahre in beide Richtungen', () => {
  const { events } = programme();
  const upcoming = events.slice(0, 53).map((e) => e.start.slice(0, 10));
  const archive = events.slice(53).map((e) => e.start.slice(0, 10));

  assert.deepEqual([...upcoming].sort(), upcoming, 'Vorschau bleibt aufsteigend');
  assert.deepEqual([...archive].sort().reverse(), archive, 'Archiv bleibt absteigend');

  // Der Jahreswechsel im Vorschauteil: 06.12. gehört noch ins alte Jahr,
  // 28.01. schon ins neue.
  assert.equal(events[51].start.slice(0, 10), '2026-12-06');
});

test('normalisiert einen Termin vollständig', () => {
  const { events } = programme();
  const event = events.find((e) => e.id === 'import-export:kalte-knie-powasser-stresshotel-mutti');
  assert.ok(event, 'Kalte Knie am 4.9. gefunden');
  assert.equal(event.sourceId, 'import-export');
  assert.equal(event.title, 'Kalte Knie + Powasser + Stresshotel Mutti');
  assert.equal(event.subtitle, undefined);
  assert.equal(event.description, undefined, 'die Liste führt keinen Programmtext');
  assert.equal(event.category, 'Konzert');
  // Die Liste nennt den Einlass, nicht den Beginn.
  assert.equal(event.start, '2026-09-04T19:00:00+02:00');
  assert.equal(event.end, undefined, 'die Quelle nennt keine Endzeit');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Import Export');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.availability, 'unknown', 'Vorverkauf steht nur auf der Detailseite');
  assert.equal(event.ticketUrl, undefined);
  assert.equal(event.url, 'https://import-export.cc/event/kalte-knie-powasser-stresshotel-mutti/');
  assert.equal(event.notes, undefined);
});

test('übernimmt die Gattung im Wortlaut der Quelle', () => {
  const { events } = programme();
  const byId = new Map(events.map((e) => [e.id, e]));
  assert.equal(byId.get('import-export:nichni-cabaret-night-north-africa-vibes')?.category, 'Konzert, Clubnight');
  assert.equal(byId.get('import-export:turntabletennis-90')?.category, 'Auflegen, Tischtennis');
  assert.equal(byId.get('import-export:impact-text-offen-10')?.category, 'workshop');

  // 26 der 1052 Blöcke führen keine zweite Zeile – dort bleibt die Gattung
  // leer und der Quellen-Fallback greift.
  assert.equal(events.filter((e) => e.category === undefined).length, 26);
});

test('vergibt eindeutige IDs', () => {
  const { events } = programme();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(new Set(events.map((e) => e.url)).size, events.length);
});

test('liest den Programmtext der Detailseite', () => {
  const text = parseDetailDescription(fixture('detail-kalte-knie-2026-09.html'));
  assert.ok(text);
  assert.match(text, /^Obacht München, HabediEhre/);
  // Zwischenüberschriften und Absätze der drei Bands stehen im Text.
  assert.match(text, /Stresshotel Mutti/);
  assert.match(text, /Kalte Knie wurde 2022 in der Punkszene Berlins gegründet/);
  // Der Ticketkasten gehört nicht zum Programmtext.
  assert.doesNotMatch(text, /Abendkasse/);
});

test('liest auch die knapperen Werkstatt-Seiten', () => {
  const text = parseDetailDescription(fixture('detail-impact-text-offen-2026-09.html'));
  assert.ok(text);
  assert.match(text, /^Hast du Lust, selbst Texte zu schreiben\?/);
  assert.match(text, /Daniel Bayerstorfer/);
});

test('kommt mit leerem und kaputtem HTML zurecht', () => {
  for (const html of ['', '<html><body><div id="content"></div></body></html>', '<div class="events list">']) {
    const { events } = parseProgrammePage(html, '2026-09-03');
    assert.deepEqual(events, []);
    assert.equal(parseDetailDescription(html), undefined);
  }
});
