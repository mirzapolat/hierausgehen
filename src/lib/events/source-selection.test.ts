import assert from 'node:assert/strict';
import test from 'node:test';

import { groupState, toggleGroup, toggleSource, visibleSources } from './source-selection.ts';

const theater = ['citizens', 'tron', 'pavilion'];
const sorted = (set: Set<string>) => [...set].sort();

test('ein Klick auf den Ordner wählt ihn ganz, ein zweiter wieder ab', () => {
  const on = toggleGroup(new Set(['rcs']), theater);
  assert.deepEqual(sorted(on), ['citizens', 'pavilion', 'rcs', 'tron']);
  assert.deepEqual(sorted(toggleGroup(on, theater)), ['rcs']);
});

test('ein eingegrenzter Ordner wird mit einem Klick wieder ganz gewählt', () => {
  assert.equal(groupState(new Set(['tron']), theater), 'some');
  assert.equal(groupState(toggleGroup(new Set(['tron']), theater), theater), 'all');
});

test('im ganz gewählten Ordner grenzt ein Klick auf ein Haus auf dieses ein', () => {
  assert.deepEqual(sorted(toggleSource(new Set(theater), 'tron', theater)), ['tron']);
});

test('danach schaltet jeder Klick ein Haus dazu oder weg', () => {
  const two = toggleSource(new Set(['tron']), 'citizens', theater);
  assert.deepEqual(sorted(two), ['citizens', 'tron']);
  assert.deepEqual(sorted(toggleSource(two, 'tron', theater)), ['citizens']);
});

test('wird das letzte Haus abgewählt, gilt wieder der ganze Ordner', () => {
  assert.deepEqual(sorted(toggleSource(new Set(['tron', 'rcs']), 'tron', theater)), [...theater, 'rcs'].sort());
});

test('ein Ordner mit nur einem Haus verhält sich wie ein Schalter', () => {
  assert.deepEqual(sorted(toggleSource(new Set(['glasgow-life']), 'glasgow-life', ['glasgow-life'])), []);
});

test('ohne Auswahl – oder nur mit Unbekanntem – ist alles zu sehen', () => {
  const all = ['a', 'b'];
  assert.deepEqual(sorted(visibleSources(all, new Set())), all);
  assert.deepEqual(sorted(visibleSources(all, new Set(['weg']))), all);
  assert.deepEqual(sorted(visibleSources(all, new Set(['b', 'weg']))), ['b']);
});
