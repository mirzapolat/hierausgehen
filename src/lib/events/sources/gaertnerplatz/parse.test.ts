import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEventList, parseSparten } from './parse.ts';

const dir = path.join(import.meta.dirname, '__fixtures__');
const fixture = (name: string) => readFileSync(path.join(dir, name), 'utf8');

/** Die Sparte, unter der die jeweilige Seite geholt wurde. */
const musical = fixture('sparte-musical-2026-09.html');
const musicalSeite2 = fixture('sparte-musical-2026-09-seite-2.html');
const liederabend = fixture('sparte-liederabend-2026-09.html');

test('liest eine volle Seite der Terminliste', () => {
  const result = parseEventList(musical, 'Musical');

  assert.equal(result.blocks, 10, 'eine Seite fasst zehn Termine');
  assert.equal(result.events.length, 10);
  assert.equal(result.skipped, 0);
  assert.equal(result.end, false, 'eine volle Seite ist nicht die letzte');
  assert.equal(result.sessionLost, false);
});

test('die letzte Seite meldet sich selbst', () => {
  const result = parseEventList(musicalSeite2, 'Musical');

  assert.equal(result.events.length, 3);
  assert.equal(result.end, true, '<li id="listend"> beendet die Sparte');
});

test('normalisiert einen Termin vollständig', () => {
  const events = parseEventList(musical, 'Musical').events;
  const event = events.find((e) => e.id === 'gaertnerplatz:42568');

  assert.ok(event, 'Termin 42568 muss in der Liste stehen');
  assert.equal(event.sourceId, 'gaertnerplatz');
  assert.equal(event.title, 'Les Misérables', 'Versalien werden geglättet');
  assert.equal(event.subtitle, 'Musical von Claude-Michel Schönberg');
  assert.equal(event.category, 'Musical');
  assert.equal(event.start, '2026-09-26T19:00:00+02:00');
  assert.equal(event.end, undefined, 'der Shop führt keine Endzeiten');
  assert.equal(event.allDay, false);
  assert.deepEqual(event.venue, { name: 'Gärtnerplatztheater' });
  assert.equal(event.availability, 'limited');
  assert.equal(event.availabilityLabel, 'Restkarten');
  assert.equal(
    event.ticketUrl,
    'https://tickets.staatstheater.bayern/gpt.webshop/webticket/selectseat?eventId=42568&el=true',
  );
  assert.equal(event.url, event.ticketUrl, 'ohne eigene Seite ist der Shop der Link');
});

test('bildet die Ticketlage aus Element und Beschriftung ab', () => {
  const events = [
    ...parseEventList(musical, 'Musical').events,
    ...parseEventList(musicalSeite2, 'Musical').events,
  ];

  const zustand = (id: string) => events.find((e) => e.id === `gaertnerplatz:${id}`)?.availability;

  // "Ausverkauft" steht in einem <a> ohne href innerhalb span#soldtext –
  // wer nur auf a[href] prüft, hielte es für buchbar.
  assert.equal(zustand('42567'), 'soldout');
  assert.equal(zustand('42570'), 'soldout');
  assert.equal(zustand('42568'), 'limited');
  assert.equal(zustand('42562'), undefined, 'die Oper gehört nicht in die Sparte Musical');

  const verteilung = new Map<string, number>();
  for (const event of events) {
    verteilung.set(event.availability, (verteilung.get(event.availability) ?? 0) + 1);
  }
  assert.equal(verteilung.get('soldout'), 5);
  assert.equal(verteilung.get('limited'), 3);
  assert.equal(verteilung.get('available'), 5);
  assert.equal(verteilung.get('unknown'), undefined, 'jeder Termin hat ein Ticketsignal');
});

test('vergibt eindeutige IDs aus dem eventKey', () => {
  const events = [
    ...parseEventList(musical, 'Musical').events,
    ...parseEventList(musicalSeite2, 'Musical').events,
    ...parseEventList(liederabend, 'Liederabend').events,
  ];

  const ids = events.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(
    ids.every((id) => /^gaertnerplatz:\d+$/.test(id)),
    'die ID kommt aus dem eventKey, nicht aus einem Slug',
  );
});

test('eine Sparte mit einem einzigen Termin ist vollständig', () => {
  const result = parseEventList(liederabend, 'Liederabend');

  assert.equal(result.events.length, 1);
  assert.equal(result.end, true);
  assert.equal(result.events[0].category, 'Liederabend');
  assert.equal(result.events[0].venue.name, 'Foyer', 'die Nebenspielstätte steht am Termin');
  assert.equal(
    result.events[0].start,
    '2026-10-31T15:00:00+01:00',
    'nach der Zeitumstellung – der Offset kommt aus der Zeitzone, nicht aus dem Code',
  );
});

test('ohne Sparte bleibt die Gattung leer, statt geraten zu werden', () => {
  const [event] = parseEventList(liederabend).events;
  assert.equal(event.category, undefined);
});

test('eine Sparte ohne Termine im Zeitraum ist leer, nicht kaputt', () => {
  const result = parseEventList(fixture('sparte-leer-2027-06.html'), 'Ballett');

  assert.deepEqual(result.events, []);
  assert.equal(result.blocks, 0);
  assert.equal(result.end, true, 'der Shop meldet das Ende auch ohne Termin');
  assert.equal(result.sessionLost, false, 'leer ist kein Sitzungsproblem');
});

test('die Fehlerseite des Shops ist als verlorene Sitzung erkennbar', () => {
  const result = parseEventList(fixture('sitzung-abgelaufen.html'), 'Musical');

  assert.equal(result.sessionLost, true);
  assert.deepEqual(result.events, []);
  assert.equal(result.blocks, 0);
  assert.equal(result.end, false, 'eine Fehlerseite ist kein Listenende');
});

test('liest die Sparten aus dem Filter der Shop-Seite', () => {
  const sparten = parseSparten(fixture('eventlist-2026-09.html'));

  assert.deepEqual(
    sparten,
    [
      { id: '2', name: 'Ballett' },
      { id: '8', name: 'Konzert' },
      { id: '15', name: 'Liederabend' },
      { id: '4', name: 'Musical' },
      { id: '1', name: 'Oper' },
      { id: '3', name: 'Operette' },
      { id: '17', name: 'Soiree' },
      { id: '99', name: 'Sonstiges' },
    ],
    '"alle Sparten" ist keine Gattung und fällt weg',
  );
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  for (const html of ['', '   ', '<li>', '<div id="eventKey:1"></div>', '<html><body>?']) {
    const result = parseEventList(html, 'Musical');
    assert.deepEqual(result.events, [], `unbrauchbar: ${JSON.stringify(html)}`);
  }

  // Ein Block ohne Titel und Datum ist kein Termin, aber ein Hinweis darauf,
  // dass sich etwas geändert hat – deshalb gezählt, nicht verschluckt.
  const angeschlagen = parseEventList('<div id="eventKey:1"><h2></h2></div>');
  assert.equal(angeschlagen.blocks, 1);
  assert.equal(angeschlagen.skipped, 1);

  assert.deepEqual(parseSparten(''), []);
});
