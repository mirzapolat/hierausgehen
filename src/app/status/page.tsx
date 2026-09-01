import type { Metadata } from 'next';
import { StatusScreen } from '@/components/StatusScreen';
import { DEFAULT_CITY_ID, cityById, isKnownCityId } from '@/lib/cities';
import { getSnapshot, snapshotRange } from '@/lib/events/snapshot';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Datenstand der eingebundenen Quellen.',
  robots: { index: false, follow: false },
};

export default async function StatusPage({ searchParams }: PageProps<'/status'>) {
  const params = await searchParams;
  const requested = typeof params.city === 'string' ? params.city : DEFAULT_CITY_ID;
  const cityId = isKnownCityId(requested) ? requested : DEFAULT_CITY_ID;
  const range = snapshotRange(cityId);
  const data = await getSnapshot(cityId);

  return <StatusScreen data={data} range={range} cityName={cityById(cityId).name} />;
}
