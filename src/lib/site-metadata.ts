import { cityById } from './cities.ts';
import { sourcesForCity } from './events/registry.ts';
import { cityTitle } from './site.ts';
import { createFormatter } from './format';
import type { CalendarEvent } from './events/types.ts';

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
