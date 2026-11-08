import { cities, cityById, type City } from './cities.ts';
import { sourcesForCity } from './events/registry.ts';
import { cityTitle } from './site.ts';
import { createFormatter } from './format';
import type { CalendarEvent } from './events/types.ts';

/**
 * Städte, für die schon Quellen eingebunden sind.
 *
 * Eine Stadt darf ohne Quellen in `cities.ts` stehen – auswählbar ist sie dann
 * schon, nach aussen beworben noch nicht: Seitentitel, Suchbegriffe und
 * Sitemap nennen nur, was der Kalender auch zeigen kann.
 */
export const servedCities: City[] = cities.filter((city) => hasSources(city.id));

export function hasSources(cityId: string): boolean {
  return sourcesForCity(cityId).length > 0;
}

/** „München, Glasgow und Oldenburg“ – folgt der Liste in `cities.ts`. */
export const CITY_NAMES = listOf(servedCities.map((city) => city.name));
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
  ...servedCities.map((city) => `Veranstaltungen ${city.name}`),
  ...servedCities.flatMap((city) => TOPICS.map((topic) => `${topic} ${city.name}`)),
  'Spielplan',
  'Termine',
  'Tickets',
];

function listOf(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`;
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
    // Ohne Quellen keine Versprechen: „aus 0 Häusern“ hilft niemandem.
    description:
      count === 0
        ? `Veranstaltungen in ${city.name} in einem Kalender — die ersten Häuser werden gerade eingebunden.`
        : `Veranstaltungen in ${city.name} in einem Kalender: Oper, Ballett, Theater, ` +
          `Konzert, Club, Kino und Literatur aus ${count} Häusern — mit Datum, Spielstätte ` +
          'und Ticketverfügbarkeit, täglich aktualisiert.',
  };
}

/** So lang darf der Ausschnitt aus dem Programmtext in der Vorschau werden. */
const EXCERPT_LENGTH = 160;

/**
 * Titel und Beschreibung eines geteilten Termins – das, was Messenger und
 * soziale Netze in der Linkvorschau zeigen.
 *
 * Bewusst knapp: der Name als Titel, darunter Datum, Ort und Stadt in einer
 * Zeile und ein Anfang des Programmtexts. Fehlt der Text, bleibt es bei der
 * Zeile – nichts wird dazu erfunden.
 */
export function eventMetadata(event: CalendarEvent, cityId: string): { title: string; description: string } {
  const city = cityById(cityId);
  const format = createFormatter({ locale: 'de', timeZone: city.timeZone, hour12: false });

  const day = event.allDay ? event.start.slice(0, 10) : format.localDay(event.start);
  const when = event.allDay ? format.dayLong(day) : `${format.dayLong(day)}, ${format.time(event.start)} Uhr`;
  const place = [event.venue.name, event.venue.city ?? city.name]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(', ');
  const excerpt = excerptOf(event.description ?? event.subtitle);

  return {
    title: event.title,
    description: [`${when} · ${place}`, excerpt].filter(Boolean).join(' — '),
  };
}

/** Der Anfang eines Texts, an einer Wortgrenze gekürzt. */
function excerptOf(text: string | undefined): string | undefined {
  const flat = text?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  if (flat.length <= EXCERPT_LENGTH) return flat;
  const cut = flat.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, '')} …`;
}
