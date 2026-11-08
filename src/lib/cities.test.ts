import assert from 'node:assert/strict';
import test from 'node:test';
import { cities, cityById, nearestCity, resolveCity, type City } from './cities.ts';

const testCities: City[] = [
  {
    id: 'west',
    name: 'Weststadt',
    shortName: 'WST',
    country: 'DE',
    timeZone: 'Europe/Berlin',
    coordinates: { latitude: 50, longitude: 6 },
  },
  {
    id: 'east',
    name: 'Oststadt',
    shortName: 'OST',
    country: 'DE',
    timeZone: 'Europe/Berlin',
    coordinates: { latitude: 50, longitude: 14 },
  },
];

test('findet die naechste Stadt anhand der Koordinaten', () => {
  assert.equal(nearestCity({ latitude: 50.2, longitude: 13.6 }, testCities).id, 'east');
  assert.equal(nearestCity({ latitude: 50.1, longitude: 6.4 }, testCities).id, 'west');
});

test('unbekannte Stadt faellt auf die Standardstadt zurueck', () => {
  assert.equal(cityById('unbekannt').id, 'muenchen');
});

test('Deeplink schlaegt die zuletzt geoeffnete Stadt', () => {
  const choice = resolveCity({ urlCityId: 'glasgow', storedCityId: 'muenchen' });
  assert.deepEqual(choice, { status: 'known', cityId: 'glasgow', from: 'url' });
});

test('ohne Deeplink gilt die zuletzt geoeffnete Stadt', () => {
  const choice = resolveCity({ urlCityId: null, storedCityId: 'glasgow' });
  assert.deepEqual(choice, { status: 'known', cityId: 'glasgow', from: 'stored' });
});

test('unbekannte Angaben zaehlen nicht', () => {
  assert.deepEqual(resolveCity({ urlCityId: 'atlantis', storedCityId: 'muenchen' }), {
    status: 'known',
    cityId: 'muenchen',
    from: 'stored',
  });
  assert.deepEqual(resolveCity({ urlCityId: 'atlantis', storedCityId: 'atlantis' }), {
    status: 'unresolved',
  });
});

test('ohne Vorwissen bleibt die Stadt offen', () => {
  assert.deepEqual(resolveCity({}), { status: 'unresolved' });
});

test('Kennungen und Kürzel der Städte sind eindeutig', () => {
  assert.equal(new Set(cities.map((city) => city.id)).size, cities.length);
  assert.equal(new Set(cities.map((city) => city.shortName)).size, cities.length);
  for (const city of cities) {
    assert.match(city.id, /^[a-z-]+$/, `URL-taugliche Kennung: ${city.id}`);
    // Wirft bei einer unbekannten Zeitzone.
    new Intl.DateTimeFormat('de-DE', { timeZone: city.timeZone });
  }
});

test('jede Stadt ist an ihrem eigenen Mittelpunkt die nächste', () => {
  // Jede Stadt muss an ihrem eigenen Mittelpunkt die nächste sein – sonst
  // stimmen Koordinaten nicht. Freising liegt nur gut 30 km von München.
  for (const city of cities) {
    assert.equal(nearestCity(city.coordinates).id, city.id);
  }
});
