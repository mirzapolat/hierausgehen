import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORIES, categoryKey, isKnownCategory, normalizeCategory } from './categories.ts';
import { normalizeSourceEvents } from './normalize.ts';
import type { CalendarEvent, SourceDefinition } from './types.ts';

test('führt Schreibweisen derselben Art zusammen', () => {
  for (const raw of ['Konzert', 'Konzerte', 'KONZERT', 'Musik', 'Live Music', 'Livemusik'])
    assert.equal(normalizeCategory(raw), 'Konzert', raw);

  for (const raw of ['Tanz', 'Tanzen', 'Dance', 'Tanzshow'])
    assert.equal(normalizeCategory(raw), 'Tanz', raw);

  for (const raw of ['Theater', 'Schauspiel', 'Commercial-Play', 'JGPTheater'])
    assert.equal(normalizeCategory(raw), 'Theater', raw);
});

test('löst Entities auf, bevor verglichen wird', () => {
  assert.equal(normalizeCategory('Kabarett &amp; Comedy'), 'Comedy');
  assert.equal(normalizeCategory('Kinder &amp; Familie'), 'Kinder & Familie');
  assert.equal(normalizeCategory('Show &amp; Revue'), 'Show');
});

test('zerlegt zusammengesetzte Angaben – der erste bekannte Teil gewinnt', () => {
  assert.equal(normalizeCategory('Konzert / Weltmusik'), 'Konzert');
  assert.equal(normalizeCategory('Musical / Konzert'), 'Musical');
  assert.equal(normalizeCategory('Konzert | Musical Gala'), 'Konzert');
  assert.equal(normalizeCategory('Vortrag/Konferenz'), 'Vortrag');
  assert.equal(normalizeCategory('Kinder &amp; Familie / Show &amp; Revue'), 'Kinder & Familie');
});

test('trennt "&" erst, wenn die ganze Angabe unbekannt ist', () => {
  // Eigene Arten bleiben ganz …
  assert.equal(normalizeCategory('Kinder & Familie'), 'Kinder & Familie');
  assert.equal(normalizeCategory('Poetry & Readings'), 'Literatur');
  // … alles andere führt sein erstes bekanntes Glied.
  assert.equal(normalizeCategory('Lesung & Podcast'), 'Literatur');
  assert.equal(normalizeCategory('Oper & Ballett'), 'Oper');
});

test('behält unbekannte Arten, statt sie einzuebnen', () => {
  assert.equal(normalizeCategory('Zaubershow im Hinterhof'), 'Zaubershow im Hinterhof');
  assert.equal(isKnownCategory('Zaubershow im Hinterhof'), false);
  assert.equal(isKnownCategory('Konzert'), true);
});

test('leere Angaben ergeben keine erfundene Art', () => {
  assert.equal(normalizeCategory(undefined), undefined);
  assert.equal(normalizeCategory(''), undefined);
  assert.equal(normalizeCategory('   '), undefined);
  assert.equal(normalizeCategory(' / | '), undefined);
});

test('der Wortschatz ist in sich widerspruchsfrei', () => {
  const keys = new Map<string, string>();
  for (const category of CATEGORIES) {
    const key = categoryKey(category);
    assert.equal(keys.has(key), false, `${category} kollidiert mit ${keys.get(key)}`);
    keys.set(key, category);
    assert.equal(normalizeCategory(category), category, category);
  }
});

test('die Normalisierung hält den Wortlaut der Quelle fest', () => {
  const definition: SourceDefinition = {
    id: 'lostweekend',
    name: 'Lost Weekend',
    cityId: 'muenchen',
    group: 'Club',
    homepage: 'https://lostweekend.de',
  };
  const base: CalendarEvent = {
    id: 'lostweekend:1',
    sourceId: 'lostweekend',
    title: 'Open Stage',
    start: '2026-09-07T19:00:00+02:00',
    allDay: false,
    venue: { name: 'Lost Weekend' },
    availability: 'unknown',
    url: 'https://lostweekend.de/events/open-stage',
  };

  const [mapped] = normalizeSourceEvents([{ ...base, category: 'Live Music' }], definition);
  assert.equal(mapped.category, 'Konzert');
  assert.equal(mapped.categoryLabel, 'Live Music');

  // Deckt sich der Wortlaut mit der Art, wäre er nur Wiederholung.
  const [same] = normalizeSourceEvents([{ ...base, category: 'Konzert' }], definition);
  assert.equal(same.category, 'Konzert');
  assert.equal(same.categoryLabel, undefined);

  // Ohne Angabe der Quelle bleibt der Ordner als letzte Auskunft.
  const [empty] = normalizeSourceEvents([{ ...base, category: undefined }], definition);
  assert.equal(empty.category, 'Party');
  assert.equal(empty.categoryLabel, undefined);
});

test('die Normalisierung lässt sich wiederholen, ohne etwas zu verlieren', () => {
  const definition: SourceDefinition = {
    id: 'gasteig',
    name: 'Gasteig HP8',
    cityId: 'muenchen',
    group: 'Konzert',
    homepage: 'https://www.gasteig.de',
  };
  const event: CalendarEvent = {
    id: 'gasteig:1',
    sourceId: 'gasteig',
    title: 'Community Dance',
    category: 'Musik',
    start: '2026-09-11T19:00:00+02:00',
    allDay: false,
    venue: { name: 'Gasteig HP8' },
    availability: 'unknown',
    url: 'https://www.gasteig.de/1',
  };

  // Gespeicherte Termine – Cache, Datenstand – laufen ein zweites Mal durch.
  const once = normalizeSourceEvents([event], definition);
  const twice = normalizeSourceEvents(once, definition);
  assert.deepEqual(twice, once);
  assert.equal(twice[0].category, 'Konzert');
  assert.equal(twice[0].categoryLabel, 'Musik');
});
