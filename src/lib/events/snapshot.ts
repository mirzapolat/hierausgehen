import type {
  AggregateResult,
  EventFetchOptions,
  FetchRange,
  SourceDefinition,
  SourceResult,
} from './types.ts';
import { aggregateEvents } from './aggregate.ts';
import { sourcesForCity } from './registry.ts';
import { dedupe, isFresh, readCache, writeCache } from './cache.ts';
import { dedupeEvents, normalizeAndDedupeEvents } from './normalize.ts';
import { nextRefreshAt, secondsUntilRefresh, todayInZone } from './schedule.ts';
import { coverageRange } from '../calendar.ts';
import { cities, cityById, type City } from '../cities.ts';

/**
 * Der Datenstand einer Stadt.
 *
 * Die Quellen werden nicht mehr pro Besuch und Zeitraum angefragt, sondern
 * einmal täglich um 5 Uhr für die kommenden zwölf Monate. Jeder Seitenaufruf
 * bekommt einen Ausschnitt aus diesem Stand; die Häuser sehen dadurch genau
 * eine Abfrage am Tag, egal wie viele Leute den Kalender öffnen.
 *
 * Fällt die Erhebung aus, bleibt der letzte Stand stehen – ein leerer Kalender
 * wäre die schlechtere Antwort.
 */

/**
 * Die geplante Erhebung darf sich Zeit lassen – es wartet niemand darauf, und
 * zwölf Monate sind deutlich mehr Arbeit als der Monatsausschnitt eines
 * einzelnen Seitenaufrufs.
 */
const SCHEDULED_FETCH: EventFetchOptions = {
  deadlineMs: 180_000,
  requestTimeoutMs: 20_000,
  descriptionBudgetMs: 120_000,
};
/**
 * Der erste Aufbau kann einen Seitenaufruf aufhalten (leerer Cache, Erhebung
 * noch nicht durch): knapper, damit niemand ewig vor einer leeren Seite sitzt.
 */
const COLD_FETCH: EventFetchOptions = {
  deadlineMs: 45_000,
  requestTimeoutMs: 15_000,
  descriptionBudgetMs: 30_000,
};

/** Zeitraum, den ein Datenstand abdeckt. */
export function snapshotRange(cityId: string): FetchRange {
  return coverageRange(todayInZone(cityById(cityId).timeZone));
}

function cacheKey(cityId: string, range: FetchRange): string {
  return `snapshot_${cityId}_${range.from}_${range.to}`;
}

export async function getSnapshot(
  cityId: string,
  options: {
    force?: boolean;
    /** Auf diesen Aufruf wartet niemand – er darf den vollen Rahmen nutzen. */
    patient?: boolean;
  } = {},
): Promise<AggregateResult> {
  const city = cityById(cityId);
  const range = snapshotRange(cityId);
  const key = cacheKey(cityId, range);
  const cached = await readCache<AggregateResult>(key);

  // Auffrischung vom Zeitplan. Die Oberfläche kann keine anstossen: erhoben
  // wird im Tageslauf, ein Aufruf liest nur den Stand.
  if (options.force) {
    const fetched = await collect(cityId, range, { force: true, fetchOptions: SCHEDULED_FETCH });
    await store(key, fetched, city);
    return withRegistrySources(cityId, fetched);
  }

  if (cached && isFresh(cached)) {
    // Der Stand ist gültig, kennt aber womöglich eine Quelle nicht, die es
    // beim letzten Lauf noch nicht gab. Die wird im Hintergrund nachgeholt.
    collectMissingSources(cityId, range, key, cached.value, city);
    return withRegistrySources(cityId, cached.value);
  }

  // Der Stand ist über 5 Uhr hinaus alt geworden, der Zeitplan aber nicht
  // gelaufen (Neustart, schlafender Prozess): sofort ausliefern, im
  // Hintergrund nachziehen.
  if (cached) {
    void dedupe(`snapshot_refresh_${key}`, async () => {
      try {
        await store(
          key,
          await collect(cityId, range, { force: true, fetchOptions: SCHEDULED_FETCH }),
          city,
        );
      } catch (error) {
        console.warn(`[snapshot] Auffrischung für "${cityId}" fehlgeschlagen`, error);
      }
    }).catch(() => {
      // Oben bereits vermerkt.
    });
    return withRegistrySources(cityId, cached.value);
  }

  // Erster Aufruf ohne jeden Stand: einmal warten, dafür mit Daten antworten.
  return dedupe(`snapshot_build_${key}`, async () => {
    const built = await collect(cityId, range, {
      fetchOptions: options.patient ? SCHEDULED_FETCH : COLD_FETCH,
    });
    await store(key, built, city);
    return withRegistrySources(cityId, built);
  });
}

/**
 * Die Sidebar wird aus `definitions` gebaut. Kämen sie aus dem gespeicherten
 * Datenstand, fehlte eine neu registrierte Quelle dort bis zur nächsten
 * Erhebung – also bis zu einen Tag lang – vollständig: kein Ordner, kein
 * Häkchen, keine Möglichkeit, sie überhaupt anzufordern. Die Registry weiss es
 * sofort, deshalb gewinnt sie über den Stand.
 *
 * Für eine Quelle, zu der der Stand noch nichts weiss, entsteht dabei ein
 * eigener Statuseintrag. Ohne ihn wäre sie in der Oberfläche nicht von einer
 * Quelle ohne Termine zu unterscheiden – mit ihm zeigt die Sidebar den
 * Hinweis und den Knopf zum Nachladen.
 *
 * Aus demselben Grund läuft der Stand noch einmal durch die Normalisierung:
 * gespeichert ist das Ergebnis der Regeln von gestern. Eine geänderte Regel –
 * eine Veranstaltungsart, die dazukommt, ein Synonym, ein umbenannter Ordner –
 * soll sofort greifen und nicht bis zur nächsten Erhebung warten. Die
 * Normalisierung ist dafür eigens wiederholbar: sie rechnet aus demselben
 * Termin zweimal dasselbe.
 */
