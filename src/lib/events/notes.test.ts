import assert from 'node:assert/strict';
import test from 'node:test';

import { noteFacts } from './notes.ts';

test('Preis und Dauer werden aus den Zusatzinfos gelöst, der Rest bleibt', () => {
  const facts = noteFacts({
    notes: ['Doors: 19:00', 'Tickets from £27.08', 'Duration: 2 hours 13 minutes', 'Tron Theatre Company presents'],
  });
  assert.deepEqual(facts, {
    prices: ['from £27.08'],
    duration: '2 hours 13 minutes',
    attributes: [{ label: 'Doors', value: '19:00' }],
    rest: ['Tron Theatre Company presents'],
  });
});

test('nur die vorangestellte Beschriftung fällt weg, der Wortlaut bleibt', () => {
  assert.deepEqual(
    noteFacts({
      notes: ['Preise: ab 15,00 €', 'Preis ab 27 €', 'Eintritt ab 30,90 €', 'Mitglieder: 14 €', 'Preise I: 100 / 88 / 9 €'],
    }).prices,
    ['ab 15,00 €', 'ab 27 €', 'ab 30,90 €', 'Mitglieder: 14 €', 'Preise I: 100 / 88 / 9 €'],
  );
  assert.deepEqual(noteFacts({ notes: ['Vorverkauf 12 EUR, ermäßigt 8 EUR'] }).prices, [
    'Vorverkauf 12 EUR, ermäßigt 8 EUR',
  ]);
});

test('freier Eintritt ist eine Preisangabe', () => {
  assert.deepEqual(noteFacts({ notes: ['Eintritt frei'] }).prices, ['Eintritt frei']);
  assert.deepEqual(noteFacts({ notes: ['Tickets: Free'] }).prices, ['Free']);
});

test('Zeilen ohne Betrag oder ausdrückliche Dauer sind keine Preise', () => {
  const facts = noteFacts({
    notes: ['Einlass: 30 Minuten vor Vorstellungsbeginn', 'Glasgow Life Tickets', 'Zeitraum: 1.10. bis 3.10.'],
  });
  assert.deepEqual(facts.prices, []);
  assert.equal(facts.duration, undefined);
  assert.deepEqual(facts.rest, ['Glasgow Life Tickets']);
});

test('beschriftete Zusatzinfos werden zu eigenen Zeilen, mit der Beschriftung der Quelle', () => {
  const facts = noteFacts({
    notes: [
      'Doors: 12:30',
      'Einlass: 30 Minuten vor Vorstellungsbeginn',
      'Sprache: in deutscher Sprache',
      'Tickets from £27.08',
      'Glasgow Life Tickets',
    ],
  });
  assert.deepEqual(facts.attributes, [
    { label: 'Doors', value: '12:30' },
    { label: 'Einlass', value: '30 Minuten vor Vorstellungsbeginn' },
    { label: 'Sprache', value: 'in deutscher Sprache' },
  ]);
  assert.deepEqual(facts.prices, ['from £27.08']);
  assert.deepEqual(facts.rest, ['Glasgow Life Tickets']);
});

test('nur kurze Beschriftungen ohne Ziffern, und keine langen Texte', () => {
  const long = `Hinweis: ${'sehr lang '.repeat(20)}`;
  const facts = noteFacts({ notes: ['Einführung ab 19: im Foyer', long, '19:30 Uhr'] });
  assert.deepEqual(facts.attributes, []);
  assert.equal(facts.rest.length, 3);
});
