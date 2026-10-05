import { NextResponse } from 'next/server';
import { isKnownCityId } from '@/lib/cities';
import { isPast } from '@/lib/events/display';
import { sourceById } from '@/lib/events/registry';
import { seriesKey } from '@/lib/events/series';
import { getSnapshot } from '@/lib/events/snapshot';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { normalizeSaved, searchMatches, type SavedSearch } from '@/lib/saved-state';

/**
 * Die Termine der Merkliste. Die Liste selbst kennt nur der Browser; er
 * schickt sie mit, die Antwort sind die Termine aus dem täglichen Datenstand
 * – über alle Städte, denn gemerkt werden darf überall.
 *
 * Gemerkte Reihen und Suchen sind Regeln: geliefert wird alles Kommende, was
 * dazu passt. Ausnahmen wendet der Browser an, er kennt sie ohnehin.
 *
 * Was als einzelner Termin gemerkt, aber nicht mehr im Datenstand steht
 * (abgesagt, aus dem Programm genommen), kommt als `missing` zurück, damit
 * die Seite es sagen kann, statt es still zu verschlucken.
 */

export const dynamic = 'force-dynamic';

/** Genug für jede ernsthafte Merkliste, zu wenig für einen Missbrauch der Adresse. */
const MAX_IDS = 300;
const MAX_RULES = 50;

export interface SavedEventsResponse {
  items: { cityId: string; event: CalendarEvent }[];
  definitions: SourceDefinition[];
  missing: string[];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  // Dieselbe Prüfung wie beim Lesen aus dem Speicher – Fremdes fällt weg.
  const state = normalizeSaved(body);
  const ids = state.events.map((entry) => entry.id).slice(0, MAX_IDS);
  const series = new Set(state.series.slice(0, MAX_RULES).map((entry) => entry.key));
  const searches = state.searches.slice(0, MAX_RULES).filter((search) => isKnownCityId(search.cityId));

  // Die ID ist `${sourceId}:${sourceEventId}`, der Reihenschlüssel beginnt mit
  // der Quelle – daraus folgt die Stadt.
  const cities = new Set<string>(searches.map((search) => search.cityId));
  const wantedIds = new Set<string>();
  const missing: string[] = [];
  for (const id of ids) {
    const source = sourceById.get(id.split(':')[0]);
    if (!source) missing.push(id);
    else {
      wantedIds.add(id);
      cities.add(source.definition.cityId);
    }
  }
  for (const key of series) {
    const source = sourceById.get(key.split('|')[0]);
    if (source) cities.add(source.definition.cityId);
  }

  const items: SavedEventsResponse['items'] = [];
  const definitions: SourceDefinition[] = [];
  const found = new Set<string>();
  const now = new Date();
  await Promise.all(
    [...cities].map(async (cityId) => {
      const snapshot = await getSnapshot(cityId);
      definitions.push(...snapshot.definitions);
      const citySearches: SavedSearch[] = searches.filter((search) => search.cityId === cityId);
      for (const event of snapshot.events) {
        const byId = wantedIds.has(event.id);
        const byRule =
          !isPast(event, now) &&
          (series.has(seriesKey(event)) || citySearches.some((search) => searchMatches(search, event, cityId)));
        if (!byId && !byRule) continue;
        items.push({ cityId, event });
        if (byId) found.add(event.id);
      }
    }),
  );
  missing.push(...[...wantedIds].filter((id) => !found.has(id)));

  items.sort((a, b) => a.event.start.localeCompare(b.event.start));
  const response: SavedEventsResponse = { items, definitions, missing };
  // Die Antwort hängt an einer persönlichen Liste – kein gemeinsamer Cache.
  return NextResponse.json(response, { headers: { 'Cache-Control': 'private, no-store' } });
}
