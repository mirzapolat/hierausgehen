import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReturnPath } from './return-path.ts';

test('zurück an die gemerkte Stelle des Kalenders', () => {
  const stored = '/calendar?city=glasgow&view=week&date=2026-10-14&event=x';
  assert.equal(resolveReturnPath(stored, 'glasgow'), stored);
});

test('ohne gemerkte Stelle auf den Kalender der Stadt', () => {
  assert.equal(resolveReturnPath(null, 'muenchen'), '/calendar?city=muenchen');
  assert.equal(resolveReturnPath('/impressum', 'muenchen'), '/calendar?city=muenchen');
});

test('wer von der Suche kam, kommt zur Suche zurück – samt Anfrage', () => {
  const stored = '/search?q=oper+im+dezember&city=muenchen';
  assert.equal(resolveReturnPath(stored, 'muenchen'), stored);
  assert.equal(resolveReturnPath('/search', 'glasgow'), '/search');
  assert.equal(resolveReturnPath('/searchfoo', 'muenchen'), '/calendar?city=muenchen');
});

test('eine in den Einstellungen gewechselte Stadt gilt', () => {
  assert.equal(resolveReturnPath('/calendar?city=glasgow&view=week', 'oldenburg'), '/calendar?city=oldenburg');
});
