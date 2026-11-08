import type {
  AggregateResult,
  CalendarEvent,
  EventFetchOptions,
  FetchRange,
  SourceDefinition,
  SourceResult,
} from './types.ts';
import { aggregateEvents } from './aggregate.ts';
import { locateEvents } from './geocode.ts';
import { sourcesForCity } from './registry.ts';
import { dedupe, isFresh, readCache, writeCache } from './cache.ts';
import { isDemoMode, readDemoSnapshot } from './demo.ts';
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

/**
 * Abstand zwischen zwei Versuchen, eine bei der Erhebung ausgefallene Quelle
 * nachzuholen. Lang genug, dass eine dauerhaft tote Seite nicht an jedem
 * Seitenaufruf hängt, kurz genug, dass eine behobene Ursache noch am selben
 * Tag greift.
 */
const REPAIR_INTERVAL_SECONDS = 30 * 60;

/**
 * Wie oft der Start eine neu registrierte Quelle holen darf, und in welchem
 * Abstand. Drei Anläufe über zehn Minuten fangen den Fall ab, dass ein Haus
 * genau während des Deployments nicht antwortet; danach greift wieder der
 * gewöhnliche Weg über Seitenaufrufe und die Erhebung um 5 Uhr.
 */
const CATCHUP_ATTEMPTS = 3;
const CATCHUP_RETRY_MS = 5 * 60 * 1000;

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
  // Entwicklung mit eingefrorenem Abzug der Live-Seite (`demo.ts`): weder
  // Cache noch Quellen, auch kein `force`.
  if (isDemoMode()) return withRegistrySources(cityId, await readDemoSnapshot(cityId));

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
    // Der Stand ist gültig, aber vielleicht lückenhaft: eine Quelle, die es
    // beim letzten Lauf noch nicht gab, oder eine, die dabei ausgefallen ist.
    // Beides wird im Hintergrund nachgeholt.
    repairSnapshot(cityId, range, key, cached.value, city);
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
 * Was am Stand zu reparieren ist: `missing` kennt er gar nicht, `failed` hat
 * er angefasst und nichts Brauchbares bekommen. Getrennt, weil sich beides
 * unterschiedlich holen lässt – die eine darf ihren Eigencache nutzen, die
 * andere nicht.
 */
export function pendingRepairs(
  ids: string[],
  current: AggregateResult,
): { missing: string[]; failed: string[] } {
  const known = new Map(current.sources.map((source) => [source.sourceId, source]));
  return {
    missing: ids.filter((id) => !known.has(id)),
    failed: ids.filter((id) => {
      const status = known.get(id)?.status;
      return status === 'error' || status === 'stale';
    }),
  };
}

/**
 * Lücken im gültigen Stand nachholen, ohne ihn anzutasten. Niemand wartet
 * darauf: der Seitenaufruf bekommt sofort, was da ist, und der nächste sieht
 * die nachgeholte Quelle.
 *
 * Zwei Arten von Lücke gibt es. Eine Quelle, die der Stand nicht kennt, ist
 * neu registriert – die wird sofort geholt. Eine Quelle, die bei der Erhebung
 * ausgefallen ist (`error` ohne Termine, `stale` mit denen von gestern), wäre
 * sonst bis zur nächsten Erhebung kaputt, auch wenn die Ursache längst behoben
 * ist: eine Seite, die nur kurz nicht antwortete, oder ein Adapter, dessen
 * Korrektur erst nach der Erhebung ausgeliefert wurde. Ein erneuter Versuch
 * kostet die Häuser nichts, die geantwortet haben – angefasst wird nur, was
 * misslang – und höchstens einen Anlauf je `REPAIR_INTERVAL_SECONDS`.
 */
function repairSnapshot(
  cityId: string,
  range: FetchRange,
  key: string,
  current: AggregateResult,
  city: City,
): void {
  const { missing, failed } = pendingRepairs(
    sourcesForCity(cityId).map((source) => source.definition.id),
    current,
  );
  if (missing.length === 0 && failed.length === 0) return;

  void dedupe(`snapshot_repair_${key}`, async () => {
    // Der zweite Anlauf für eine ausgefallene Quelle darf nicht an jedem
    // Seitenaufruf hängen; eine neu registrierte Quelle wartet nicht.
    const retry = failed.length > 0 && !isFresh(await readCache(repairKey(key)));
    if (retry) await writeCache(repairKey(key), true, REPAIR_INTERVAL_SECONDS);

    const pending = retry ? [...missing, ...failed] : missing;
    if (pending.length === 0) return;

    try {
      // Die neue Quelle darf ihren Eigencache nutzen, die ausgefallene nicht:
      // deren letzter Stand ist ja gerade das Problem.
      const fetched = mergeSources(
        await collectSome(cityId, range, missing, false),
        await collectSome(cityId, range, retry ? failed : [], true),
      );
      // Neu einlesen: zwischenzeitlich kann der Zeitplan geschrieben haben.
      const latest = await readCache<AggregateResult>(key);
      await store(key, mergeSources(latest?.value ?? current, fetched), city);
      console.log(`[snapshot] "${cityId}": ${pending.join(', ')} nachgeholt`);
    } catch (error) {
      console.warn(`[snapshot] Nachholen von "${pending.join(', ')}" für "${cityId}" fehlgeschlagen`, error);
    }
  }).catch(() => {
    // Oben bereits vermerkt.
  });
}

