import assert from 'node:assert/strict';
import test from 'node:test';
import { isGenericRoom, nameMatches, plausible, queryVariants } from './geocode.ts';
import type { NominatimResult } from './geocode.ts';

const hit = (name: string, category: string): NominatimResult => ({
  lat: '48.1',
  lon: '11.5',
  name,
  display_name: name,
  category,
});

test('sucht einen Ortsnamen in mehreren Schreibweisen', () => {
  // Der erste Teil trägt den Namen, der Rest ist die Adresse dazu.
  assert.deepEqual(queryVariants('Isarphilharmonie, Gasteig HP8'), [
    'Isarphilharmonie, Gasteig HP8',
    'Isarphilharmonie',
  ]);
  // Ohne das Füllwort findet sich die Seebühne, mit nicht.
  assert.deepEqual(queryVariants('Seebühne im Westpark'), [
    'Seebühne im Westpark',
    'Seebühne Westpark',
  ]);
  assert.deepEqual(queryVariants('Prinzregententheater – Großes Haus'), [
    'Prinzregententheater – Großes Haus',
    'Prinzregententheater',
  ]);
  assert.deepEqual(queryVariants('Unterfahrt'), ['Unterfahrt']);
});

test('erkennt, ob der Fund wirklich der gesuchte Ort ist', () => {
  // Der Fund darf ausführlicher heissen …
  assert.ok(nameMatches('Milla', 'Milla Club'));
  assert.ok(nameMatches('Nationaltheater', 'Bayerisches Nationaltheater'));
  // … und der gesuchte Name darf mit dem Fund beginnen.
  assert.ok(nameMatches('Prinzregententheater – Großes Haus', 'Prinzregententheater'));
  // Der Fall, der ohne Prüfung acht Kilometer danebenläge:
  assert.ok(!nameMatches('Bühne 1', 'Kleine Bühne'));
  assert.ok(!nameMatches('Werkraum', 'Werkstattkino'));
});

test('lässt Haltestellen und Ortsteile nicht als Veranstaltungsort durchgehen', () => {
  // "Nationaltheater" liefert zuerst drei Haltestellen, dann das Theater.
  assert.ok(!plausible(hit('Nationaltheater', 'highway'), 'Nationaltheater'));
  assert.ok(!plausible(hit('Nationaltheater', 'railway'), 'Nationaltheater'));
  assert.ok(plausible(hit('Bayerisches Nationaltheater', 'amenity'), 'Nationaltheater'));
  // Gebäude ohne weitere Angabe sind in Ordnung – so steht das Literaturhaus da.
  assert.ok(plausible(hit('Literaturhaus', 'building'), 'Literaturhaus'));
  // Für das Haus einer Quelle zählt der Name nicht mit.
  assert.ok(plausible(hit('Bayerisches Nationaltheater', 'amenity'), 'Bayerische Staatsoper', {
    checkName: false,
  }));
});

test('erkennt Allerweltsnamen für Räume', () => {
  // Diese vier standen ohne die Regel an falschen Stellen der Stadt.
  assert.ok(isGenericRoom('Saal'));
  assert.ok(isGenericRoom('Foyer'));
  assert.ok(isGenericRoom('Theatersaal'));
  assert.ok(isGenericRoom('Bibliothek'));
  assert.ok(isGenericRoom('Großes Haus'));
  // Ein eigener Bestandteil genügt, um wieder ein Ort zu sein.
  assert.ok(!isGenericRoom('Saal X'));
  assert.ok(!isGenericRoom('Halle E'));
  assert.ok(!isGenericRoom('Habibi Kiosk'));
  assert.ok(!isGenericRoom('Therese-Giehse-Halle'));
  assert.ok(!isGenericRoom('Bühne 1'));
});
