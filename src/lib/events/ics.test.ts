import assert from 'node:assert/strict';
import test from 'node:test';

import { icsFileName, toICalendar, toICalendarFeed } from './ics.ts';
import type { CalendarEvent } from './types.ts';

const NOW = new Date('2026-09-01T08:00:00Z');

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

function lines(ics: string): string[] {
  return ics.split('\r\n');
}

test('schreibt ein vollständiges VEVENT', () => {
  const ics = toICalendar(event(), { now: NOW });
  const out = lines(ics);

  assert.equal(out[0], 'BEGIN:VCALENDAR');
  assert.ok(out.includes('BEGIN:VEVENT'));
  assert.ok(out.includes('UID:staatsoper:12345@hierausgehen.de'));
  assert.ok(out.includes('DTSTAMP:20260901T080000Z'));
  // 19:00 in München (UTC+2) ist 17:00 UTC.
  assert.ok(out.includes('DTSTART:20261014T170000Z'));
  assert.ok(out.includes('SUMMARY:Ariadne auf Naxos'));
  assert.ok(out.includes('LOCATION:Nationaltheater'));
  assert.ok(out.includes('END:VCALENDAR'));
  assert.ok(ics.endsWith('\r\n'));
});

test('ohne Ende steht kein DTEND – es wird keine Dauer erfunden', () => {
  const out = lines(toICalendar(event(), { now: NOW }));
  assert.equal(out.filter((line) => line.startsWith('DTEND')).length, 0);

  const withEnd = lines(
    toICalendar(event({ end: '2026-10-14T21:30:00+02:00' }), { now: NOW }),
  );
  assert.ok(withEnd.includes('DTEND:20261014T193000Z'));
});

test('ganztägige Termine als Datumswert', () => {
  const out = lines(toICalendar(event({ allDay: true, start: '2026-10-14T00:00:00+02:00' }), { now: NOW }));
  assert.ok(out.includes('DTSTART;VALUE=DATE:20261014'));
  assert.equal(out.filter((line) => line.startsWith('DTEND')).length, 0);
});

test('ganztägig mit Ende: DTEND ist ausschliessend', () => {
  const out = lines(
    toICalendar(
      event({ allDay: true, start: '2026-10-14T00:00:00+02:00', end: '2026-10-16T00:00:00+02:00' }),
      { now: NOW },
    ),
  );
  assert.ok(out.includes('DTEND;VALUE=DATE:20261017'));
});

test('maskiert Semikolon, Komma, Backslash und Zeilenumbrüche', () => {
  const out = lines(
    toICalendar(
      event({
        title: 'Wagner; Ring, Teil 1',
        venue: { name: 'Halle E \\ Gasteig' },
        description: 'Erste Zeile\nZweite Zeile',
      }),
      { now: NOW },
    ),
  );
  assert.ok(out.includes('SUMMARY:Wagner\\; Ring\\, Teil 1'));
  assert.ok(out.includes('LOCATION:Halle E \\\\ Gasteig'));
  assert.ok(out.join('\r\n').includes('Erste Zeile\\nZweite Zeile'));
});

test('nimmt Untertitel, Programm, Hinweise und Link in die Beschreibung', () => {
  const ics = toICalendar(
    event({
      subtitle: 'von Richard Strauss',
      description: 'Oper in einem Aufzug.',
      notes: ['Einführung 45 Minuten vorher'],
    }),
    { now: NOW },
  );
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('von Richard Strauss'));
  assert.ok(unfolded.includes('Oper in einem Aufzug.'));
  assert.ok(unfolded.includes('Einführung 45 Minuten vorher'));
  assert.ok(unfolded.includes('https://www.staatsoper.de/stueck/ariadne'));
});

test('faltet lange Zeilen auf 75 Oktette, Umlaute zählen doppelt', () => {
  const ics = toICalendar(
    event({ description: 'Ü'.repeat(200), title: 'Kurz' }),
    { now: NOW },
  );
  const encoder = new TextEncoder();
  for (const line of lines(ics)) {
    assert.ok(encoder.encode(line).length <= 75, `zu lang: ${line}`);
  }
  // Zusammengesetzt steht der Text wieder vollständig da.
  assert.ok(ics.replace(/\r\n /g, '').includes('Ü'.repeat(200)));
});

test('der Dateiname trägt Datum und Titel', () => {
  assert.equal(icsFileName(event()), '2026-10-14-ariadne-auf-naxos.ics');
  assert.equal(
    icsFileName(event({ title: 'Übermut & Größe' })),
    '2026-10-14-uebermut-groesse.ics',
  );
});

test('ein Abo bündelt mehrere Termine in einem Kalender mit Namen', () => {
  const ics = toICalendarFeed(
    [event(), event({ id: 'staatsoper:2', title: 'Tosca', start: '2026-10-20T19:30:00+02:00' })],
    { now: NOW, name: 'HIERAUSGEHEN.de · München', refreshHours: 12 },
  );
  const out = lines(ics);
  assert.equal(out.filter((line) => line === 'BEGIN:VCALENDAR').length, 1);
  assert.equal(out.filter((line) => line === 'BEGIN:VEVENT').length, 2);
  assert.ok(out.includes('X-WR-CALNAME:HIERAUSGEHEN.de · München'));
  assert.ok(out.includes('REFRESH-INTERVAL;VALUE=DURATION:PT12H'));
  assert.ok(out.includes('UID:staatsoper:2@hierausgehen.de'));
  assert.equal(out.at(-2), 'END:VCALENDAR');
});

test('ein leeres Abo ist trotzdem ein gültiger Kalender', () => {
  const out = lines(toICalendarFeed([], { now: NOW }));
  assert.deepEqual(out.slice(0, 1), ['BEGIN:VCALENDAR']);
  assert.ok(!out.includes('BEGIN:VEVENT'));
  assert.equal(out.at(-2), 'END:VCALENDAR');
});
