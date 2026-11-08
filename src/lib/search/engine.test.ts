import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CalendarEvent, SourceDefinition } from '../events/types.ts';
import { buildSearchIndex, search, localClock } from './engine.ts';
import { priceOf } from './document.ts';
import { parseQuery } from './parse.ts';

/*
 * Rangfolge gegen einen echten Ausschnitt des Münchner Bestands
 * (`__fixtures__/muenchen-2026-11-08.json`, Abzug der Live-Seite). „Jetzt" ist
 * der Zeitpunkt des Abzugs: Sonntag, 8. November 2026, kurz vor 18 Uhr.
 */
const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/muenchen-2026-11-08.json', import.meta.url), 'utf8'),
) as { pulledAt: string; events: CalendarEvent[]; definitions: SourceDefinition[] };

const now = new Date(fixture.pulledAt);
const timeZone = 'Europe/Berlin';
const index = buildSearchIndex(fixture.events, fixture.definitions, { cityId: 'muenchen', timeZone });
const run = (query: string, options: { similarity?: Float32Array } = {}) =>
  search(index, parseQuery(query, { now, timeZone }), { now, ...options });
const text = (event: CalendarEvent) => [event.title, event.subtitle, event.description].join(' ');

test('Ein Name findet genau die Abende, an denen er steht', () => {
  const result = run('simon rattle');
  assert.ok(result.hits.length >= 3);
  for (const hit of result.hits.slice(0, 3)) assert.match(text(hit.event), /Rattle/);
  assert.ok(result.lambda > 0.8, 'seltene Wörter: der Text entscheidet');
});

test('„Theater mit Simon Rattle": der Name schlägt die genannte Art', () => {
  const [first] = run('theater mit simon rattle').hits;
  assert.match(text(first.event), /Rattle/);
  assert.equal(first.event.category, 'Konzert');
});

test('Ein Tippfehler findet den Namen trotzdem', () => {
  const [first] = run('ratle').hits;
  assert.match(text(first.event), /Rattle/);
});

test('Jeder Termin steht für sich – auch bei einer Reihe, aber keiner doppelt', () => {
  const hits = run('musical').hits;
  const keys = hits.map((hit) => hit.key);
  assert.equal(new Set(keys).size, keys.length);
  // Eine Reihe mit mehreren Terminen liefert mehrere Zeilen.
  assert.ok(hits.some((hit) => hit.matching > 1 && hits.filter((other) => other.event.title === hit.event.title).length > 1));
});

test('Stöbern nach Art und Zeitraum: nur diese Art, nur dieser Zeitraum', () => {
  const result = run('konzerte nächste woche');
  const clock = localClock(timeZone);
  assert.equal(result.mode, 'browse');
  assert.ok(result.hits.length > 5);
  for (const hit of result.hits.filter((hit) => hit.tier === 0)) assert.equal(hit.event.category, 'Konzert');
  for (const hit of result.hits) {
    const day = clock(hit.event.start).day;
    assert.ok(day >= '2026-11-09' && day <= '2026-11-15', `${hit.event.title} am ${day}`);
  }
  // Erst die Art selbst, dann Verwandte.
  const tiers = result.hits.map((hit) => hit.tier);
  assert.deepEqual(tiers, [...tiers].sort());
});

test('„Freitag nacht" schliesst den Donnerstag aus und die Nacht auf Samstag ein', () => {
  const clock = localClock(timeZone);
  for (const hit of run('party freitag nacht').hits) {
    const { day, minutes } = clock(hit.event.start);
    assert.ok(day === '2026-11-13' || (day === '2026-11-14' && minutes < 5 * 60), `${hit.event.title} am ${day}`);
  }
});

test('Kostenlos: nie ein Termin mit Preis', () => {
  const result = run('kostenlos');
  assert.ok(result.hits.length > 0);
  for (const hit of result.hits) {
    const price = priceOf(hit.event);
    assert.ok(price.free || price.min === undefined, `${hit.event.title}: ${price.min}`);
  }
  // Bestätigt freier Eintritt steht vor „unbekannt".
  assert.ok(priceOf(result.hits[0].event).free);
});

test('Ein unbekanntes Wort fällt zuerst weg, nicht Tag und Art', () => {
  const result = run('xyzzy konzerte heute');
  assert.deepEqual(result.relaxed, ['text']);
  const clock = localClock(timeZone);
  for (const hit of result.hits) {
    assert.equal(hit.event.category, 'Konzert');
    assert.equal(clock(hit.event.start).day, '2026-11-08');
  }
});

test('Gibt es nichts, wird gelockert – und gesagt, was', () => {
  const result = run('kindertheater sonntag');
  assert.ok(result.relaxed.includes('date'));
  assert.ok(result.hits.length > 0);
});

test('Was schon läuft, ist kein Vorschlag mehr', () => {
  for (const hit of run('konzert heute').hits) {
    assert.ok(Date.parse(hit.event.start) >= now.getTime() - 30 * 60_000 || hit.event.allDay, hit.event.title);
  }
});

test('Bedeutung: ein deutlich ähnliches Dokument kommt ohne gemeinsames Wort in die Treffer', () => {
  // Ein erfundener Ähnlichkeitsvektor statt des Modells: ein Termin ragt
  // heraus, alle anderen liegen im Rauschen.
  const target = index.docs.findIndex((doc) => /Momo/.test(doc.fields.title));
  assert.ok(target >= 0);
  const similarity = new Float32Array(index.docs.length).map((_, i) => 0.8 + ((i * 7919) % 100) / 10_000);
  similarity[target] = 0.95;

  const result = run('something romantic for a date', { similarity });
  assert.ok(result.semantic);
  assert.ok(result.alpha >= 0.4, 'eine Stimmung: die Bedeutung zählt deutlich mit');
  assert.ok(result.hits.slice(0, 5).some((hit) => /Momo/.test(hit.event.title)));

  // Bei einem Namen bleibt die Wortsuche vorn, auch wenn die Bedeutung woanders hinzeigt.
  const named = run('simon rattle', { similarity });
  assert.ok(named.alpha <= 0.3);
  assert.match(text(named.hits[0].event), /Rattle/);
});
