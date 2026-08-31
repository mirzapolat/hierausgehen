import { CalendarApp } from '@/components/CalendarApp';
import { StructuredData } from '@/components/StructuredData';
import { aggregateEvents } from '@/lib/events/aggregate';
import { loadRange } from '@/lib/calendar';
import { DEFAULT_CITY_ID, cities, cityById } from '@/lib/cities';

export const dynamic = 'force-dynamic';

/**
 * Erstansicht serverseitig: der aktuelle Monat samt Nachbarmonaten wird direkt
 * aggregiert, ohne Umweg über die eigene API. Alles Weitere lädt der Client
 * über `/api/events` nach.
 */
export default async function Page({ searchParams }: PageProps<'/'>) {
  const params = await searchParams;
  const requested = typeof params.city === 'string' ? params.city : DEFAULT_CITY_ID;
  const cityId = cities.some((c) => c.id === requested) ? requested : DEFAULT_CITY_ID;

  // Der Server kennt die Einstellungen des Geräts nicht und nimmt die Zeitzone
  // der Stadt an; der Client lädt bei abweichender Einstellung nach.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: cityById(cityId).timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const range = loadRange('month', today);
  const data = await aggregateEvents(range, { cityId });

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
