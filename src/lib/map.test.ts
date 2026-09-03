import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterPlaces, type Place } from './map.ts';
import type { CalendarEvent } from './events/types.ts';

/** Nur die Felder, die das Zusammenfassen braucht. */
function place(key: string, latitude: number, longitude: number, events = 1): Place {
  return {
    key,
    name: key,
    latitude,
    longitude,
    events: Array.from(
      { length: events },
      (_, index) => ({ id: `${key}-${index}`, start: '2026-09-05T20:00:00+02:00', title: key }) as CalendarEvent,
    ),
    colors: ['#000'],
  };
}

// Die drei Häuser am Max-Joseph-Platz: keine 200 Meter auseinander.
const nationaltheater = place('nationaltheater', 48.13962, 11.57951);
const residenztheater = place('residenztheater', 48.14011, 11.57943);
const marstall = place('marstall', 48.14007, 11.58154);
// Weit weg, egal bei welcher Stufe.
const werkstattkino = place('werkstattkino', 48.13089, 11.57286);

test('fasst zusammen, was sich bei dieser Zoomstufe überdecken würde', () => {
  const pins = clusterPlaces([nationaltheater, residenztheater, marstall, werkstattkino], 12);

  assert.equal(pins.length, 2, 'die drei Häuser am Platz werden eine Nadel');
  assert.deepEqual(
    pins[0].places.map((member) => member.key),
    ['nationaltheater', 'residenztheater', 'marstall'],
  );
  assert.deepEqual(pins[1].places.map((member) => member.key), ['werkstattkino']);
  // Die Nadel sitzt in der Mitte ihrer Orte, nicht auf dem ersten.
  assert.ok(pins[0].latitude > 48.1396 && pins[0].latitude < 48.1402);
});

test('trennt sie wieder, sobald weit genug hineingezoomt ist', () => {
  const pins = clusterPlaces([nationaltheater, residenztheater, marstall, werkstattkino], 17);
  assert.deepEqual(pins.map((pin) => pin.places.length), [1, 1, 1, 1]);
});

test('führt die Termine der zusammengefassten Orte zusammen', () => {
  const pins = clusterPlaces([place('a', 48.14, 11.58, 2), place('b', 48.1401, 11.5801, 3)], 12);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].events.length, 5);
  // Der Schlüssel hängt an den Orten, nicht an der Zoomstufe: eine offene
  // Ortskarte überlebt damit einen Zoomschritt.
  assert.equal(pins[0].key, 'a+b');
});

test('lässt einen einzelnen Ort einen einzelnen Ort sein', () => {
  const pins = clusterPlaces([werkstattkino], 12);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].name, 'werkstattkino');
  assert.deepEqual(clusterPlaces([], 12), []);
});
