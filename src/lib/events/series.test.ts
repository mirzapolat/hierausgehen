import assert from 'node:assert/strict';
import test from 'node:test';

import { groupBySeries, pickForCell, seriesKey, seriesRuns } from './series.ts';
import type { CalendarEvent } from './types.ts';

function event(id: string, title: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    sourceId: 'haus',
    title,
    start,
    allDay: false,
    venue: { name: 'Grosses Haus' },
    availability: 'unknown',
    url: 'https://example.org',
    ...extra,
  };
}

const now = new Date('2026-10-05T12:00:00Z');

test('eine Reihe zählt geladene und von der Quelle genannte Termine einmal', () => {
  const a = event('a', 'Othello', '2026-10-06T19:30:00Z', {
    relatedPerformances: [
      { id: 'b', start: '2026-10-07T19:30:00Z', allDay: false, venue: { name: 'Grosses Haus' }, availability: 'unknown', url: '' },
      { id: 'c', start: '2026-11-15T19:30:00Z', allDay: false, venue: { name: 'Grosses Haus' }, availability: 'unknown', url: '' },
    ],
  });
  const b = event('b', 'Othello', '2026-10-07T19:30:00Z');
  const run = seriesRuns([a, b], now).get(seriesKey(a));
  assert.deepEqual(run, { count: 3, last: '2026-11-15T19:30:00Z' });
});

test('Vergangenes zählt nicht zur Reihe', () => {
  const past = event('p', 'Othello', '2026-10-01T19:30:00Z');
  const next = event('n', 'Othello', '2026-10-08T19:30:00Z');
  assert.equal(seriesRuns([past, next], now).get(seriesKey(next))?.count, 1);
});

test('zwei Vorstellungen am selben Tag werden eine Zeile', () => {
  const groups = groupBySeries([
    event('1', 'Othello', '2026-10-06T14:00:00Z'),
    event('2', 'Konzert', '2026-10-06T16:00:00Z'),
    event('3', 'Othello', '2026-10-06T19:30:00Z'),
  ]);
  assert.deepEqual(groups.map((group) => group.map((e) => e.id)), [['1', '3'], ['2']]);
});

test('in einer vollen Zelle hat das Seltene Vorrang, gezeigt wird in zeitlicher Folge', () => {
  const othello = [1, 2, 3, 4].map((day) => event(`o${day}`, 'Othello', `2026-10-0${day + 5}T19:30:00Z`));
  const day = [
    [event('o', 'Othello', '2026-10-06T14:00:00Z')],
    [event('x', 'Lesung', '2026-10-06T18:00:00Z')],
    [event('y', 'Jazz', '2026-10-06T21:00:00Z')],
  ];
  const runs = seriesRuns([...othello, day[0][0], day[1][0], day[2][0]], now);
  const { shown, hidden } = pickForCell(day, 2, runs);
  assert.deepEqual(shown.map((group) => group[0].id), ['x', 'y']);
  assert.equal(hidden, 1);

  const preferred = pickForCell(day, 2, runs, (e) => e.id === 'o');
  assert.deepEqual(preferred.shown.map((group) => group[0].id), ['o', 'x']);
});
