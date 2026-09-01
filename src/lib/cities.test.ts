import assert from 'node:assert/strict';
import test from 'node:test';
import { cityById, nearestCity, type City } from './cities.ts';

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
