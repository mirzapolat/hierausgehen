import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, removeSpans } from './parse.ts';

// Donnerstag, 12. November 2026, 10 Uhr in München.
const thursday = { now: new Date('2026-11-12T09:00:00Z'), timeZone: 'Europe/Berlin' };
const saturday = { now: new Date('2026-11-14T09:00:00Z'), timeZone: 'Europe/Berlin' };
const parse = (query: string, context = thursday) => parseQuery(query, context);

test('Konzerte in München dieses Wochenende unter 30 €: vier Angaben, kein Suchwort', () => {
  const parsed = parse('konzerte in münchen dieses wochenende unter 30 €');
  assert.deepEqual(parsed.words, []);
  assert.deepEqual(parsed.categories?.values, ['Konzert']);
  assert.equal(parsed.city?.id, 'muenchen');
  assert.equal(parsed.date?.from, '2026-11-13');
  assert.equal(parsed.date?.to, '2026-11-15');
  assert.equal(parsed.date?.fridayEvening, true);
  assert.equal(parsed.price?.max, 30);
});

test('Am Wochenende selbst ist „dieses Wochenende" der Rest davon', () => {
  const parsed = parse('this weekend', saturday);
  assert.equal(parsed.date?.from, '2026-11-14');
  assert.equal(parsed.date?.to, '2026-11-15');
  assert.equal(parsed.date?.fridayEvening, false);
});

test('Nächstes Wochenende und nächste Woche', () => {
  assert.equal(parse('nächstes wochenende').date?.from, '2026-11-20');
  assert.equal(parse('next week').date?.from, '2026-11-16');
  assert.equal(parse('next week').date?.to, '2026-11-22');
  assert.equal(parse('diese woche').date?.to, '2026-11-15');
});

test('Heute, morgen, Wochentage, Monate, Daten', () => {
  assert.equal(parse('heute').date?.from, '2026-11-12');
  assert.equal(parse('tomorrow').date?.from, '2026-11-13');
  assert.equal(parse('übermorgen').date?.from, '2026-11-14');
  assert.equal(parse('am sonntag').date?.from, '2026-11-15');
  assert.equal(parse('donnerstag').date?.from, '2026-11-12');
  assert.equal(parse('next thursday').date?.from, '2026-11-19');
  assert.equal(parse('im dezember').date?.from, '2026-12-01');
  assert.equal(parse('im dezember').date?.to, '2026-12-31');
  // Der laufende Monat beginnt heute, ein vergangener liegt im nächsten Jahr.
  assert.equal(parse('november').date?.from, '2026-11-12');
  assert.equal(parse('märz').date?.from, '2027-03-01');
  assert.equal(parse('14.11.').date?.from, '2026-11-14');
  assert.equal(parse('3.2.').date?.from, '2027-02-03');
  assert.equal(parse('14. november').date?.from, '2026-11-14');
  assert.equal(parse('nov 20').date?.from, '2026-11-20');
  assert.equal(parse('2026-12-24').date?.from, '2026-12-24');
  assert.equal(parse('31.2.').date, undefined);
});

test('Tageszeit, auch mit „am" und „heute abend"', () => {
  const parsed = parse('heute abend');
  assert.equal(parsed.date?.from, '2026-11-12');
  assert.deepEqual(parsed.times?.values, ['evening']);
  assert.deepEqual(parse('tonight').times?.values, ['evening']);
  assert.deepEqual(parse('freitag nacht').times?.values, ['night']);
  assert.deepEqual(parse('am nachmittag').times?.values, ['day']);
});

test('Preise: kostenlos, Höchstbetrag, günstig – „bis 20 Uhr" ist keiner', () => {
  assert.equal(parse('kostenlos').price?.free, true);
  assert.equal(parse('eintritt frei').price?.free, true);
  assert.equal(parse('unter 20').price?.max, 20);
  assert.equal(parse('bis 25 euro').price?.max, 25);
  assert.equal(parse('under £15').price?.max, 15);
  assert.equal(parse('günstig').price?.cheap, true);
  assert.equal(parse('bis 20 uhr').price, undefined);
  assert.equal(parse('für 2 personen').price, undefined);
});

test('Karten, Kinder, Stadt', () => {
  assert.ok(parse('noch karten').tickets);
  assert.ok(parse('nicht ausverkauft').tickets);
  assert.ok(parse('für kinder').kids);
  assert.ok(parse('family').kids);
  assert.equal(parse('in glasgow').city?.id, 'glasgow');
  assert.equal(parse('munich').city?.id, 'muenchen');
  assert.equal(parse('dusseldorf').city?.id, 'duesseldorf');
});

test('Genannte Art wird verbraucht, angedeutete bleibt Suchwort', () => {
  const named = parse('theater mit simon rattle');
  assert.deepEqual(named.categories?.values, ['Theater']);
  assert.deepEqual(named.words, ['simon', 'rattle']);

  const hinted = parse('jazz');
  assert.equal(hinted.categories, undefined);
  assert.deepEqual(hinted.hints, ['Konzert']);
  assert.deepEqual(hinted.words, ['jazz']);

  assert.deepEqual(parse('opera').categories?.values, ['Oper']);
  assert.deepEqual(parse('stand-up comedy').categories?.values, ['Comedy']);
  assert.deepEqual(parse('stand-up comedy').words, []);
});

test('Vage Anfragen: Wetter und Anlass werden erkannt, nicht gesucht', () => {
  const rain = parse('für die kinder wenn es regnet');
  assert.ok(rain.kids);
  assert.ok(rain.vague);
  assert.deepEqual(rain.words, []);

  const date = parse('something romantic for a date');
  assert.ok(date.evening);
  assert.ok(date.vague);
  assert.deepEqual(date.words, ['romantic']);
});

test('„show me" ist keine Show', () => {
  const parsed = parse('show me jazz');
  assert.equal(parsed.categories, undefined);
  assert.deepEqual(parsed.words, ['jazz']);
});

test('Fürs Embedding fallen Zeitraum, Preis und Stadt weg, der Rest bleibt', () => {
  assert.equal(parse('etwas romantisches in münchen heute abend').semanticText, 'etwas romantisches');
});

test('Eine Angabe lässt sich über ihre Stellen aus der Anfrage entfernen', () => {
  const query = 'konzerte dieses wochenende unter 30 €';
  const parsed = parse(query);
  assert.equal(removeSpans(query, parsed.date!.spans), 'konzerte unter 30 €');
  assert.equal(removeSpans(query, parsed.price!.spans), 'konzerte dieses wochenende');
});