function repairKey(key: string): string {
  return `${key}_repair`;
}

/**
 * Quellen, die registriert sind, von denen der gespeicherte Stand aber noch
 * nichts weiss – also die, die seit der letzten Erhebung dazugekommen sind.
 *
 * Ohne gespeicherten Stand ist die Antwort leer: dann baut ihn der nächste
 * Aufruf ohnehin vollständig auf, inklusive der neuen Quelle.
 */
export async function unknownSources(cityId: string): Promise<string[]> {
  const range = snapshotRange(cityId);
  const cached = await readCache<AggregateResult>(cacheKey(cityId, range));
  if (!cached) return [];
  return pendingRepairs(
    sourcesForCity(cityId).map((source) => source.definition.id),
    cached.value,
  ).missing;
}

/**
 * Genau diese Quellen holen und in den gespeicherten Stand einsetzen.
 *
 * Zurück kommt, was dabei nicht geklappt hat – damit der Aufrufer es erneut
 * versuchen kann. Nach dem ersten Versuch steht eine ausgefallene Quelle als
 * `error` im Stand und gälte nicht mehr als "unbekannt"; die Wiederholung
 * muss deshalb über die Namen laufen, nicht über den Stand.
 *
 * Der erste Anlauf darf den gewöhnlichen Weg nehmen – eine neue Quelle hat
 * ohnehin keinen Eigencache. Erst die Wiederholung erzwingt den Abruf, sonst
 * hielte der Sicherungsschalter sie nach dem ersten Fehlversuch zurück.
 */
