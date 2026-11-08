import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLUDE,
  categoryFit,
  priceFit,
  semanticAlpha,
  textLambda,
  timeFit,
  timePrior,
} from './rank.ts';
import { expand, buildLexical } from './lexical.ts';
import type { SearchDoc } from './document.ts';

test('Genannte Art: verbindlich ohne Suchwörter, Vorliebe mit', () => {
  assert.equal(categoryFit(['Theater'], 'Theater', true), 1);
  assert.equal(categoryFit(['Theater'], 'Kindertheater', true), 0.6);
  assert.equal(categoryFit(['Theater'], 'Konzert', true), EXCLUDE);
  assert.equal(categoryFit(['Theater'], 'Konzert', false), 0.3);
});

test('Tageszeit: im Fenster 1, knapp daneben fast, weit daneben 0,4', () => {
  assert.equal(timeFit(['evening'], 19 * 60), 1);
  assert.ok(timeFit(['evening'], 16 * 60 + 45) > 0.8);
  assert.equal(timeFit(['evening'], 11 * 60), 0.4);
  // Die Nacht geht über Mitternacht.
  assert.equal(timeFit(['night'], 60), 1);
});

test('Preis: unbekannt ist weder Treffer noch Ausschluss', () => {
  assert.equal(priceFit({ free: true }, { free: true, min: 0 }), 1);
  assert.equal(priceFit({ free: true }, { free: false, min: 12 }), EXCLUDE);
  assert.equal(priceFit({ free: true }, { free: false }), 0.4);
  assert.equal(priceFit({ max: 20 }, { free: false, min: 15 }), 1);
  assert.equal(priceFit({ max: 20 }, { free: false, min: 25 }), EXCLUDE);
  assert.equal(priceFit({ max: 20 }, { free: false }), 0.5);
});

test('Bald vor später, aber sanft', () => {
  assert.equal(timePrior(0), 1);
  assert.ok(timePrior(90) > 0.7 && timePrior(90) < 0.71);
});

test('λ und α bleiben in ihren Grenzen', () => {
  assert.equal(textLambda(0), 0);
  assert.ok(textLambda(6.8) > 0.89);
  assert.equal(semanticAlpha(1), 0.15);
  assert.equal(semanticAlpha(0), 0.85);
});

test('Erweiterung: genau, Präfix, Wortende, Tippfehler – aber nicht beliebig', () => {
  const doc = (title: string): SearchDoc => ({
    key: title,
    events: [],
    representative: undefined as never,
    fields: { title, people: '', subtitle: '', venue: '', labels: '', description: '', notes: '' },
    people: [],
    kidFriendly: false,
    embedText: title,
    hash: title,
  });
  const index = buildLexical(['Jazzkonzert', 'Kindertheater', 'Rattle', 'Oper', 'Opa'].map(doc));
  const kinds = (word: string) => Object.fromEntries(expand(index, word).map((e) => [e.term, e.kind]));
  assert.equal(kinds('jazz').jazzkonzert, 'prefix');
  assert.equal(kinds('theater').kindertheat, 'compound');
  assert.equal(kinds('ratle').rattl, 'typo1');
  // Kurze Wörter bekommen keine Tippfehler: „oper" ist nicht „opa".
  assert.equal(kinds('oper').opa, undefined);
  assert.deepEqual(expand(index, 'xyzzy'), []);
});
