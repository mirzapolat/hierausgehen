import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProgrammePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Die Fixture wurde am 1.9.2026 geholt – das ist der Bezugstag fürs Jahr. */
const programme = (today = '2026-09-01') =>
  parseProgrammePage(fixture('programm-2026-09.html'), today);

test('liest jede Vorstellung der Programmübersicht', () => {
  const { events, skipped } = programme();
  // 21 Zeilen in der PROGRAMMÜBERSICHT (1.9.–9.9.) plus die eine Vorstellung,
  // die nur der Filmblock nennt (ALL MY SISTERS am 13.9.).
  assert.equal(events.length, 22);
  assert.equal(skipped, 0);
  assert.equal(events[0].start.slice(0, 10), '2026-09-01');
  assert.equal(events[events.length - 1].start.slice(0, 10), '2026-09-13');
});

test('vergibt eindeutige IDs aus Tag und Uhrzeit', () => {
  const { events } = programme();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) assert.match(event.id, /^werkstattkino:\d{4}-\d{2}-\d{2}-\d{4}$/);
  // Ein Saal: derselbe Termin aus Übersicht und Filmblock ist ein Ereignis.
  assert.equal(new Set(events.map((e) => e.start)).size, events.length);
});

test('normalisiert eine Vorstellung vollständig', () => {
  const { events } = programme();
  const event = events.find((e) => e.id === 'werkstattkino:2026-09-01-1815');
  assert.ok(event, 'Schwarzers Kosmos am 1.9. um 18.15 h gefunden');
  assert.equal(event.sourceId, 'werkstattkino');
  assert.equal(event.title, 'Schwarzers Kosmos');
  assert.equal(event.start, '2026-09-01T18:15:00+02:00');
  assert.equal(event.end, undefined, 'die Quelle nennt keine Endzeit');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Werkstattkino');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.availability, 'not_on_sale');
  assert.equal(event.availabilityLabel, 'Nur Abendkasse');
  assert.equal(event.ticketUrl, undefined);
  assert.equal(event.url, 'https://werkstattkino.de');
  assert.deepEqual(event.notes, ['Letzte Vorstellung!']);
});

test('übernimmt den Programmtext des Filmblocks', () => {
  const { events } = programme();
  const event = events.find((e) => e.id === 'werkstattkino:2026-09-01-1815');
  assert.match(event!.description!, /^Deutschland 2026\.\nRegie: KLAUS MARTENS\./);
  assert.match(event!.description!, /Bernd Schwarzer/);
  // Auch der gekürzte Titel der Übersicht ("SEMILLAS") findet seinen Block.
  const semillas = events.find((e) => e.id === 'werkstattkino:2026-09-05-1745');
  assert.equal(semillas?.title, 'Semillas');
  assert.match(semillas!.description!, /Regie: ELIANA NINO OVIEDO/);
  // Ohne eigenen Filmblock bleibt die Beschreibung leer statt erfunden.
  assert.equal(events.find((e) => e.id === 'werkstattkino:2026-09-05-2200')?.description, undefined);
  assert.equal(events.filter((e) => e.description).length, 20);
});

test('verteilt eine gemeinsame Uhrzeit auf alle Tage des Abschnitts', () => {
  // "Samstag, 5.9. / Montag, 7.9. / Dienstag, 8.9. jeweils um 20.00 h"
  const { events } = programme();
  const waves = events.filter((e) => e.title === 'Where The Waves Took Her');
  assert.deepEqual(
    waves.map((e) => e.start),
    [
      '2026-09-04T17:00:00+02:00',
      '2026-09-05T20:00:00+02:00',
      '2026-09-07T20:00:00+02:00',
      '2026-09-08T20:00:00+02:00',
    ],
  );
});

test('trennt Sprachfassung und Hinweise vom Titel', () => {
  const { events } = programme();
  const waves = events.find((e) => e.id === 'werkstattkino:2026-09-04-1700');
  assert.equal(waves?.title, 'Where The Waves Took Her');
  assert.deepEqual(waves?.notes, ['OmU', 'Gäste und Gespräch']);
  const tsui = events.find((e) => e.id === 'werkstattkino:2026-09-05-2200');
  assert.equal(tsui?.title, 'Tsui Hark Uncut Special');
  assert.deepEqual(tsui?.notes, ['siehe Newsletter']);
});

test('setzt das fehlende Jahr aus dem Bezugstag', () => {
  // Die Seite nennt nirgends ein Jahr. Ein paar Tage vor dem ersten Termin …
  assert.equal(programme('2026-08-25').events[0].start.slice(0, 10), '2026-09-01');
  // … und am letzten Tag des angekündigten Zeitraums, mit knapp zwei Wochen
  // Vergangenheit auf derselben Seite, muss dasselbe herauskommen.
  const late = programme('2026-09-13');
  assert.deepEqual(
    late.events.map((e) => e.start),
    programme().events.map((e) => e.start),
  );
});

test('meldet nichts statt zu raten, wenn die Antwort unbrauchbar ist', () => {
  assert.deepEqual(parseProgrammePage('', '2026-09-01'), { events: [], skipped: 0 });
  assert.deepEqual(parseProgrammePage('<html><body><p>Wartung</p>', '2026-09-01'), {
    events: [],
    skipped: 0,
  });
  // Seite steht, Programm fehlt – der Adapter macht daraus einen Fehler.
  assert.deepEqual(
    parseProgrammePage('<div class="entry-content"><p>Sommerpause</p></div>', '2026-09-01'),
    { events: [], skipped: 0 },
  );
});
