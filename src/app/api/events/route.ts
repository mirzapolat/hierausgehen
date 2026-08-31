import { NextResponse } from 'next/server';
import { aggregateEvents } from '@/lib/events/aggregate';
import { DEFAULT_CITY_ID, cities } from '@/lib/cities';

export const dynamic = 'force-dynamic';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Obergrenze, damit ein manipulierter Request nicht 100 Monate abruft. */
const MAX_DAYS = 400;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
    return NextResponse.json(
      { error: 'Parameter "from" und "to" müssen als YYYY-MM-DD und aufsteigend angegeben werden.' },
      { status: 400 },
    );
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json({ error: `Zeitraum auf ${MAX_DAYS} Tage begrenzt.` }, { status: 400 });
  }

  const requestedCity = params.get('city') ?? DEFAULT_CITY_ID;
  if (!cities.some((city) => city.id === requestedCity)) {
    return NextResponse.json({ error: `Unbekannte Stadt "${requestedCity}".` }, { status: 400 });
  }

  const sourceIds = params.get('sources')?.split(',').filter(Boolean);
  const force = params.get('refresh') === '1';

  const result = await aggregateEvents({ from, to }, { cityId: requestedCity, sourceIds, force });

  // Eine Auffrischung im Hintergrund ist kein Ausfall; nur echte Probleme
  // sollen die Antwort vom Zwischenspeichern ausnehmen.
  const degraded = result.sources.some((s) => s.status === 'stale' || s.status === 'error');
  return NextResponse.json(result, {
    headers: {
      // Kurz am Rand cachen, aber bei Problemen nicht festschreiben.
      'Cache-Control': degraded ? 'no-store' : 'public, max-age=60, stale-while-revalidate=600',
    },
  });
}
