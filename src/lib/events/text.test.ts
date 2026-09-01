import assert from 'node:assert/strict';
import test from 'node:test';

import { clean, decodeEntities, softenShouted } from './text.ts';

test('löst benannte und numerische Entities auf', () => {
  assert.equal(decodeEntities('Kabarett &amp; Comedy'), 'Kabarett & Comedy');
  assert.equal(decodeEntities('Caf&eacute; ist unbekannt'), 'Caf&eacute; ist unbekannt');
  assert.equal(decodeEntities('Gespr&auml;ch'), 'Gespräch');
  // Gross- und Kleinschreibung sind verschiedene Entities.
  assert.equal(decodeEntities('&Auml;pfel'), 'Äpfel');
  assert.equal(decodeEntities('Preis&#58; 20 &euro;'), 'Preis: 20 €');
  assert.equal(decodeEntities('&#x2013; Pause'), '– Pause');
});

test('lässt stehen, was keine Entity ist', () => {
  assert.equal(decodeEntities('Rock & Roll'), 'Rock & Roll');
  assert.equal(decodeEntities('AT&T;'), 'AT&T;');
  assert.equal(decodeEntities('&#999999999;'), '&#999999999;');
});

test('clean und softenShouted bleiben unberührt davon', () => {
  assert.equal(clean('  zwei   Zeilen\n hier '), 'zwei Zeilen hier');
  assert.equal(softenShouted('FACK JU GÖHTE'), 'Fack Ju Göhte');
});
