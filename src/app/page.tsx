import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Was der Kalender in der Adresse trägt – daran erkennt man einen alten Kalenderlink. */
const CALENDAR_PARAMS = ['view', 'date', 'event'];

/**
 * Die Wurzel führt auf die Suche.
 *
 * Der Kalender lag früher hier. Geteilte Termine (`/?city=…&event=…`), Links
 * aus Kalender-Abos und gemerkte Lesezeichen tragen deshalb noch die alte
 * Adresse – sie gehen unverändert in den Kalender, nicht auf die Suche. Eine
 * blosse Stadt (`/?city=glasgow`) war der Link auf deren Kalender und bleibt
 * es.
 */
export default async function Root({ searchParams }: PageProps<'/'>) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value);
  }

  if (CALENDAR_PARAMS.some((key) => query.has(key)) || (query.has('city') && !query.has('q'))) {
    redirect(`/calendar?${query}`);
  }
  redirect(query.size ? `/search?${query}` : '/search');
}
