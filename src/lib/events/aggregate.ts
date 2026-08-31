import type {
  AggregateResult,
  CalendarEvent,
  EventFetchOptions,
  EventSource,
  FetchRange,
  SourceResult,
} from './types.ts';
import { sourcesForCity } from './registry.ts';
import {
  dedupe,
  isFresh,
  readCache,
  readHealth,
  recordFailure,
  recordSuccess,
  writeCache,
} from './cache.ts';
import { dedupeEvents, normalizeSourceEvents } from './normalize.ts';

const DEFAULT_TTL = 30 * 60;
/** Wie lange ein veralteter Cache noch besser ist als gar nichts. */
const MAX_STALE_SECONDS = 7 * 24 * 60 * 60;
/**
 * Harte Obergrenze, die eine einzelne Quelle für einen Seitenaufruf kosten darf.
 * Greift auch dann, wenn ein Adapter das Abbruchsignal ignorieren sollte.
 * Über `EVENT_SOURCE_DEADLINE_MS` anpassbar (Betrieb und Tests).
 */
const SOURCE_DEADLINE_MS = Number(process.env.EVENT_SOURCE_DEADLINE_MS) || 12_000;
/** Längste Pause des Sicherungsschalters für eine dauerhaft tote Quelle. */
const MAX_BREAKER_PAUSE_MS = 30 * 60 * 1000;

/**
 * Holt alle Quellen einer Stadt ein.
 *
 * Grundsätze:
 * - **Niemand wartet auf eine tote Quelle.** Liegt etwas im Cache, wird es
 *   sofort ausgeliefert und die Auffrischung läuft im Hintergrund weiter
 *   (`revalidating`). Ein Ausfall verzögert damit keinen Seitenaufruf mehr.
 * - **Wiederholte Ausfälle werden übersprungen.** Nach mehreren Fehlversuchen
 *   in Folge pausiert der Sicherungsschalter die Quelle, damit auch der erste
 *   Aufruf ohne Cache nicht ins Zeitlimit läuft.
 * - Eine kaputte Quelle leert den Kalender nie: Fehler werden pro Quelle
 *   isoliert und der Aufrufer erfährt über `sources`, wie aktuell was ist.
 */
export async function aggregateEvents(
  range: FetchRange,
  options: {
    cityId: string;
    sourceIds?: string[];
    force?: boolean;
    fetchOptions?: EventFetchOptions;
    /** Nur für Tests: ersetzt die Quellen aus der Registry. */
    sources?: EventSource[];
  },
): Promise<AggregateResult> {
  const cited = options.sources ?? sourcesForCity(options.cityId);
  const selected = options.sourceIds?.length
    ? cited.filter((s) => options.sourceIds!.includes(s.definition.id))
    : cited;

  const settled = await Promise.all(
    selected.map((source) =>
      loadSource(source, range, options.force ?? false, options.fetchOptions ?? {}),
    ),
  );

  const events = dedupeEvents(settled.flatMap((entry) => entry.events))
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
  fetchOptions: EventFetchOptions,
): Promise<{ events: CalendarEvent[]; status: SourceResult }> {
  const id = source.definition.id;
  const key = `${id}_${range.from}_${range.to}`;
  const ttl = source.ttlSeconds ?? DEFAULT_TTL;

  const cached = await readCache<CalendarEvent[]>(key);
  if (!force && isFresh(cached)) {
    return {
      events: normalizeSourceEvents(cached!.value, source.definition),
      status: {
        sourceId: id,
        status: 'ok',
        fetchedAt: cached!.fetchedAt,
        eventCount: cached!.value.length,
      },
    };
  }

  const health = await readHealth(id);
  const usable = cached && Date.now() - Date.parse(cached.fetchedAt) < MAX_STALE_SECONDS * 1000;
  const paused = health.openUntil > Date.now();

  // Veraltete Daten sofort ausliefern und im Hintergrund auffrischen. Der
  // Besucher wartet dadurch nie auf eine langsame oder tote Quelle.
  if (usable && !force) {
    if (!paused) refreshInBackground(source, range, key, ttl, fetchOptions);
    return {
      events: normalizeSourceEvents(cached!.value, source.definition),
      status: {
        sourceId: id,
        // Solange die letzte Abfrage geklappt hat, ist das kein Problem,
        // sondern nur eine laufende Auffrischung.
        status: health.failures > 0 ? 'stale' : 'revalidating',
        fetchedAt: cached!.fetchedAt,
        eventCount: cached!.value.length,
        error: health.failures > 0 ? health.lastError : undefined,
      },
    };
  }

  // Kein brauchbarer Cache. Eine als tot bekannte Quelle wird jetzt gar nicht
  // erst angefasst – sonst zahlte jeder erste Aufruf das volle Zeitlimit.
  if (paused && !force) {
    return {
      events: [],
      status: {
        sourceId: id,
        status: 'error',
        fetchedAt: new Date().toISOString(),
        eventCount: 0,
        error: health.lastError ?? 'Quelle vorübergehend nicht erreichbar',
      },
    };
  }

  try {
    const events = normalizeSourceEvents(
      await dedupe(key, () => fetchWithDeadline(source, range, fetchOptions)),
      source.definition,
    );
    const entry = await writeCache(key, events, ttl);
    await recordSuccess(id);
    return {
      events,
      status: { sourceId: id, status: 'ok', fetchedAt: entry.fetchedAt, eventCount: events.length },
    };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[aggregate] Quelle "${id}" fehlgeschlagen: ${message}`);
    await recordFailure(id, message, MAX_BREAKER_PAUSE_MS);

    // Lieber leicht veraltete Daten als eine leere Ansicht.
    if (usable) {
      return {
        events: normalizeSourceEvents(cached!.value, source.definition),
        status: {
          sourceId: id,
          status: 'stale',
          fetchedAt: cached!.fetchedAt,
          eventCount: cached!.value.length,
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

/**
 * Auffrischung neben dem Seitenaufruf. `dedupe` sorgt dafür, dass mehrere
 * gleichzeitige Besucher nur eine einzige Abfrage auslösen.
 */
function refreshInBackground(
  source: EventSource,
  range: FetchRange,
  key: string,
  ttl: number,
  fetchOptions: EventFetchOptions,
): void {
  const id = source.definition.id;
  void dedupe(`refresh_${key}`, async () => {
    try {
      const events = normalizeSourceEvents(
        await fetchWithDeadline(source, range, fetchOptions),
        source.definition,
      );
      await writeCache(key, events, ttl);
      await recordSuccess(id);
    } catch (error) {
      const message = errorMessage(error);
      console.warn(`[aggregate] Auffrischung von "${id}" fehlgeschlagen: ${message}`);
      await recordFailure(id, message, MAX_BREAKER_PAUSE_MS);
    }
  }).catch(() => {
    // Der Fehler ist oben bereits vermerkt; hier nur nichts unbehandelt lassen.
  });
}

/** Bricht ab, sobald die Frist abgelaufen ist – auch bei hängenden Adaptern. */
async function fetchWithDeadline(
  source: EventSource,
  range: FetchRange,
  options: EventFetchOptions,
): Promise<CalendarEvent[]> {
  const controller = new AbortController();
  const deadlineMs = options.deadlineMs ?? SOURCE_DEADLINE_MS;
  const timer = setTimeout(() => controller.abort(), deadlineMs);

  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () =>
      reject(new Error(`Zeitlimit von ${deadlineMs / 1000} s überschritten`)),
    );
  });

  try {
    return await Promise.race([source.fetchEvents(range, controller.signal, options), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
