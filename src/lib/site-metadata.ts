import { cityById } from './cities.ts';
import { sourcesForCity } from './events/registry.ts';
import { cityTitle } from './site.ts';

/**
 * Titel und Beschreibung einer Stadt.
 *
 * Die Zahl der Häuser kommt aus der Registry statt aus einem gepflegten Text –
 * eine neue Quelle aktualisiert die Beschreibung damit von selbst.
 */
export function cityMetadata(cityId: string): { title: string; description: string } {
  const city = cityById(cityId);
  const count = sourcesForCity(city.id).length;

  return {
    // Die Stadt steht vorn, der Name der Seite dahinter – so ist im Tab schon
    // an den ersten Zeichen zu sehen, welcher Kalender offen ist.
    title: cityTitle(city.name),
    description:
      `Veranstaltungen in ${city.name} in einem Kalender: Oper, Ballett, Theater, ` +
      `Konzert, Club, Kino und Literatur aus ${count} Häusern — mit Datum, Spielstätte ` +
      'und Ticketverfügbarkeit, täglich aktualisiert.',
  };
}
