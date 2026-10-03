import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReturnPath } from './return-path.ts';

test('zurück an die gemerkte Stelle des Kalenders', () => {
  const stored = '/?city=glasgow&view=week&date=2026-10-14&event=x';
  assert.equal(resolveReturnPath(stored, 'glasgow'), stored);
});

test('ohne gemerkte Stelle auf den Kalender der Stadt', () => {
  assert.equal(resolveReturnPath(null, 'muenchen'), '/?city=muenchen');
  assert.equal(resolveReturnPath('/impressum', 'muenchen'), '/?city=muenchen');
});

test('eine in den Einstellungen gewechselte Stadt gilt', () => {
  assert.equal(resolveReturnPath('/?city=glasgow&view=week', 'oldenburg'), '/?city=oldenburg');
});