function withRegistrySources(cityId: string, result: AggregateResult): AggregateResult {
  const definitions = sourcesForCity(cityId).map((source) => source.definition);
  const known = new Set(result.sources.map((source) => source.sourceId));
  const missing = definitions.filter((definition) => !known.has(definition.id));

  return {
    ...result,
    events: normalizeAndDedupeEvents(result.events, definitions),
    definitions,
    sources: missing.length ? [...result.sources, ...missing.map(notCollectedYet)] : result.sources,
  };
}

function notCollectedYet(definition: SourceDefinition): SourceResult {
  return {
    sourceId: definition.id,
    status: 'error',
    fetchedAt: new Date().toISOString(),
    eventCount: 0,
    error: 'Noch nicht erhoben',
  };
}

/**
 * Fehlende Quellen nachholen, ohne den gültigen Stand anzutasten. Niemand
 * wartet darauf: der Seitenaufruf bekommt sofort, was da ist, und der nächste
 * sieht die nachgeholte Quelle.
 */
function collectMissingSources(
  cityId: string,
  range: FetchRange,
  key: string,
  current: AggregateResult,
  city: City,
): void {
  const known = new Set(current.sources.map((source) => source.sourceId));
  const missing = sourcesForCity(cityId)
    .map((source) => source.definition.id)
    .filter((id) => !known.has(id));
  if (missing.length === 0) return;

  void dedupe(`snapshot_missing_${key}_${missing.join('_')}`, async () => {
    try {
      const fetched = await collect(cityId, range, {
        sourceIds: missing,
        fetchOptions: SCHEDULED_FETCH,
      });
      // Neu einlesen: zwischenzeitlich kann der Zeitplan geschrieben haben.
      const latest = await readCache<AggregateResult>(key);
      await store(key, mergeSources(latest?.value ?? current, fetched), city);
      console.log(`[snapshot] "${cityId}": ${missing.join(', ')} nachgeholt`);
    } catch (error) {
      console.warn(`[snapshot] Nachholen von "${missing.join(', ')}" für "${cityId}" fehlgeschlagen`, error);
    }
  }).catch(() => {
    // Oben bereits vermerkt.
  });
}

/** Ausschnitt eines Datenstands – mehr als den Datenstand gibt es nicht. */
export async function eventsInRange(cityId: string, range: FetchRange): Promise<AggregateResult> {
  const snapshot = await getSnapshot(cityId);
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => {
      const day = event.start.slice(0, 10);
      return day >= range.from && day <= range.to;
    }),
  };
}

function collect(
  cityId: string,
  range: FetchRange,
  options: { force?: boolean; sourceIds?: string[]; fetchOptions?: EventFetchOptions },
): Promise<AggregateResult> {
  return aggregateEvents(range, {
    cityId,
    sourceIds: options.sourceIds,
    force: options.force,
    fetchOptions: options.fetchOptions,
  });
}

/** Ein Stand hält bis zur nächsten Erhebung. */
async function store(key: string, value: AggregateResult, city: City): Promise<void> {
  await writeCache(key, value, secondsUntilRefresh(new Date(), city.timeZone));
}

/** Einzelne neu erhobene Quellen in den bestehenden Stand einsetzen. */
function mergeSources(current: AggregateResult, next: AggregateResult): AggregateResult {
  const replaced = new Set(next.sources.map((source) => source.sourceId));
  const statuses = new Map(current.sources.map((source) => [source.sourceId, source]));
  for (const source of next.sources) statuses.set(source.sourceId, source);

  return {
    definitions: next.definitions,
    sources: [...statuses.values()],
    events: dedupeEvents([
      ...current.events.filter((event) => !replaced.has(event.sourceId)),
      ...next.events,
    ]).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'de')),
  };
}

/* ------------------------------- Zeitplan -------------------------------- */

let scheduled = false;

/**
 * Startet die tägliche Erhebung. Wird beim Hochfahren des Servers gerufen
 * (`src/instrumentation.ts`) und ist absichtlich der einzige Ort, an dem
 * regelmässig Quellen angefasst werden.
 */
export function startDailyRefresh(): void {
  if (scheduled || process.env.EVENT_REFRESH_SCHEDULE === '0') return;
  scheduled = true;

  for (const city of cities) {
    // Beim Hochfahren einmal aufwärmen: liegt ein Stand auf der Platte, kostet
    // das nichts, sonst hat der erste Besuch bereits Daten.
    void getSnapshot(city.id, { patient: true }).catch((error) =>
      console.error(`[snapshot] Aufwärmen für "${city.id}" fehlgeschlagen`, error),
    );
    plan(city);
  }
}

function plan(city: City): void {
  const at = nextRefreshAt(new Date(), city.timeZone);
  const timer = setTimeout(
    async () => {
      try {
        const result = await getSnapshot(city.id, { force: true });
        console.log(`[snapshot] "${city.id}" erhoben – ${result.events.length} Termine`);
      } catch (error) {
        console.error(`[snapshot] Erhebung für "${city.id}" fehlgeschlagen`, error);
      }
      plan(city);
    },
    Math.max(1_000, at.getTime() - Date.now()),
  );
  (timer as { unref?: () => void }).unref?.();
  console.log(`[snapshot] nächste Erhebung für "${city.id}": ${at.toISOString()}`);
}
