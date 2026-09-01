import { NextResponse } from 'next/server';
import { eventsInRange, snapshotRange } from '@/lib/events/snapshot';
import { DEFAULT_CITY_ID, isKnownCityId } from '@/lib/cities';

export const dynamic = 'force-dynamic';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  const requestedCity = params.get('city') ?? DEFAULT_CITY_ID;
  if (!isKnownCityId(requestedCity)) {
    return NextResponse.json({ error: `Unbekannte Stadt "${requestedCity}".` }, { status: 400 });
  }

  // Der Kalender kennt nur den täglichen Datenstand; ein Zeitraum ausserhalb
  // ist keine Fehlbedienung, er liefert schlicht nichts.
  const covered = snapshotRange(requestedCity);
  // Erhoben wird ausschliesslich im Tageslauf (siehe `snapshot.ts`); eine
  // Abfrage liest den Stand, sie löst nie eine neue Erhebung aus.
  const result = await eventsInRange(requestedCity, {
    from: from < covered.from ? covered.from : from,
    to: to > covered.to ? covered.to : to,
  });

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
