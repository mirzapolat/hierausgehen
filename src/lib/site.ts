import { cities } from './cities.ts';

/**
 * Feste Angaben zur Seite – von Layout, Sitemap und strukturierten Daten genutzt.
 *
 * Bewusst ohne Registry: die Datei darf auch im Browser landen. Was die
 * Quellen braucht, steht in `site-metadata.ts`.
 */
export const SITE_URL = 'https://hierausgehen.de';
export const SITE_NAME = 'HIERAUSGEHEN.de';
/** „München, Glasgow und Oldenburg“ – folgt der Liste in `cities.ts`. */
export const CITY_NAMES = listOf(cities.map((city) => city.name));
export const SITE_TITLE = `Veranstaltungskalender für ${CITY_NAMES}`;
export const SITE_DESCRIPTION =
  `Ein Kalender für Veranstaltungen in ${CITY_NAMES}: Oper, Ballett, Theater, ` +
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
 * Jeder Titel im Browser hat dieselbe Form: vorn, was offen ist, dahinter
 * der Name der Seite. Der Mittelpunkt trennt, nie ein Gedankenstrich.
 */
export const TITLE_SEPARATOR = ' · ';

export function pageTitle(part: string): string {
  return `${part}${TITLE_SEPARATOR}${SITE_NAME}`;
}

/** Was im Tab vor dem Namen steht, solange der Kalender einer Stadt offen ist. */
export function cityTitle(cityName: string): string {
  return `Veranstaltungen in ${cityName}`;
}

/** Lesbare Programmübersicht, auch ohne JavaScript. */
export function programmePath(cityId: string): string {
  return `/veranstaltungen/${cityId}`;
}

function listOf(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`;
}
