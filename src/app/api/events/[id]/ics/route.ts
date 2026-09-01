import { sourceById } from '@/lib/events/registry';
import { getSnapshot } from '@/lib/events/snapshot';
import { icsFileName, toICalendar } from '@/lib/events/ics';

/**
 * Ein einzelner Termin als .ics-Datei.
 *
 * Nur zwei Häuser bieten selbst eine .ics an; erzeugt wird sie deshalb aus dem
 * eigenen Datenmodell, damit jeder Termin in den eigenen Kalender wandern kann.
 * Gelesen wird ausschliesslich der tägliche Datenstand – dieser Aufruf fasst
 * keine Quelle an.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // Die ID ist `${sourceId}:${sourceEventId}` – daraus folgt die Stadt.
  const source = sourceById.get(id.split(':')[0]);
  if (!source) return new Response('Unbekannte Veranstaltung', { status: 404 });

  const snapshot = await getSnapshot(source.definition.cityId);
  const event = snapshot.events.find((candidate) => candidate.id === id);
  if (!event) return new Response('Unbekannte Veranstaltung', { status: 404 });

  return new Response(toICalendar(event), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFileName(event)}"`,
      // Ein Termin ändert sich selten; der Datenstand wechselt täglich.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
