import { NextResponse } from 'next/server';
import { eventsInRange, snapshotRange } from '@/lib/events/snapshot';
import { DEFAULT_CITY_ID, cities } from '@/lib/cities';

export const dynamic = 'force-dynamic';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Mehr Zeit nur fuer explizite Einzelquellen-Retry aus der UI. */
const SOURCE_RETRY_DEADLINE_MS = 30_000;
const SOURCE_RETRY_REQUEST_MS = 15_000;
const SOURCE_RETRY_DESCRIPTION_MS = 18_000;

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
  if (!cities.some((city) => city.id === requestedCity)) {
    return NextResponse.json({ error: `Unbekannte Stadt "${requestedCity}".` }, { status: 400 });
  }

  const sourceIds = params.get('sources')?.split(',').filter(Boolean);
  const refresh = params.get('refresh') === '1';
  // Neu erhoben wird nur auf ausdrücklichen Wunsch für eine einzelne Quelle
  // (Sidebar). Ein allgemeines Neuladen zeigt den täglichen Stand – sonst
  // könnte jeder Besuch alle Häuser erneut abfragen.
  const sourceRetry = refresh && sourceIds?.length === 1 && params.get('retry') === 'source';

  // Der Kalender kennt nur den täglichen Datenstand; ein Zeitraum ausserhalb
  // ist keine Fehlbedienung, er liefert schlicht nichts.
  const covered = snapshotRange(requestedCity);
  const result = await eventsInRange(
    requestedCity,
    { from: from < covered.from ? covered.from : from, to: to > covered.to ? covered.to : to },
    {
      force: sourceRetry,
      sourceIds: sourceRetry ? sourceIds : undefined,
      fetchOptions: sourceRetry
        ? {
            deadlineMs: SOURCE_RETRY_DEADLINE_MS,
            requestTimeoutMs: SOURCE_RETRY_REQUEST_MS,
            descriptionBudgetMs: SOURCE_RETRY_DESCRIPTION_MS,
          }
        : undefined,
    },
  );

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
