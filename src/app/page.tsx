import type { Metadata } from 'next';
import { CalendarApp } from '@/components/CalendarApp';
import { StructuredData } from '@/components/StructuredData';
import { eventsInRange, getSnapshot } from '@/lib/events/snapshot';
import { todayInZone } from '@/lib/events/schedule';
import { coverageRange, loadRange } from '@/lib/calendar';
import { DEFAULT_CITY_ID, cityById, isKnownCityId } from '@/lib/cities';
import { SITE_NAME, cityPath, pageTitle } from '@/lib/site';
import { cityMetadata, eventMetadata } from '@/lib/site-metadata';

export const dynamic = 'force-dynamic';

/** Welche Stadt gemeint ist – unbekannte Angaben fallen auf die Standardstadt zurück. */
function requestedCityId(params: Record<string, string | string[] | undefined>): string {
  const requested = typeof params.city === 'string' ? params.city : DEFAULT_CITY_ID;
  return isKnownCityId(requested) ? requested : DEFAULT_CITY_ID;
}

/**
 * Titel und Beschreibung folgen der gewählten Stadt; die kanonische Adresse
 * zeigt auf denselben Ausschnitt, damit `?city=muenchen` und `/` nicht als
 * zwei Seiten gelten.
 *
 * `openGraph` und `twitter` ersetzen die Angaben des Layouts vollständig statt
 * sie zu ergänzen – deshalb stehen hier auch die Felder, die sich nicht ändern.
 */
export async function generateMetadata({ searchParams }: PageProps<'/'>): Promise<Metadata> {
  const params = await searchParams;
  const cityId = requestedCityId(params);
  const canonical = cityPath(cityId);

  // Ein geteilter Termin bringt seine eigene Vorschau mit. Die kanonische
  // Adresse bleibt die der Stadt – der Termin ist ein Ausschnitt, keine Seite.
  const event = await sharedEvent(cityId, params.event);
  if (event) {
    const { title, description } = eventMetadata(event, cityId);
    const shareTitle = pageTitle(title);
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        type: 'website',
        locale: 'de_DE',
        siteName: SITE_NAME,
        title: shareTitle,
        description,
        url: `/?${new URLSearchParams({ city: cityId, event: event.id })}`,
      },
      twitter: { card: 'summary_large_image', title: shareTitle, description },
    };
  }

  const { title, description } = cityMetadata(cityId);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      locale: 'de_DE',
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/** Der Termin aus `?event=` – nur aus dem Datenstand der Stadt, sonst keiner. */
async function sharedEvent(cityId: string, id: string | string[] | undefined) {
  if (typeof id !== 'string' || !id) return undefined;
  const snapshot = await getSnapshot(cityId);
  return snapshot.events.find((event) => event.id === id);
}

/**
 * Erstansicht serverseitig: der aktuelle Monat samt Folgemonat kommt direkt aus
 * dem täglichen Datenstand, ohne Umweg über die eigene API. Alles Weitere lädt
 * der Client über `/api/events` nach.
 */
export default async function Page({ searchParams }: PageProps<'/'>) {
  const cityId = requestedCityId(await searchParams);

  // Der Server kennt die Einstellungen des Geräts nicht und nimmt die Zeitzone
  // der Stadt an; der Client lädt bei abweichender Einstellung nach.
  const today = todayInZone(cityById(cityId).timeZone);

  const range = loadRange(today, coverageRange(today));
  const data = await eventsInRange(cityId, range);

  return (
    <div className="flex h-full flex-col">
      <StructuredData cityId={cityId} events={data.events} definitions={data.definitions} />
      <div className="min-h-0 flex-1">
        <CalendarApp
          initialData={data}
          initialRange={range}
          initialCityId={cityId}
          initialAnchor={today}
        />
      </div>
    </div>
  );
}
