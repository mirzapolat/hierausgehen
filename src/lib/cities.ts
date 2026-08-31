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
}

export const cities: City[] = [
  { id: 'muenchen', name: 'München', shortName: 'MUC', timeZone: 'Europe/Berlin', country: 'DE' },
];

export const DEFAULT_CITY_ID = 'muenchen';

export function cityById(id: string): City {
  return cities.find((c) => c.id === id) ?? cities[0];
}
