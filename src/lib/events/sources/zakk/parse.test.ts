import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEventDetail, parseProgramme } from './parse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');
const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
const programm = () => parseProgramme(fixture('programm-alle-2026-11.html'));

test('liest jeden Termin aller Monatslisten genau einmal', () => {
  const { events, skipped, empty } = programm();
  assert.equal(events.length, 211);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, 211);
});

test('normalisiert einen Termin vollständig', () => {
  const event = programm().events.find((e) => e.id === 'zakk:16183');
  assert.ok(event);
  assert.equal(event.title, 'Fritz Eckenga');
  assert.equal(event.subtitle, 'Neues Programm (oder: Antworten auf alle anderen Fragen)');
  assert.equal(event.start, '2026-11-11T20:00:00+01:00');
  assert.equal(event.allDay, false);
  assert.equal(event.availability, 'available');
  assert.equal(event.ticketUrl, 'https://zakk.de/event-detail?event=16183');
  assert.equal(event.url, 'https://zakk.de/event-detail?event=16183');
  assert.equal(event.icsUrl, 'https://zakk.de/event-detail?event=16183&event-ics-cmd=1');
  assert.deepEqual(event.notes, ['Einlass: 19:00', 'Preise: VVK € 26,40 / AK € 28,00']);
  assert.ok(event.description);
});

test('Genres vor der Rubrik, Zielgruppen und zerstückelte Schlagworte bleiben weg', () => {
  const fil = programm().events.find((e) => e.id === 'zakk:15808')!;
  assert.equal(fil.category, 'Kabarett, Comedy, Satire, Wort & Bühne');
  const all = programm().events.map((e) => e.category ?? '');
  assert.ok(all.every((c) => !/Selbermachen|Eintritt frei|--/.test(c)));
});

test('verteilt die Ticketlage', () => {
  assert.deepEqual(count(programm().events.map((e) => e.availability)), {
    unknown: 121,
    available: 80,
    soldout: 6,
    not_on_sale: 4,
  });
  assert.equal(programm().events.find((e) => e.id === 'zakk:16244')!.availability, 'soldout');
});

test('Raum und „nicht im zakk" als Ort', () => {
  const venues = new Set(programm().events.map((e) => e.venue.name));
  assert.ok(venues.has('Halle'));
  assert.ok(venues.has('nicht im zakk'));
});

test('eine Liste ohne Termin ist leer, eine fremde Seite nicht', () => {
  const html = '<ul class="ticket-list cf programm"><li class="single-ticket cf monthly-list"><h3>Juli 2027</h3></li></ul>';
  assert.deepEqual(parseProgramme(html), { events: [], skipped: 0, empty: true });
  assert.deepEqual(parseProgramme(''), { events: [], skipped: 0, empty: false });
});

test('liest Programmtext und Veranstalter der Terminseite', () => {
  const detail = parseEventDetail(fixture('event-fil-2026-11.html'))!;
  assert.match(detail.description!, /^Jugend - die große Einbahnstraße/);
  assert.deepEqual(detail.notes, ['Veranstalter: zakk']);
  assert.equal(parseEventDetail('<html></html>'), undefined);
});
