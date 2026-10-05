import { getSnapshot } from '@/lib/events/snapshot';
import { toICalendarFeed } from '@/lib/events/ics';
import { applyFeedFilter, parseFeedFilter } from '@/lib/events/filter';
import { isPast } from '@/lib/events/display';
import { cityById, isKnownCityId } from '@/lib/cities';
import { SITE_NAME } from '@/lib/site';

/**
 * Ein Kalender zum Abonnieren: alle kommenden Termine einer Stadt, auf
 * Wunsch mit denselben Filtern wie die Seite (siehe `events/filter.ts`).
 *
 * Kalender-Apps fragen die Adresse selbst regelmässig ab; neue Termine
 * erscheinen dort also ohne weiteres Zutun. Gelesen wird wie überall nur der
 * tägliche Datenstand – ein Abo fasst keine Quelle an.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cityId = params.get('city') ?? '';
  if (!isKnownCityId(cityId)) {
    return new Response(`Unbekannte Stadt "${cityId}".`, { status: 400 });
  }

  const snapshot = await getSnapshot(cityId);
  // Vergangenes gehört nicht ins Abo – die Kalender-App behält, was sie hatte.
  const now = new Date();
  const events = applyFeedFilter(
    snapshot.events.filter((event) => !isPast(event, now)),
    parseFeedFilter(params),
  ).sort((a, b) => a.start.localeCompare(b.start));

  const name = params.get('name')?.trim() || `${SITE_NAME} · ${cityById(cityId).name}`;
  const body = toICalendarFeed(events, { now, name, refreshHours: 12 });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // Inline statt Download: Kalender-Apps lesen die Adresse direkt.
      'Content-Disposition': `inline; filename="${cityId}.ics"`,
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
