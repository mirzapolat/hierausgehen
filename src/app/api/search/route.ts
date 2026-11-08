import { NextResponse } from 'next/server';
import { DEFAULT_CITY_ID, isKnownCityId } from '@/lib/cities';
import { sourcesForCity } from '@/lib/events/registry';
import { toPayload } from '@/lib/search/api';
import { FACETS, type Facet } from '@/lib/search/engine';
import { runSearch } from '@/lib/search/service';

export const dynamic = 'force-dynamic';

/** Länger darf eine Anfrage nicht werden – eine Suche ist kein Aufsatz. */
const MAX_QUERY = 200;

/**
 * `GET /api/search?q=…&city=…[&ignore=date,price][&debug=1]`
 *
 * `ignore` schaltet erkannte Angaben ab, ohne den Suchtext zu ändern;
 * `debug` liefert je Treffer die Zerlegung der Bewertung.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get('q') ?? '').slice(0, MAX_QUERY);
  const cityId = params.get('city') ?? DEFAULT_CITY_ID;
  if (!isKnownCityId(cityId)) {
    return NextResponse.json({ error: `Unbekannte Stadt "${cityId}".` }, { status: 400 });
  }
  const ignore = (params.get('ignore') ?? '')
    .split(',')
    .filter((facet): facet is Facet => (FACETS as readonly string[]).includes(facet));

  // Bis 300 Treffer – jeder Termin ist einer, auch bei Reihen. Liste und
  // Kalender zeigen dieselbe Menge, und die Zahl oben stimmt.
  const response = await runSearch({ query, cityId, ignore, limit: 300, debug: params.get('debug') === '1' });
  const definitions = sourcesForCity(response.cityId).map((source) => source.definition);

  return NextResponse.json(toPayload(response, definitions), {
    // Die Rangfolge hängt an der Uhr („heute", „bald") – nicht zwischenspeichern.
    headers: { 'Cache-Control': 'no-store' },
  });
}
