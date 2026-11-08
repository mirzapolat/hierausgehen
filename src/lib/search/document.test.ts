import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../events/types.ts';
import { boilerplateBySource, extractPeople, isKidFriendly, priceOf, productionKey, withoutBoilerplate } from './document.ts';

const event = (patch: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'x:1',
  sourceId: 'x',
  title: 'Abend',
  start: '2026-11-12T19:30:00+01:00',
  allDay: false,
  venue: { name: 'Saal' },
  availability: 'unknown',
  url: 'https://example.org',
  ...patch,
});

test('Mitwirkende aus Untertitel und Zusatzinfos', () => {
  assert.deepEqual(extractPeople({ subtitle: 'mit Julia Hagen (Violoncello) & Sir Simon Rattle (Leitung)' }), [
    'Julia Hagen',
    'Sir Simon Rattle',
  ]);
  assert.deepEqual(extractPeople({ notes: ['Besetzung: Saoirse Ronan, Jacob Anderson'] }), ['Saoirse Ronan', 'Jacob Anderson']);
  assert.deepEqual(extractPeople({ subtitle: 'von Bertolt Brecht / Regie: Christian Stückl' }), [
    'Bertolt Brecht',
    'Christian Stückl',
  ]);
  // Ein Satz ist kein Name.
  assert.deepEqual(extractPeople({ subtitle: 'Ein Abend über die Liebe.' }), []);
});

test('Sätze, die eine Quelle überall anhängt, fallen aus dem Index', () => {
  const notice = 'ACHTUNG: Wir sind leider nicht barriefrei für Rollstuhlfahrer*innen!';
  const events = Array.from({ length: 10 }, (_, i) => ({
    sourceId: 'milla',
    description: i < 6 ? `Band ${i} spielt Indie. ${notice}` : `Band ${i} spielt Jazz.`,
  }));
  const boilerplate = boilerplateBySource(events);
  assert.ok(boilerplate.get('milla')?.has(notice));
  // Auch dort, wo er ohne Satzende am vorigen Text klebt.
  assert.equal(withoutBoilerplate(`VVK 20€ ${notice}`, boilerplate.get('milla')), 'VVK 20€');
});

test('Preis nur aus den Angaben der Quelle', () => {
  assert.deepEqual(priceOf(event({ notes: ['Preise: ab 39,00 €'] })), { free: false, min: 39 });
  assert.deepEqual(priceOf(event({ notes: ['Tickets from £27.08'] })), { free: false, min: 27.08 });
  assert.deepEqual(priceOf(event({ notes: ['Preise: Kostenlos'] })), { free: true, min: 0 });
  assert.deepEqual(priceOf(event({})), { free: false, min: undefined });
});

test('Für Kinder nur, wenn die Quelle es sagt', () => {
  assert.ok(isKidFriendly(event({ category: 'Kinder & Familie' })));
  assert.ok(isKidFriendly(event({ title: 'Familienkonzert' })));
  assert.ok(isKidFriendly(event({ notes: ['Altersempfehlung: ab 6 Jahren'] })));
  assert.ok(!isKidFriendly(event({ notes: ['Altersempfehlung: ab 16 Jahren'] })));
  assert.ok(!isKidFriendly(event({ title: 'Faust' })));
});

test('Preise im Untertitel trennen eine Produktion nicht', () => {
  const a = event({ title: '6. Akademiekonzert', subtitle: 'Preise G , € 70 / 63 / 53' });
  const b = event({ title: '6. Akademiekonzert', subtitle: 'Preise G , € 70 / 63', start: '2026-11-13T19:30:00+01:00' });
  assert.equal(productionKey(a), productionKey(b));
  assert.notEqual(productionKey(event({ subtitle: 'Teil 1' })), productionKey(event({ subtitle: 'Teil 2' })));
});
