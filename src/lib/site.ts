import { cities, cityById } from './cities.ts';
import { sourcesForCity } from './events/registry.ts';

/** Feste Angaben zur Seite – von Layout, Sitemap und strukturierten Daten genutzt. */
export const SITE_URL = 'https://hierausgehen.de';
export const SITE_NAME = 'HIERAUSGEHEN.de';
export const SITE_TITLE = 'Veranstaltungskalender für München und Glasgow';
export const SITE_DESCRIPTION =
  'Ein Kalender für alle Veranstaltungen in München und Glasgow: Oper, Ballett, Theater, ' +
  'Konzert, Club, Kino und Literatur aus vielen Häusern an einem Ort — mit Datum, ' +
  'Spielstätte und Ticketverfügbarkeit.';

/**
 * Umami – die selbst gehostete Zählung der Zugriffe.
 *
 * `ANALYTICS_DOMAINS` ist eine Erlaubnisliste im Browser: das Skript meldet
 * nur, wenn der Hostname darin steht. So bleiben lokale Läufe aus der
 * Statistik heraus.
 */
export const ANALYTICS_SCRIPT = 'https://umami.mirzapolat.com/script.js';
export const ANALYTICS_WEBSITE_ID = 'be5506d3-65af-439f-b2df-c4ac9d4ca158';
export const ANALYTICS_DOMAINS = 'hierausgehen.de,www.hierausgehen.de';

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

/** Der Titel im Browser: erst die Stadt, dann die Seite. */
export function cityTitle(cityName: string): string {
  return `${cityName} ${SITE_NAME}`;
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
    // Die Stadt steht vorn, der Name der Seite dahinter – so ist im Tab schon
    // an den ersten Zeichen zu sehen, welcher Kalender offen ist.
    title: cityTitle(city.name),
    description:
      `Alle Veranstaltungen in ${city.name} in einem Kalender: Oper, Ballett, Theater, ` +
      `Konzert, Club, Kino und Literatur aus ${count} Häusern — mit Datum, Spielstätte ` +
      'und Ticketverfügbarkeit, täglich aktualisiert.',
  };
}
