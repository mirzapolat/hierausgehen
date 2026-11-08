import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProductionDetail, parseSchedule } from './parse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');
const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
const januar = () => parseSchedule(fixture('spielplan-2027-01.html'));
const ab = () => parseSchedule(fixture('programm-ab-heute-2026-11.html'));

test('liest jeden Termin genau einmal', () => {
  const { events, skipped, empty, window } = januar();
  assert.equal(events.length, 36);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, 36);
  assert.deepEqual(window, { from: '2027-01-01', to: '2027-01-31' });
  assert.equal(ab().events.length, 188);
});

test('normalisiert eine Vorstellung vollständig', () => {
  const event = ab().events.find((e) => e.id === 'dhaus:3080');
  assert.deepEqual(event, {
    id: 'dhaus:3080',
    sourceId: 'dhaus',
    title: 'Ein Übertritt (Alles Auf Ende)',
    subtitle: 'von Elfriede Jelinek',
    category: 'Schauspiel',
    start: '2026-11-15T16:00:00+01:00',
    allDay: false,
    venue: { name: 'Schauspielhaus, Kleines Haus' },
    availability: 'limited',
    availabilityLabel: 'Restkarten',
    ticketUrl: 'https://ticket.dhaus.de/eventim.webshop/webticket/shop?&event=26112&language=de',
    url: 'https://www.dhaus.de/programm/spielplan/ein-uebertritt/3080/',
    notes: [
      'Regie: Jossi Wieler',
      'Abo: So 2',
      'Im Anschluss Lesung Jelinek im Kontext mit Stefan Hunstein | Heute: Gedichte von Paul Celan',
    ],
  });
});

test('verteilt die Ticketlage', () => {
  assert.deepEqual(count(ab().events.map((e) => e.availability)), {
    unknown: 34,
    available: 87,
    soldout: 25,
    limited: 41,
    not_on_sale: 1,
  });
  assert.equal(ab().events.find((e) => e.availability === 'not_on_sale')!.availabilityLabel, 'Vorstellungsausfall');
});

test('legt kurze Angaben als beschriftete Notizen ab', () => {
  const wolf = ab().events.find((e) => e.id === 'dhaus:2954')!;
  assert.deepEqual(wolf.notes, [
    'Regie: Carmen Schwarz',
    'Alter: ab 10 Jahren',
    'Touchtour: 09:00',
    'Mit künstlerischer Audiodeskription',
    'Touchtour für sehbehinderte und blinde Menschen',
  ]);
  assert.ok(ab().events.find((e) => e.id === 'dhaus:3069')!.notes!.includes('Einführung: 18:45'));
  assert.equal(ab().events.find((e) => e.id === 'dhaus:2948')!.title, 'Das NEINhorn');
});

test('ein vergangener Monat liefert den laufenden ab heute', () => {
  const { window } = parseSchedule(fixture('spielplan-angefragt-2026-10-geliefert-2026-11.html'));
  assert.deepEqual(window, { from: '2026-11-08', to: '2026-11-30' });
});

test('ein leerer Container ist ein leerer Zeitraum', () => {
  // Echte Leerantwort gibt es nicht: die Seite zeigt nur Kommendes.
  const html = '<div class="schedule__content js-schedule-content" data-dates-from="2027-07-01" data-dates-to="2027-07-31"></div>';
  assert.deepEqual(parseSchedule(html), { events: [], skipped: 0, empty: true, window: { from: '2027-07-01', to: '2027-07-31' } });
  assert.equal(parseSchedule('').empty, false);
  assert.equal(parseSchedule('<html><body>Wartung</body></html>').empty, false);
});

test('liest Programmtext und Dauer der Produktionsseite', () => {
  const detail = parseProductionDetail(fixture('produktion-inter-alia-2026-11.html'))!;
  assert.match(detail.description!, /^Die australische Juristin/);
  assert.doesNotMatch(detail.description!, /nachtkritik/);
  assert.deepEqual(detail.notes, ['Dauer: 2 Stunden | keine Pause']);
  assert.equal(parseProductionDetail('<html></html>'), undefined);
});
