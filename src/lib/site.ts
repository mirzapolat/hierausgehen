import { cities, cityById } from './cities.ts';
import { sourcesForCity } from './events/registry.ts';

/** Feste Angaben zur Seite – von Layout, Sitemap und strukturierten Daten genutzt. */
export const SITE_URL = 'https://hierausgehen.de';
export const SITE_NAME = 'HIERAUSGEHEN.DE';
export const SITE_TITLE = 'Veranstaltungskalender für München und Glasgow';
export const SITE_DESCRIPTION =
  'Ein Kalender für alle Veranstaltungen in München und Glasgow: Oper, Ballett, Theater, ' +
  'Konzert, Club, Kino und Literatur aus vielen Häusern an einem Ort — mit Datum, ' +
  'Spielstätte und Ticketverfügbarkeit.';

/**
 * Die Ordner der Sidebar sind zugleich die Begriffe, nach denen gesucht wird.
 * Bewusst kurz gehalten: eine lange Liste hilft keiner Suchmaschine, sie
 * verwässert nur, wovon die Seite wirklich handelt.
 */
const TOPICS = [
  'Oper',
  'Ballett',
  'Theater',
  'Konzert',
  'Club',
  'Kino',
  'Literatur',
];

export const SITE_KEYWORDS = [
  'Veranstaltungskalender',
  'Veranstaltungen',
  ...cities.map((city) => `Veranstaltungen ${city.name}`),
  ...cities.flatMap((city) => TOPICS.map((topic) => `${topic} ${city.name}`)),
  'Spielplan',
  'Termine',
  'Tickets',
];

/** Der Link auf eine Stadt – die Standardstadt liegt auf der Wurzel. */
export function cityPath(cityId: string): string {
  return cityId === cities[0].id ? '/' : `/?city=${cityId}`;
}

export function cityUrl(cityId: string): string {
  return new URL(cityPath(cityId), SITE_URL).toString();
}

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
    // Kurz genug, dass die Suche ihn ungekürzt zeigt, und mit dem Namen darin:
    // was gesucht wird, steht vorn, wer antwortet, hinten.
    title: `Veranstaltungskalender ${city.name} — ${SITE_NAME}`,
    description:
      `Alle Veranstaltungen in ${city.name} in einem Kalender: Oper, Ballett, Theater, ` +
      `Konzert, Club, Kino und Literatur aus ${count} Häusern — mit Datum, Spielstätte ` +
      'und Ticketverfügbarkeit, täglich aktualisiert.',
  };
}
