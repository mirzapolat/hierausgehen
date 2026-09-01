import { CalendarApp } from '@/components/CalendarApp';
import { StructuredData } from '@/components/StructuredData';
import { eventsInRange } from '@/lib/events/snapshot';
import { todayInZone } from '@/lib/events/schedule';
import { coverageRange, loadRange } from '@/lib/calendar';
import { DEFAULT_CITY_ID, cities, cityById } from '@/lib/cities';

export const dynamic = 'force-dynamic';

/**
 * Erstansicht serverseitig: der aktuelle Monat samt Folgemonat kommt direkt aus
 * dem täglichen Datenstand, ohne Umweg über die eigene API. Alles Weitere lädt
 * der Client über `/api/events` nach.
 */
export default async function Page({ searchParams }: PageProps<'/'>) {
  const params = await searchParams;
  const requested = typeof params.city === 'string' ? params.city : DEFAULT_CITY_ID;
  const cityId = cities.some((c) => c.id === requested) ? requested : DEFAULT_CITY_ID;

  // Der Server kennt die Einstellungen des Geräts nicht und nimmt die Zeitzone
  // der Stadt an; der Client lädt bei abweichender Einstellung nach.
  const today = todayInZone(cityById(cityId).timeZone);

  const range = loadRange(today, coverageRange(today));
  const data = await eventsInRange(cityId, range);

  return (
    <>
      <StructuredData events={data.events} definitions={data.definitions} />
      <CalendarApp
        initialData={data}
        initialRange={range}
        initialCityId={cityId}
        initialAnchor={today}
      />
    </>
  );
}
