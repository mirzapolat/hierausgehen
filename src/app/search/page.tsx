import type { Metadata } from 'next';
import { SearchScreen } from '@/components/SearchScreen';
import { DEFAULT_CITY_ID, isKnownCityId } from '@/lib/cities';
import { sourcesForCity } from '@/lib/events/registry';
import { toPayload, type SearchPayload } from '@/lib/search/api';
import { runSearch } from '@/lib/search/service';
import { SITE_NAME, pageTitle } from '@/lib/site';

export const dynamic = 'force-dynamic';

const DESCRIPTION =
  'Konzerte, Theater, Oper, Lesungen und Partys in einer Suche: nach Name, Art, Tag, Preis oder Stimmung – aus den Programmen der Häuser, täglich aktuell.';

export async function generateMetadata({ searchParams }: PageProps<'/search'>): Promise<Metadata> {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.trim() : '';
  const title = query ? query : 'Veranstaltungen suchen';
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: '/search' },
    // Trefferseiten sind Momentaufnahmen, keine Seiten für den Index.
    ...(query ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: 'website',
      locale: 'de_DE',
      siteName: SITE_NAME,
      title: pageTitle(title),
      description: DESCRIPTION,
      url: '/search',
    },
    twitter: { card: 'summary_large_image', title: pageTitle(title), description: DESCRIPTION },
  };
}

/**
 * Die Suche. Mit `?q=` rechnet der Server die ersten Treffer gleich mit –
 * ein geteilter Suchlink zeigt sofort etwas, ohne leeren Zwischenstand.
 */
export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const { q, city } = await searchParams;
  const query = typeof q === 'string' ? q.slice(0, 200) : '';
  const cityId = typeof city === 'string' && isKnownCityId(city) ? city : DEFAULT_CITY_ID;

  let initialData: SearchPayload | undefined;
  if (query.trim()) {
    const response = await runSearch({ query, cityId, limit: 300 });
    initialData = toPayload(response, sourcesForCity(response.cityId).map((source) => source.definition));
  }

  return <SearchScreen initialQuery={query} initialData={initialData} />;
}
