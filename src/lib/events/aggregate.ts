import type {
  AggregateResult,
  CalendarEvent,
  EventSource,
  FetchRange,
  SourceResult,
} from './types.ts';
import { sourcesForCity } from './registry.ts';
import { dedupe, isFresh, readCache, writeCache } from './cache.ts';

const DEFAULT_TTL = 30 * 60;
/** Wie lange ein veralteter Cache noch besser ist als gar nichts. */
const MAX_STALE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Holt alle aktivierten Quellen parallel ein.
 *
 * Grundsätze:
 * - Eine kaputte Quelle darf den Kalender nie leeren: Fehler werden pro Quelle
 *   isoliert und, wenn möglich, aus dem Cache bedient (`status: 'stale'`).
 * - Der Aufrufer erfährt über `sources`, welche Quelle wie aktuell ist.
 */
export async function aggregateEvents(
  range: FetchRange,
  options: { cityId: string; sourceIds?: string[]; force?: boolean },
): Promise<AggregateResult> {
  const cited = sourcesForCity(options.cityId);
  const selected = options.sourceIds?.length
    ? cited.filter((s) => options.sourceIds!.includes(s.definition.id))
    : cited;

  const settled = await Promise.all(
    selected.map((source) => loadSource(source, range, options.force ?? false)),
  );

  const events = settled
    .flatMap((entry) => entry.events)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'de'));

  return {
    events,
    sources: settled.map((entry) => entry.status),
    definitions: cited.map((s) => s.definition),
  };
}

async function loadSource(
  source: EventSource,
  range: FetchRange,
  force: boolean,
): Promise<{ events: CalendarEvent[]; status: SourceResult }> {
  const id = source.definition.id;
  const key = `${id}_${range.from}_${range.to}`;
  const ttl = source.ttlSeconds ?? DEFAULT_TTL;

  const cached = await readCache<CalendarEvent[]>(key);
  if (!force && isFresh(cached)) {
    return {
      events: cached!.value,
      status: { sourceId: id, status: 'ok', fetchedAt: cached!.fetchedAt, eventCount: cached!.value.length },
    };
  }

  try {
    const events = await dedupe(key, () => source.fetchEvents(range));
    const entry = await writeCache(key, events, ttl);
    return {
      events,
      status: { sourceId: id, status: 'ok', fetchedAt: entry.fetchedAt, eventCount: events.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[aggregate] Quelle "${id}" fehlgeschlagen: ${message}`);

    // Lieber leicht veraltete Daten als eine leere Ansicht.
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < MAX_STALE_SECONDS * 1000) {
      return {
        events: cached.value,
        status: {
          sourceId: id,
          status: 'stale',
          fetchedAt: cached.fetchedAt,
          eventCount: cached.value.length,
          error: message,
        },
      };
    }

    return {
      events: [],
      status: {
        sourceId: id,
        status: 'error',
        fetchedAt: new Date().toISOString(),
        eventCount: 0,
        error: message,
      },
    };
  }
}
