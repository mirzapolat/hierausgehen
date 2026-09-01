import assert from 'node:assert/strict';
import test from 'node:test';

import { DETAIL_KEY, SIDEBAR_KEY, matchesKey } from './keyboard.ts';

/** Ein Tastenereignis, so viel davon wie `matchesKey` anfasst. */
function press(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

test('QWERTY: die Klammertasten wirken wie bisher', () => {
  assert.ok(matchesKey(press({ key: '[', code: 'BracketLeft' }), SIDEBAR_KEY));
  assert.ok(matchesKey(press({ key: ']', code: 'BracketRight' }), DETAIL_KEY));
  assert.ok(!matchesKey(press({ key: '[', code: 'BracketLeft' }), DETAIL_KEY));
});

test('QWERTZ: dieselbe Taste, anderes Zeichen', () => {
  // Rechts neben dem P liegt auf einer deutschen Tastatur "ü", daneben "+" –
  // beide ohne Modifikator. Ohne `code` wäre das Kürzel dort unerreichbar.
  assert.ok(matchesKey(press({ key: 'ü', code: 'BracketLeft' }), SIDEBAR_KEY));
  assert.ok(matchesKey(press({ key: '+', code: 'BracketRight' }), DETAIL_KEY));
});

test('QWERTZ: das zusammengesetzte Zeichen wirkt weiterhin', () => {
  // AltGr+8 kommt unter Windows als Strg+Alt an und erzeugt "[".
  assert.ok(matchesKey(press({ key: '[', code: 'Digit8', ctrlKey: true, altKey: true }), SIDEBAR_KEY));
  // Auf macOS ist es die Wahltaste allein.
  assert.ok(matchesKey(press({ key: '[', code: 'Digit5', altKey: true }), SIDEBAR_KEY));
  assert.ok(matchesKey(press({ key: ']', code: 'Digit6', altKey: true }), DETAIL_KEY));
});

test('echte Tastenfolgen bleiben unangetastet', () => {
  // Cmd ist nie Teil eines Kürzels der App.
  assert.ok(!matchesKey(press({ key: '[', code: 'BracketLeft', metaKey: true }), SIDEBAR_KEY));
  // Auf QWERTZ liegt auf derselben Taste mit Umschalt "*" – kein Kürzel.
  assert.ok(!matchesKey(press({ key: '*', code: 'BracketRight', shiftKey: true }), DETAIL_KEY));
  // Und Strg allein greift nicht auf die Stelle durch.
  assert.ok(!matchesKey(press({ key: 'ü', code: 'BracketLeft', ctrlKey: true }), SIDEBAR_KEY));
});

test('das Pluszeichen des Ziffernblocks löst nichts aus', () => {
  assert.ok(!matchesKey(press({ key: '+', code: 'NumpadAdd' }), DETAIL_KEY));
});