export async function collectInto(
  cityId: string,
  sourceIds: string[],
  force = false,
): Promise<string[]> {
  if (sourceIds.length === 0) return [];

  const city = cityById(cityId);
  const range = snapshotRange(cityId);
  const key = cacheKey(cityId, range);
  const current = await readCache<AggregateResult>(key);
  // Ohne Stand gibt es nichts zu ergänzen – der Aufbau holt alles.
  if (!current) return [];

  const fetched = await collectSome(cityId, range, sourceIds, force);
  // Neu einlesen: zwischenzeitlich kann der Zeitplan geschrieben haben.
  const latest = await readCache<AggregateResult>(key);
  await store(key, mergeSources(latest?.value ?? current.value, fetched), city);

  const status = new Map(fetched.sources.map((source) => [source.sourceId, source.status]));
  return sourceIds.filter((id) => status.get(id) !== 'ok');
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

async function collect(
  cityId: string,
  range: FetchRange,
  options: { force?: boolean; sourceIds?: string[]; fetchOptions?: EventFetchOptions },
): Promise<AggregateResult> {
  const result = await aggregateEvents(range, {
    cityId,
    sourceIds: options.sourceIds,
    force: options.force,
    fetchOptions: options.fetchOptions,
  });

  return { ...result, events: await locate(cityId, result) };
}

/**
 * Die Orte für die Kartenansicht auflösen. Passiert genau hier, weil hier
 * ohnehin einmal am Tag gearbeitet wird und das Ergebnis mit dem Datenstand
 * auf der Platte landet – kein Seitenaufruf fragt je einen Kartendienst.
 *
 * Ein Fehlschlag ist folgenlos: dann fehlen Punkte, nicht Termine.
 */
async function locate(cityId: string, result: AggregateResult): Promise<CalendarEvent[]> {
  try {
    return await locateEvents(result.events, result.definitions, { cityId });
  } catch (error) {
    console.warn(`[snapshot] Ortsauflösung für "${cityId}" fehlgeschlagen`, error);
    return result.events;
  }
}

/** Ein Teil des Stands – ohne Quellen bleibt es beim leeren Ergebnis. */
async function collectSome(
  cityId: string,
  range: FetchRange,
  sourceIds: string[],
  force: boolean,
): Promise<AggregateResult> {
  // Leer heisst „nichts zu holen", nicht „keine Quellen": die Definitionen
  // gehören zur Stadt und dürfen beim Zusammenführen nicht wegfallen.
  if (sourceIds.length === 0) {
    return { events: [], sources: [], definitions: sourcesForCity(cityId).map((s) => s.definition) };
  }
  return collect(cityId, range, { sourceIds, force, fetchOptions: SCHEDULED_FETCH });
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
  if (scheduled || process.env.EVENT_REFRESH_SCHEDULE === '0' || isDemoMode()) return;
  scheduled = true;

  for (const city of cities) {
    void warmUp(city);
    plan(city);
  }
}

/**
 * Orte in einem bestehenden Datenstand nachtragen.
 *
 * Der Stand auf der Platte kann älter sein als die Ortsauflösung selbst –
 * nach dem Deployment dieser Funktion etwa, oder wenn sie beim letzten Lauf
 * ins Zeitbudget gelaufen ist. Ohne dies bliebe die Kartenansicht bis zur
 * nächsten Erhebung leer, obwohl alle Daten da sind.
 *
 * Gelaufen wird, sobald **irgendein** Termin ohne Ort dasteht – auch wenn die
 * meisten schon einen haben. Genau so sieht ein Lauf aus, der ins Budget
 * gelaufen ist: die Hälfte verortet, der Rest offen. Gespeichert wird nur,
 * wenn dabei wirklich etwas dazugekommen ist; die Namen liegen im
 * Zwischenspeicher, ein Lauf ohne neue Namen kostet nichts.
 */
export async function locateSnapshot(cityId: string): Promise<number> {
  const city = cityById(cityId);
  const range = snapshotRange(cityId);
  const key = cacheKey(cityId, range);
  const cached = await readCache<AggregateResult>(key);
  if (!cached || cached.value.events.length === 0) return 0;

  const before = cached.value.events.filter((event) => event.venue.place).length;
  if (before === cached.value.events.length) return 0;

  const events = await locateEvents(cached.value.events, cached.value.definitions, { cityId });
  const added = events.filter((event) => event.venue.place).length - before;
  if (added <= 0) return 0;

  const latest = await readCache<AggregateResult>(key);
  await store(key, { ...(latest?.value ?? cached.value), events }, city);
  return added;
}

/**
 * Aufwärmen beim Hochfahren – und der eigentliche Grund dafür: heute
 * hinzugekommene Quellen.
 *
 * Der Stand auf der Platte überlebt ein Deployment. Eine Quelle, die gerade
 * erst registriert wurde, steht deshalb nicht darin, und der Stand von heute
 * Nacht ist bis morgen früh gültig – ohne Zutun bliebe die neue Quelle also
 * bis zur nächsten Erhebung leer. `getSnapshot` holt sie zwar im Hintergrund
 * nach, aber erst wenn jemand die Seite aufruft, und mit genau einem Anlauf.
 * Auf dem Server soll ein Deployment genügen: erst holen, dann ausliefern,
 * und bei einer Quelle, die im falschen Moment nicht antwortet, noch einmal
 * versuchen, statt auf den nächsten Besuch zu warten.
 *
 * Die Reihenfolge ist Absicht – erst die neuen Quellen, dann das Aufwärmen:
 * so sieht schon der erste Seitenaufruf einen vollständigen Stand.
 */
async function warmUp(city: City): Promise<void> {
  try {
    const fresh = await unknownSources(city.id);
    if (fresh.length > 0) {
      console.log(`[snapshot] "${city.id}": neu registriert – ${fresh.join(', ')}`);
      await catchUp(city.id, fresh);
    }
  } catch (error) {
    console.error(`[snapshot] Nachholen neuer Quellen für "${city.id}" fehlgeschlagen`, error);
  }

  // Liegt ein Stand auf der Platte, kostet das nichts, sonst hat der erste
  // Besuch bereits Daten.
  try {
    await getSnapshot(city.id, { patient: true });
  } catch (error) {
    console.error(`[snapshot] Aufwärmen für "${city.id}" fehlgeschlagen`, error);
  }

  try {
    const located = await locateSnapshot(city.id);
    if (located > 0) console.log(`[snapshot] "${city.id}": ${located} Termine nachträglich verortet`);
  } catch (error) {
    console.warn(`[snapshot] Nachträgliche Ortsauflösung für "${city.id}" fehlgeschlagen`, error);
  }
}

/** Neue Quellen holen, ausgefallene ein paar Mal erneut versuchen. */
async function catchUp(cityId: string, sourceIds: string[]): Promise<void> {
  let pending = sourceIds;

  for (let attempt = 1; attempt <= CATCHUP_ATTEMPTS && pending.length > 0; attempt++) {
    if (attempt > 1) await delay(CATCHUP_RETRY_MS);
    try {
      pending = await collectInto(cityId, pending, attempt > 1);
    } catch (error) {
      console.warn(`[snapshot] Versuch ${attempt} für "${cityId}" fehlgeschlagen`, error);
    }
  }

  const collected = sourceIds.filter((id) => !pending.includes(id));
  if (collected.length > 0) console.log(`[snapshot] "${cityId}": ${collected.join(', ')} erstmals erhoben`);
  // Nicht das Ende: der nächste Seitenaufruf versucht es über die übliche
  // Reparatur weiter, und spätestens die Erhebung um 5 Uhr fasst sie wieder an.
  if (pending.length > 0) console.warn(`[snapshot] "${cityId}": ${pending.join(', ')} noch ohne Daten`);
}

/** Wartezeit, die einen leerlaufenden Prozess nicht am Beenden hindert. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
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
