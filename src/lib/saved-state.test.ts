import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasSearch,
  normalizeSaved,
  saveEvent,
  saveSearch,
  savedReasons,
  unsaveEvent,
  unsaveSearch,
  type SavableEvent,
  type SavedState,
} from './saved-state.ts';

const NOW = new Date('2026-10-05T12:00:00Z');
const EMPTY: SavedState = { events: [], series: [], searches: [] };

function event(id: string, start: string, extra: Partial<SavableEvent> = {}): SavableEvent {
  return { id, start, sourceId: 'a', title: 'Tosca', venue: { name: 'Nationaltheater' }, ...extra };
}

const first = event('a:1', '2026-10-10T19:00:00+02:00');
const second = event('a:2', '2026-10-12T19:00:00+02:00');
// Kommt erst später ins Programm – war beim Merken noch unbekannt.
const later = event('a:3', '2026-11-02T19:00:00+01:00');
const other = event('a:9', '2026-10-11T19:00:00+02:00', { title: 'Carmen' });
const withRelated = {
  ...first,
  relatedPerformances: [{ ...second, allDay: false, availability: 'unknown' as const, url: '' }],
};

test('merken und wieder vergessen', () => {
  const once = saveEvent(EMPTY, first, 'event');
  assert.deepEqual(once.events, [{ id: 'a:1', start: first.start }]);
  assert.deepEqual(unsaveEvent(once, first, { kind: 'event' }).events, []);
});

test('Mehrtägiges behält sein Ende', () => {
  const run = event('a:2', '2026-09-01T10:00:00+02:00', { end: '2026-12-01T18:00:00+01:00' });
  assert.deepEqual(saveEvent(EMPTY, run, 'event').events, [{ id: run.id, start: run.start, end: run.end }]);
});

test('eine gemerkte Reihe umfasst auch spätere Termine', () => {
  const state = saveEvent(saveEvent(EMPTY, first, 'event'), withRelated, 'series');
  // Der einzeln gemerkte Termin geht in der Reihe auf.
  assert.deepEqual(state.events, []);
  assert.equal(state.series.length, 1);
  for (const member of [first, second, later]) {
    assert.deepEqual(savedReasons(state, member), [{ kind: 'series' }], member.id);
  }
  assert.deepEqual(savedReasons(state, other), []);
});

test('nur einen Termin aus der Reihe entfernen – die Reihe bleibt', () => {
  const series = saveEvent(EMPTY, withRelated, 'series');
  const without = unsaveEvent(series, second, { kind: 'event' });
  assert.deepEqual(savedReasons(without, second), []);
  assert.deepEqual(savedReasons(without, later), [{ kind: 'series' }]);
  // Wieder merken hebt die Ausnahme auf, statt einen Einzeleintrag anzulegen.
  const back = saveEvent(without, second, 'event');
  assert.deepEqual(back.events, []);
  assert.deepEqual(savedReasons(back, second), [{ kind: 'series' }]);
});

test('die ganze Reihe entfernen', () => {
  const state = saveEvent(saveEvent(EMPTY, withRelated, 'series'), other, 'event');
  const gone = unsaveEvent(state, withRelated, { kind: 'series' });
  assert.deepEqual(gone.series, []);
  assert.deepEqual(savedReasons(gone, later), []);
  assert.deepEqual(savedReasons(gone, other), [{ kind: 'event' }]);
});

test('eine gemerkte Suche merkt, was sie findet – nur in ihrer Stadt', () => {
  const state = saveSearch(EMPTY, '  tosca ', 'muenchen', 'de');
  assert.ok(hasSearch(state, 'Tosca', 'muenchen'));
  assert.deepEqual(savedReasons(state, later, 'muenchen'), [{ kind: 'search', query: 'tosca' }]);
  assert.deepEqual(savedReasons(state, later, 'berlin'), []);
  assert.deepEqual(savedReasons(state, other, 'muenchen'), []);

  const without = unsaveEvent(state, later, { kind: 'event' }, 'muenchen');
  assert.deepEqual(savedReasons(without, later, 'muenchen'), []);
  assert.deepEqual(savedReasons(without, first, 'muenchen'), [{ kind: 'search', query: 'tosca' }]);

  assert.deepEqual(unsaveSearch(state, 'TOSCA', 'muenchen').searches, []);
});

test('Vergangenes fällt nach einem Tag von selbst weg', () => {
  const stored = [
    { id: 'gestern', start: '2026-10-04T19:00:00+02:00' },
    { id: 'vorige-woche', start: '2026-09-28T19:00:00+02:00' },
    { id: 'laeuft-noch', start: '2026-09-01T10:00:00+02:00', end: '2026-12-01T18:00:00+01:00' },
    { id: 'morgen', start: '2026-10-06T19:00:00+02:00' },
  ];
  assert.deepEqual(
    normalizeSaved(stored, NOW).events.map((entry) => entry.id),
    ['gestern', 'laeuft-noch', 'morgen'],
  );
});

test('Unlesbares und Doppeltes wird verworfen', () => {
  assert.deepEqual(normalizeSaved('kaputt', NOW), EMPTY);
  assert.deepEqual(
    normalizeSaved(
      [null, { id: 1 }, { id: 'x', start: '2026-10-06T19:00:00+02:00' }, { id: 'x', start: '2026-10-07T19:00:00+02:00' }],
      NOW,
    ).events,
    [{ id: 'x', start: '2026-10-06T19:00:00+02:00' }],
  );
  const state = normalizeSaved(
    {
      events: [],
      series: [{ key: 'a|tosca||nationaltheater|', title: 'Tosca' }, { key: 'a|tosca||nationaltheater|' }, { title: 'ohne' }],
      searches: [{ query: 'Jazz', cityId: 'muenchen', locale: 'xx' }, { query: ' ', cityId: 'muenchen' }],
    },
    NOW,
  );
  assert.deepEqual(state.series, [{ key: 'a|tosca||nationaltheater|', title: 'Tosca', except: [] }]);
  assert.deepEqual(state.searches, [{ query: 'Jazz', cityId: 'muenchen', locale: 'de', except: [] }]);
});
