import type { Metadata } from 'next';
import { CalendarApp } from '@/components/CalendarApp';
import { StructuredData } from '@/components/StructuredData';
import { eventsInRange } from '@/lib/events/snapshot';
import { todayInZone } from '@/lib/events/schedule';
import { coverageRange, loadRange } from '@/lib/calendar';
import { DEFAULT_CITY_ID, cityById, isKnownCityId } from '@/lib/cities';
import { SITE_NAME, cityMetadata, cityPath } from '@/lib/site';

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
  const cityId = requestedCityId(await searchParams);
  const { title, description } = cityMetadata(cityId);
  const canonical = cityPath(cityId);

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
    <>
      <StructuredData cityId={cityId} events={data.events} definitions={data.definitions} />
      <CalendarApp
        initialData={data}
        initialRange={range}
        initialCityId={cityId}
        initialAnchor={today}
      />
    </>
  );
}
