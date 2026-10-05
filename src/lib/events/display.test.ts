import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutSpans } from '../calendar.ts';
import {
  displayAvailability,
  eventSpan,
  eventsOnDay,
  groupMix,
  runningUntil,
  splitExhibitions,
  splitSpans,
} from './display.ts';
import type { CalendarEvent } from './types.ts';

/** Uhr in Mitteleuropa (Sommerzeit) – reicht für die Tagesgrenzen hier. */
const clock = {
  localDay: (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().slice(0, 10),
  minutesOfDay: (iso: string) => {
    const d = new Date(Date.parse(iso) + 2 * 3_600_000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  },
};

function event(id: string, start: string, end?: string, allDay = false): CalendarEvent {
  return {
    id,
    sourceId: 'test',
    title: id,
    start,
    end,
    allDay,
    venue: { name: 'Haus' },
    availability: 'unknown',
    url: 'https://example.org',
  };
}

test('eine Clubnacht über Mitternacht bleibt ein Abend', () => {
  assert.equal(eventSpan(event('club', '2026-10-09T22:00:00+02:00', '2026-10-10T06:00:00+02:00'), clock), undefined);
});

test('was einen Tag und länger dauert, läuft über mehrere Tage', () => {
  const span = eventSpan(event('lauf', '2026-10-16T19:30:00+02:00', '2026-10-17T23:59:00+02:00'), clock);
  assert.deepEqual(span && { from: span.from, to: span.to }, { from: '2026-10-16', to: '2026-10-17' });
});

test('ganztägige Ausstellungen reichen bis zu ihrem letzten Tag', () => {
  const span = eventSpan(
    event('ausstellung', '2026-10-10T00:00:00+02:00', '2026-10-20T23:59:00+02:00', true),
    clock,
  );
  assert.deepEqual(span && { from: span.from, to: span.to }, { from: '2026-10-10', to: '2026-10-20' });
});

test('ein Ende genau um Mitternacht zählt zum Vortag', () => {
  const span = eventSpan(event('fest', '2026-10-10T00:00:00+02:00', '2026-10-12T00:00:00+02:00', true), clock);
  assert.deepEqual(span && { from: span.from, to: span.to }, { from: '2026-10-10', to: '2026-10-11' });
  assert.equal(eventSpan(event('tag', '2026-10-10T00:00:00+02:00', '2026-10-11T00:00:00+02:00', true), clock), undefined);
});

test('ohne Ende ist nichts mehrtägig', () => {
  assert.equal(eventSpan(event('konzert', '2026-10-10T19:00:00+02:00'), clock), undefined);
});

test('ein Tag zeigt erst seine eigenen Termine, dann was noch läuft', () => {
  const events = [
    event('ausstellung', '2026-10-10T00:00:00+02:00', '2026-10-20T23:59:00+02:00', true),
    event('konzert', '2026-10-12T19:00:00+02:00'),
    event('vorbei', '2026-10-01T00:00:00+02:00', '2026-10-05T23:59:00+02:00', true),
  ];
  assert.deepEqual(eventsOnDay(events, '2026-10-12', clock).map((e) => e.id), ['konzert', 'ausstellung']);
  assert.deepEqual(eventsOnDay(events, '2026-10-10', clock).map((e) => e.id), ['ausstellung']);
  assert.equal(runningUntil(events[0], '2026-10-12', clock), '2026-10-20');
  assert.equal(runningUntil(events[0], '2026-10-10', clock), undefined);
  assert.deepEqual(splitSpans(events, clock).single.map((e) => e.id), ['konzert']);
});

const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

test('Balken werden auf die Woche zugeschnitten', () => {
  const { segments } = layoutSpans([{ id: 'a', from: '2026-10-08', to: '2026-10-14' }], week);
  assert.deepEqual(segments.map(({ startColumn, endColumn, continuesBefore, continuesAfter }) => ({
    startColumn, endColumn, continuesBefore, continuesAfter,
  })), [{ startColumn: 0, endColumn: 2, continuesBefore: true, continuesAfter: false }]);
});

test('Balken teilen sich eine Spur, solange sie sich nicht überdecken', () => {
  const { segments, lanes } = layoutSpans(
    [
      { id: 'a', from: '2026-10-12', to: '2026-10-13' },
      { id: 'b', from: '2026-10-13', to: '2026-10-16' },
      { id: 'c', from: '2026-10-15', to: '2026-10-18' },
    ],
    week,
  );
  assert.equal(lanes, 2);
  assert.deepEqual(Object.fromEntries(segments.map((s) => [s.span.id, s.lane])), { a: 0, b: 1, c: 0 });
});

test('was über die erlaubten Spuren hinausgeht, wird gezählt statt gezeichnet', () => {
  const { segments, hidden } = layoutSpans(
    [
      { id: 'a', from: '2026-10-12', to: '2026-10-18' },
      { id: 'b', from: '2026-10-12', to: '2026-10-14' },
      { id: 'c', from: '2026-10-13', to: '2026-10-15' },
    ],
    week,
    2,
  );
  assert.deepEqual(segments.map((s) => s.span.id), ['a', 'b']);
  assert.deepEqual(hidden.map((s) => s.id), ['c']);
});

test('Zeiträume ausserhalb der Woche kommen nicht vor', () => {
  assert.equal(layoutSpans([{ id: 'a', from: '2026-10-01', to: '2026-10-11' }], week).segments.length, 0);
});

test('Ausstellungen stehen getrennt, die Reihenfolge bleibt', () => {
  const events = [
    { ...event('konzert', '2026-10-12T19:00:00+02:00'), category: 'Konzert' },
    { ...event('schau', '2026-10-12T10:00:00+02:00'), category: 'Ausstellung' },
    event('ohne-art', '2026-10-12T20:00:00+02:00'),
    { ...event('galerie', '2026-10-10T00:00:00+02:00', '2026-10-20T23:59:00+02:00', true), category: 'Ausstellung' },
  ];
  const { events: rest, exhibitions } = splitExhibitions(events);
  assert.deepEqual(rest.map((e) => e.id), ['konzert', 'ohne-art']);
  assert.deepEqual(exhibitions.map((e) => e.id), ['schau', 'galerie']);
});

test('die Trennung hängt an der Art, nicht an Stadt oder Quelle', () => {
  const sources = ['oldenburg-haus', 'muenchen-haus', 'glasgow-haus'];
  const events = sources.map((sourceId) => ({
    ...event(sourceId, '2026-10-12T10:00:00+02:00'),
    sourceId,
    category: 'Ausstellung',
  }));
  assert.equal(splitExhibitions(events).exhibitions.length, sources.length);
});

test('ein Tag setzt sich aus seinen Ordnern zusammen, in fester Reihenfolge', () => {
  const definitions = [
    { id: 'kino', group: 'Kino' as const },
    { id: 'oper', group: 'Oper & Ballett' as const },
  ];
  const mix = groupMix([{ sourceId: 'kino' }, { sourceId: 'oper' }, { sourceId: 'kino' }, { sourceId: 'fremd' }], definitions);
  assert.deepEqual(mix, [
    { group: 'Oper & Ballett', count: 1 },
    { group: 'Kino', count: 2 },
  ]);
});

test('„Kein Verkauf“ allein ist nie frei – nur ausdrücklich Freies heisst „Eintritt frei“', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const base = { start: '2026-10-10T19:00:00Z', availability: 'not_on_sale' as const };
  assert.equal(displayAvailability(base, now), 'not_on_sale');
  assert.equal(displayAvailability({ ...base, availabilityLabel: 'Restkarten an der Abendkasse' }, now), 'not_on_sale');
  assert.equal(displayAvailability({ ...base, notes: ['Eintritt frei'] }, now), 'free');
  assert.equal(displayAvailability({ ...base, availability: 'unknown', availabilityLabel: 'Kostenlos' }, now), 'free');
  // Buchbare Freikarten bleiben buchbar, Vergangenes bleibt vergangen.
  assert.equal(displayAvailability({ ...base, availability: 'available', notes: ['Free - ticket required'] }, now), 'available');
  assert.equal(displayAvailability({ ...base, notes: ['Eintritt frei'] }, new Date('2026-11-01T00:00:00Z')), 'past');
});
