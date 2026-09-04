/**
 * Städte.
 *
 * Eine Stadt bündelt Quellen und liefert die Standard-Zeitzone. Weitere Städte
 * kommen hinzu, indem sie hier eingetragen und Quellen mit der passenden
 * `cityId` registriert werden – die Oberfläche zieht die Auswahl automatisch nach.
 */

export interface City {
  id: string;
  name: string;
  shortName: string;
  /** IANA-Zeitzone, in der die Termine der Stadt stattfinden. */
  timeZone: string;
  country: string;
  /** Stadtzentrum fuer die automatische Auswahl der naechsten Stadt. */
  coordinates: GeoPoint;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export const cities: City[] = [
  {
    id: 'muenchen',
    name: 'München',
    shortName: 'MUC',
    timeZone: 'Europe/Berlin',
    country: 'DE',
    coordinates: { latitude: 48.137154, longitude: 11.576124 },
  },
  {
    id: 'glasgow',
    name: 'Glasgow',
    shortName: 'GLA',
    timeZone: 'Europe/London',
    country: 'GB',
    coordinates: { latitude: 55.860916, longitude: -4.251433 },
  },
];

export const DEFAULT_CITY_ID = 'muenchen';

export function isKnownCityId(id: string): boolean {
  return cities.some((city) => city.id === id);
}

export function cityById(id: string): City {
  return cities.find((c) => c.id === id) ?? cities[0];
}

export function nearestCityId(point: GeoPoint, candidates: City[] = cities): string {
  return nearestCity(point, candidates).id;
}

export function nearestCity(point: GeoPoint, candidates: City[] = cities): City {
  if (candidates.length === 0) throw new Error('Keine Städte registriert');
  return candidates
    .map((city) => ({ city, distance: distanceKm(point, city.coordinates) }))
    .sort((a, b) => a.distance - b.distance)[0].city;
}

/** Luftlinie zwischen zwei Punkten in Kilometern. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const earthRadiusKm = 6371;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
