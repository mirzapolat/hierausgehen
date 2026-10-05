import { NextResponse } from 'next/server';
import { sourceById } from '@/lib/events/registry';
import { getSnapshot } from '@/lib/events/snapshot';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';

/**
 * Die Termine der Merkliste. Die Liste selbst kennt nur der Browser; er
 * schickt die IDs, die Antwort sind die Termine aus dem täglichen Datenstand
 * – über alle Städte, denn gemerkt werden darf überall.
 *
 * Was nicht mehr im Datenstand steht (abgesagt, aus dem Programm genommen),
 * kommt als `missing` zurück, damit die Seite es sagen kann, statt es still
 * zu verschlucken.
 */

export const dynamic = 'force-dynamic';

/** Genug für jede ernsthafte Merkliste, zu wenig für einen Missbrauch der Adresse. */
const MAX_IDS = 300;

export interface SavedEventsResponse {
  items: { cityId: string; event: CalendarEvent }[];
  definitions: SourceDefinition[];
  missing: string[];
}

export async function GET(request: Request) {
  const ids = [
    ...new Set(
      new URL(request.url).searchParams
        .getAll('id')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_IDS);

  // Die ID ist `${sourceId}:${sourceEventId}` – daraus folgt die Stadt.
  const byCity = new Map<string, Set<string>>();
  const missing: string[] = [];
  for (const id of ids) {
    const source = sourceById.get(id.split(':')[0]);
    if (!source) {
      missing.push(id);
      continue;
    }
    const wanted = byCity.get(source.definition.cityId) ?? new Set<string>();
    wanted.add(id);
    byCity.set(source.definition.cityId, wanted);
  }

  const items: SavedEventsResponse['items'] = [];
  const definitions: SourceDefinition[] = [];
  await Promise.all(
    [...byCity].map(async ([cityId, wanted]) => {
      const snapshot = await getSnapshot(cityId);
      definitions.push(...snapshot.definitions);
      const found = new Set<string>();
      for (const event of snapshot.events) {
        if (!wanted.has(event.id)) continue;
        items.push({ cityId, event });
        found.add(event.id);
      }
      missing.push(...[...wanted].filter((id) => !found.has(id)));
    }),
  );

  items.sort((a, b) => a.event.start.localeCompare(b.event.start));
  const body: SavedEventsResponse = { items, definitions, missing };
  // Die Antwort hängt an einer persönlichen Liste – kein gemeinsamer Cache.
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}
