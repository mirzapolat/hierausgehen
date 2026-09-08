import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { cityById } from '@/lib/cities';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, cityMetadata, cityUrl } from '@/lib/site';

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
  cityId,
  events,
  definitions,
  pageUrl,
}: {
  cityId: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  pageUrl?: string;
}) {
  const city = cityById(cityId);
  const url = pageUrl ?? cityUrl(city.id);
  const { title, description } = cityMetadata(city.id);
  // Serverkomponente auf einer dynamischen Seite: die Uhr zu lesen ist hier
  // genau richtig, es gibt kein erneutes Rendern mit anderem Ergebnis.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const upcoming = events
    // Die Programmseite übergibt genau ihre sichtbare Auswahl.
    .filter((event) => pageUrl || Date.parse(event.start) >= now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, MAX_EVENTS)
    .map((event) => eventSchema(event, city.name, definitions));

  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      inLanguage: 'de-DE',
      description: SITE_DESCRIPTION,
    },
    {
      '@type': 'CollectionPage',
      '@id': `${url}#page`,
      url,
      name: title,
      description,
      inLanguage: 'de-DE',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: {
        '@type': 'City',
        name: city.name,
        geo: {
          '@type': 'GeoCoordinates',
          latitude: city.coordinates.latitude,
          longitude: city.coordinates.longitude,
        },
      },
      // Die Termine hängen an der Seite, statt frei im Graphen zu stehen.
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: upcoming.map((event, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: { '@id': event['@id'] },
        })),
      },
    },
    ...upcoming,
  ];

  return (
    <script
      type="application/ld+json"
      // Quelltexte dürfen den Script-Tag nicht vorzeitig schließen.
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c') }}
    />
  );
}

function eventSchema(event: CalendarEvent, cityName: string, definitions: SourceDefinition[]) {
  const source = definitions.find((d) => d.id === event.sourceId);
  const availability = AVAILABILITY[event.availability];

  return {
    '@type': 'Event',
    '@id': `${SITE_URL}/#event-${event.id}`,
    name: event.title,
    ...(eventDescription(event) ? { description: eventDescription(event) } : {}),
    startDate: event.allDay ? event.start.slice(0, 10) : event.start,
    ...(event.end ? { endDate: event.end } : {}),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.venue.name,
      // Adressen führen die Quellen nicht; genannt wird die Stadt der Quelle.
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.venue.city ?? cityName,
      },
      // Nur der nachträglich aufgelöste Punkt, nie ein geratener.
      ...(event.venue.place
        ? {
            geo: {
              '@type': 'GeoCoordinates',
              latitude: event.venue.place.point.latitude,
              longitude: event.venue.place.point.longitude,
            },
          }
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
