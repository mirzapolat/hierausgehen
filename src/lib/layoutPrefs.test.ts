import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLayout, normalizeLayoutPrefs, spacePrefs } from './layoutPrefs.ts';

test('ein leerer Speicher ergibt die Voreinstellung', () => {
  assert.deepEqual(normalizeLayoutPrefs({}), defaultLayout);
});

test('übernimmt gültige Werte und verwirft kaputte', () => {
  const prefs = normalizeLayoutPrefs({
    sidebarWidth: 260,
    detailWidth: 'breit' as unknown as number,
    sidebarCollapsed: true,
    spaces: {
      glasgow: {
        sources: ['tron', 7 as unknown as string],
        availableOnly: 'ja' as unknown as boolean,
        categories: ['Theater'],
      },
    },
  });
  assert.equal(prefs.sidebarWidth, 260);
  assert.equal(prefs.detailWidth, defaultLayout.detailWidth);
  assert.equal(prefs.sidebarCollapsed, true);
  assert.deepEqual(prefs.spaces.glasgow, {
    sources: ['tron'],
    availableOnly: false,
    freeOnly: false,
    categories: ['Theater'],
    timesOfDay: [],
  });
});

test('ausgeblendete Quellen und Arten aus einem alten Stand fallen weg – leer heisst alles', () => {
  const prefs = normalizeLayoutPrefs({
    spaces: { glasgow: { disabledSources: ['tron'], disabledCategories: ['Oper'] } as never },
  });
  assert.deepEqual(spacePrefs(prefs, 'glasgow').sources, []);
  assert.deepEqual(spacePrefs(prefs, 'glasgow').categories, []);
});

test('eine Stadt ohne gemerkte Filter hat keine', () => {
  assert.deepEqual(spacePrefs(defaultLayout, 'glasgow'), {
    sources: [],
    availableOnly: false,
    freeOnly: false,
    categories: [],
    timesOfDay: [],
  });
});

test('merkt den Filter für freien Eintritt je Stadt', () => {
  const prefs = normalizeLayoutPrefs({
    spaces: { oldenburg: { freeOnly: true }, glasgow: { freeOnly: 'ja' as unknown as boolean } },
  });
  assert.equal(spacePrefs(prefs, 'oldenburg').freeOnly, true);
  assert.equal(spacePrefs(prefs, 'glasgow').freeOnly, false);
});

test('merkt die Tageszeiten je Stadt und verwirft unbekannte', () => {
  const prefs = normalizeLayoutPrefs({
    spaces: { muenchen: { timesOfDay: ['evening', 'mittags', 'night'] as unknown as [] } },
  });
  assert.deepEqual(spacePrefs(prefs, 'muenchen').timesOfDay, ['evening', 'night']);
});
