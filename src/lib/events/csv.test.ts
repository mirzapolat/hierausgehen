import assert from 'node:assert/strict';
import test from 'node:test';

import { csvFileName, toCsv } from './csv.ts';
import type { CalendarEvent, SourceDefinition } from './types.ts';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'staatsoper:12345',
    sourceId: 'staatsoper',
    title: 'Ariadne auf Naxos',
    start: '2026-10-14T19:00:00+02:00',
    allDay: false,
    venue: { name: 'Nationaltheater' },
    availability: 'available',
    url: 'https://www.staatsoper.de/stueck/ariadne',
    ...overrides,
  };
}

const definition: SourceDefinition = {
  id: 'staatsoper',
  name: 'Bayerische Staatsoper',
  cityId: 'muenchen',
  group: 'Oper & Ballett',
  homepage: 'https://www.staatsoper.de',
};

function rows(csv: string): string[] {
  return csv.split('\r\n');
}

test('Kopfzeile und ein Termin je Zeile', () => {
  const out = rows(toCsv([event()], [definition]));

  assert.ok(out[0].startsWith('id,quelle_id,quelle,gruppe,kalenderstadt,titel'));
  assert.equal(out[0].split(',').length, out[1].split(',').length);
  assert.ok(
    out[1].startsWith('staatsoper:12345,staatsoper,Bayerische Staatsoper,Oper & Ballett,muenchen,'),
  );
  // Abschliessender Zeilenumbruch, danach nichts mehr.
  assert.equal(out.at(-1), '');
});

test('Datum und Uhrzeit stehen zusätzlich getrennt', () => {
  const [, row] = rows(toCsv([event()]));
  const fields = row.split(',');
  assert.ok(fields.includes('2026-10-14'));
  assert.ok(fields.includes('19:00'));
  assert.ok(fields.includes('nein'));
});

test('ganztägige Termine haben keine Uhrzeit', () => {
  const [header, row] = rows(toCsv([event({ allDay: true })]));
  const time = header.split(',').indexOf('uhrzeit');
  assert.equal(row.split(',')[time], '');
  assert.ok(row.includes('ja'));
});

test('Veranstaltungsart und Metadaten wandern in eigene Spalten', () => {
  const csv = toCsv(
    [
      event({
        category: 'Oper',
        subtitle: 'Richard Strauss',
        availability: 'limited',
        availabilityLabel: 'Letzte Tickets',
        ticketUrl: 'https://tickets.staatsoper.de/12345',
        notes: ['Einführung 18:15', 'Mit Übertiteln'],
        relatedPerformances: [
          {
            id: 'staatsoper:12346',
            start: '2026-10-18T18:00:00+02:00',
            allDay: false,
            venue: { name: 'Nationaltheater' },
            availability: 'available',
            url: 'https://www.staatsoper.de/stueck/ariadne',
          },
        ],
      }),
    ],
    [definition],
  );
  const [, row] = rows(csv);

  assert.ok(row.includes('Oper'));
  assert.ok(row.includes('Richard Strauss'));
  assert.ok(row.includes('limited'));
  assert.ok(row.includes('Letzte Tickets'));
  assert.ok(row.includes('Einführung 18:15 | Mit Übertiteln'));
  assert.ok(row.includes('2026-10-18T18:00:00+02:00'));
});

test('fehlende Angaben bleiben leer – nichts wird erfunden', () => {
  const [, row] = rows(toCsv([event()]));
  // Kein Untertitel, keine Art, keine Beschreibung: drei leere Felder in Folge.
  assert.ok(row.includes(',,,'));
});

test('Trennzeichen und Anführungszeichen werden maskiert', () => {
  const [, row] = rows(toCsv([event({ title: 'Romeo, Julia und "der Rest"' })]));
  assert.ok(row.includes('"Romeo, Julia und ""der Rest"""'));
});

test('Zeilenumbrüche im Text bleiben im Feld', () => {
  const csv = toCsv([event({ description: 'Erste Zeile\nZweite Zeile' })]);
  assert.ok(csv.includes('"Erste Zeile\nZweite Zeile"'));
  // Die Kopfzeile bleibt die einzige vor dem Termin.
  assert.equal(csv.split('\r\n')[0].startsWith('id,'), true);
});

test('unbekannte Quelle: Name, Gruppe und Stadt bleiben leer', () => {
  const [, row] = rows(toCsv([event()], []));
  assert.ok(row.startsWith('staatsoper:12345,staatsoper,,,,Ariadne'));
});

test('Dateiname nennt Stadt und Datenstand', () => {
  assert.equal(csvFileName(['muenchen'], '2026-09-01'), 'hierausgehen-muenchen-2026-09-01.csv');
  assert.equal(
    csvFileName(['muenchen', 'glasgow'], '2026-09-01'),
    'hierausgehen-muenchen-glasgow-2026-09-01.csv',
  );
});

test('der Wortlaut der Quelle steht neben der vereinheitlichten Art', () => {
  const [header, row] = rows(
    toCsv([event({ category: 'Konzert', categoryLabel: 'Live Music' })]),
  );
  const columns = header.split(',');
  const fields = row.split(',');
  assert.equal(fields[columns.indexOf('veranstaltungsart')], 'Konzert');
  assert.equal(fields[columns.indexOf('veranstaltungsart_quelle')], 'Live Music');
});
