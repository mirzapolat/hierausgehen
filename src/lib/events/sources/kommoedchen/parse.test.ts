import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseSpielplan } from './parse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');
const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
const spielplan = () => parseSpielplan(fixture('spielplan-2026-11.html'));

test('liest alle Termine in Düsseldorf, Gastspiele auswärts fallen weg', () => {
  const { events, skipped, empty } = spielplan();
  // 146 Blöcke, davon 8 „unterwegs in: …"
  assert.equal(events.length, 138);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(new Set(events.map((e) => e.id)).size, 138);
  assert.deepEqual(count(events.map((e) => e.venue.name)), {
    'Kom(m)ödchen': 135,
    'Robert-Schumann-Saal, Museum Kunstpalast, Ehrenhof 4-5': 3,
  });
});

test('normalisiert einen Termin vollständig', () => {
  const event = spielplan().events.find((e) => e.id === 'kommoedchen:ehring-versoehnung-2026-11-09-2000');
  assert.deepEqual(event, {
    id: 'kommoedchen:ehring-versoehnung-2026-11-09-2000',
    sourceId: 'kommoedchen',
    title: 'Christian Ehring',
    subtitle: 'Versöhnung',
    start: '2026-11-09T20:00:00+01:00',
    allDay: false,
    venue: { name: 'Kom(m)ödchen' },
    availability: 'available',
    availabilityLabel: undefined,
    ticketUrl: 'https://tickets.kommoedchen.de/selection/event/seat?perfId=10229856447209&productId=10229221429698&lang=de',
    url: 'https://www.kommoedchen.de/spielplan/ehring-versoehnung/',
  });
});

test('erkennt die Ticketlage aus Link und Hinweistext', () => {
  const { events } = spielplan();
  assert.deepEqual(count(events.map((e) => e.availability)), {
    available: 113,
    not_on_sale: 21,
    limited: 4,
  });
  const labels = count(events.map((e) => e.availabilityLabel ?? ''));
  assert.equal(labels['VVK am 1. Dez ab 10 Uhr'], 20);
  assert.equal(labels['Abgesagt'], 1);
  assert.equal(labels['eventuelle Restkarten an der Abendkasse'], 3);
  assert.equal(labels['Restkarten eventuell an der Abendkasse'], 1);
  const cancelled = events.find((e) => e.availabilityLabel === 'Abgesagt');
  assert.equal(cancelled?.title, 'Lars Reichow');
  assert.equal(cancelled?.start, '2026-11-26T20:00:00+01:00');
});

test('leere oder fremde Seiten liefern nichts', () => {
  assert.deepEqual(parseSpielplan(''), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseSpielplan('<html><body><p>Wartung</p></body></html>'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseSpielplan('<div class="day-filter"></div>'), { events: [], skipped: 0, empty: true });
});

test('liest den Programmtext der Detailseite', () => {
  const text = parseDetailDescription(fixture('detail-ehring-versoehnung-2026-11.html'));
  assert.ok(text?.startsWith('Christian Ehring, bekannt als Moderator von „extra 3“'));
  assert.ok(text?.endsWith('Text und Musik: Christian Ehring Textmitarbeit: Dietmar Jacobs'));
  assert.equal(text?.split('\n\n').length, 7);
  assert.equal(parseDetailDescription('<html></html>'), undefined);
});
