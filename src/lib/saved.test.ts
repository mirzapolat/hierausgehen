import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSaved, toggleSaved } from './saved.ts';

const NOW = new Date('2026-10-05T12:00:00Z');

test('merken und wieder vergessen', () => {
  const event = { id: 'a:1', start: '2026-10-10T19:00:00+02:00' };
  const once = toggleSaved([], event);
  assert.deepEqual(once, [{ id: 'a:1', start: event.start }]);
  assert.deepEqual(toggleSaved(once, event), []);
});

test('Mehrtägiges behält sein Ende', () => {
  const run = { id: 'a:2', start: '2026-09-01T10:00:00+02:00', end: '2026-12-01T18:00:00+01:00' };
  assert.deepEqual(toggleSaved([], run), [run]);
});

test('Vergangenes fällt nach einem Tag von selbst weg', () => {
  const stored = [
    { id: 'gestern', start: '2026-10-04T19:00:00+02:00' },
    { id: 'vorige-woche', start: '2026-09-28T19:00:00+02:00' },
    { id: 'laeuft-noch', start: '2026-09-01T10:00:00+02:00', end: '2026-12-01T18:00:00+01:00' },
    { id: 'morgen', start: '2026-10-06T19:00:00+02:00' },
  ];
  assert.deepEqual(
    normalizeSaved(stored, NOW).map((entry) => entry.id),
    ['gestern', 'laeuft-noch', 'morgen'],
  );
});

test('Unlesbares und Doppeltes wird verworfen', () => {
  assert.deepEqual(normalizeSaved('kaputt', NOW), []);
  assert.deepEqual(
    normalizeSaved(
      [null, { id: 1 }, { id: 'x', start: '2026-10-06T19:00:00+02:00' }, { id: 'x', start: '2026-10-07T19:00:00+02:00' }],
      NOW,
    ),
    [{ id: 'x', start: '2026-10-06T19:00:00+02:00' }],
  );
});
