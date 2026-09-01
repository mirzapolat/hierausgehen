import { getSnapshot, snapshotRange } from '@/lib/events/snapshot';
import { csvFileName, toCsv } from '@/lib/events/csv';
import { DEFAULT_CITY_ID, isKnownCityId } from '@/lib/cities';

/**
 * Der komplette Datenstand einer Stadt als CSV.
 *
 * Wie überall gilt: gelesen wird ausschliesslich der tägliche Stand, dieser
 * Aufruf fasst keine Quelle an. Filter der Oberfläche spielen keine Rolle –
 * exportiert wird alles, was der Kalender kennt.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const city = new URL(request.url).searchParams.get('city') ?? DEFAULT_CITY_ID;
  if (!isKnownCityId(city)) {
    return new Response(`Unbekannte Stadt "${city}".`, { status: 400 });
  }

  const snapshot = await getSnapshot(city);
  const range = snapshotRange(city);

  // Tabellenprogramme lesen eine CSV ohne Byte Order Mark oft als Latin-1 –
  // ohne die Marke stünde in München ein Fragezeichen.
  const body = `﻿${toCsv(snapshot.events, snapshot.definitions)}`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(city, range.from)}"`,
      // Der Stand wechselt täglich; länger als bis dahin ist die Datei nichts wert.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
