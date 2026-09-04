import { getSnapshot, snapshotRange } from '@/lib/events/snapshot';
import { csvFileName, toCsv } from '@/lib/events/csv';
import { cities, isKnownCityId } from '@/lib/cities';

/**
 * Der komplette Datenstand als CSV – eine Stadt, mehrere oder alle.
 *
 * Wie überall gilt: gelesen wird ausschliesslich der tägliche Stand, dieser
 * Aufruf fasst keine Quelle an. Filter der Oberfläche spielen keine Rolle –
 * exportiert wird alles, was der Kalender kennt.
 *
 * `?city=` darf mehrfach stehen (`?city=muenchen&city=glasgow`). Ohne Angabe
 * kommen alle Städte – wer den Endpunkt ohne Parameter aufruft, will den
 * ganzen Bestand, nicht eine willkürlich gewählte Stadt.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams
    .getAll('city')
    // Damit auch `?city=muenchen,glasgow` funktioniert.
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const unknown = requested.filter((id) => !isKnownCityId(id));
  if (unknown.length > 0) {
    return new Response(`Unbekannte Stadt "${unknown.join('", "')}".`, { status: 400 });
  }

  // Reihenfolge und Eindeutigkeit kommen aus der Städteliste, nicht aus der
  // URL: derselbe Bestand ergibt so immer denselben Dateinamen.
  const wanted = new Set(requested);
  const ids = cities.map((city) => city.id).filter((id) => wanted.size === 0 || wanted.has(id));

  const snapshots = await Promise.all(ids.map((id) => getSnapshot(id)));
  const events = snapshots.flatMap((snapshot) => snapshot.events);
  const definitions = snapshots.flatMap((snapshot) => snapshot.definitions);
  // Der früheste Stand benennt die Datei – er ist der älteste Teil darin.
  const day = ids.map((id) => snapshotRange(id).from).sort()[0];

  // Tabellenprogramme lesen eine CSV ohne Byte Order Mark oft als Latin-1 –
  // ohne die Marke stünde in München ein Fragezeichen.
  const body = `﻿${toCsv(events, definitions)}`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(ids, day)}"`,
      // Der Stand wechselt täglich; länger als bis dahin ist die Datei nichts wert.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
