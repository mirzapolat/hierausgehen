import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Strukturierte Daten für Suchmaschinen (schema.org).
 *
 * Neben der Beschreibung der Seite selbst werden die kommenden Termine als
 * `Event` ausgezeichnet. Angegeben wird nur, was die Quellen wirklich hergeben –
 * fehlt eine Angabe, bleibt das Feld weg, statt geraten zu werden.
 */

const AVAILABILITY: Record<string, string | undefined> = {
  available: 'https://schema.org/InStock',
  limited: 'https://schema.org/LimitedAvailability',
  soldout: 'https://schema.org/SoldOut',
};

/** Genug für die Suche, ohne die Seite mit Datenmüll aufzublähen. */
const MAX_EVENTS = 60;

export function StructuredData({
  events,
  definitions,
}: {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
}) {
  // Serverkomponente auf einer dynamischen Seite: die Uhr zu lesen ist hier
  // genau richtig, es gibt kein erneutes Rendern mit anderem Ergebnis.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const upcoming = events
    .filter((event) => Date.parse(event.start) >= now)
    .slice(0, MAX_EVENTS)
    .map((event) => eventSchema(event, definitions));

  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      inLanguage: 'de-DE',
      description:
        'Kalender für Veranstaltungen in München: Oper, Ballett, Theater und Konzert an einem Ort.',
    },
    ...upcoming,
  ];

  return (
    <script
      type="application/ld+json"
      // Nur selbst erzeugte Daten; der Inhalt stammt aus dem eigenen Modell.
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) }}
    />
  );
}

function eventSchema(event: CalendarEvent, definitions: SourceDefinition[]) {
  const source = definitions.find((d) => d.id === event.sourceId);
  const availability = AVAILABILITY[event.availability];

  return {
    '@type': 'Event',
    '@id': `${SITE_URL}/#event-${event.id}`,
    name: event.title,
    ...(eventDescription(event) ? { description: eventDescription(event) } : {}),
    startDate: event.start,
    ...(event.end ? { endDate: event.end } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.venue.name,
      // Adressen führen die Quellen nicht; nur eine bekannte Stadt wird genannt.
      ...(event.venue.city
        ? { address: { '@type': 'PostalAddress', addressLocality: event.venue.city } }
        : {}),
    },
    url: event.url,
    ...(source ? { organizer: { '@type': 'Organization', name: source.name, url: source.homepage } } : {}),
    ...(event.ticketUrl && availability
      ? { offers: { '@type': 'Offer', url: event.ticketUrl, availability } }
      : {}),
  };
}

function eventDescription(event: CalendarEvent): string | undefined {
  return [event.subtitle, event.description].filter(Boolean).join('\n\n') || undefined;
}
