import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLayout, normalizeLayoutPrefs, spacePrefs } from './layoutPrefs.ts';

test('ein leerer Speicher ergibt die Voreinstellung', () => {
  assert.deepEqual(normalizeLayoutPrefs({}, 'muenchen'), defaultLayout);
});

test('übernimmt gültige Werte und verwirft kaputte', () => {
  const prefs = normalizeLayoutPrefs(
    {
      sidebarWidth: 260,
      detailWidth: 'breit' as unknown as number,
      sidebarCollapsed: true,
      spaces: {
        glasgow: {
          disabledSources: ['tron', 7 as unknown as string],
          availableOnly: 'ja' as unknown as boolean,
        },
      },
    },
    'muenchen',
  );
  assert.equal(prefs.sidebarWidth, 260);
  assert.equal(prefs.detailWidth, defaultLayout.detailWidth);
  assert.equal(prefs.sidebarCollapsed, true);
  assert.deepEqual(prefs.spaces.glasgow, {
    disabledSources: ['tron'],
    availableOnly: false,
    freeOnly: false,
    disabledCategories: [],
    timesOfDay: [],
  });
});

test('ordnet Filter aus einem alten Stand ohne Städte der gelesenen Stadt zu', () => {
  const prefs = normalizeLayoutPrefs(
    { disabledSources: ['milla'], availableOnly: true, spaces: { glasgow: { disabledSources: ['tron'] } } },
    'muenchen',
  );
  assert.deepEqual(spacePrefs(prefs, 'muenchen'), {
    disabledSources: ['milla'],
    availableOnly: true,
    freeOnly: false,
    disabledCategories: [],
    timesOfDay: [],
  });
  assert.deepEqual(spacePrefs(prefs, 'glasgow').disabledSources, ['tron']);
});

test('eine Stadt ohne gemerkte Filter hat keine', () => {
  assert.deepEqual(spacePrefs(defaultLayout, 'glasgow'), {
    disabledSources: [],
    availableOnly: false,
    freeOnly: false,
    disabledCategories: [],
    timesOfDay: [],
  });
});

test('merkt den Filter für freien Eintritt je Stadt', () => {
  const prefs = normalizeLayoutPrefs(
    { spaces: { oldenburg: { freeOnly: true }, glasgow: { freeOnly: 'ja' as unknown as boolean } } },
    'muenchen',
  );
  assert.equal(spacePrefs(prefs, 'oldenburg').freeOnly, true);
  assert.equal(spacePrefs(prefs, 'glasgow').freeOnly, false);
});

test('merkt die Tageszeiten je Stadt und verwirft unbekannte', () => {
  const prefs = normalizeLayoutPrefs(
    { spaces: { muenchen: { timesOfDay: ['evening', 'mittags', 'night'] as unknown as [] } } },
    'muenchen',
  );
  assert.deepEqual(spacePrefs(prefs, 'muenchen').timesOfDay, ['evening', 'night']);
});
