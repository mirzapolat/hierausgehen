import path from 'node:path';
import { cityById, isKnownCityId } from '../cities.ts';
import { getSnapshot } from '../events/snapshot.ts';
import { createEmbedder } from './embedder.ts';
import { buildSearchIndex, search, type Facet, type SearchIndex, type SearchResult } from './engine.ts';
import { parseQuery, type ParsedQuery } from './parse.ts';
import {
  fillStore,
  pruneStore,
  readStore,
  similarities,
  writeStore,
  type Embedder,
  type VectorStore,
} from './semantic.ts';

/**
 * Die Suche auf dem Server: Index je Stadt, Vektoren, Anfrage.
 *
 * Der Index entsteht aus dem Datenstand und wird neu gebaut, sobald sich der
 * ändert (tägliche Erhebung, nachgeholte Quelle). Danach werden im
 * Hintergrund die Produktionen eingebettet, die noch keinen Vektor haben.
 * Bis dahin – und wenn das Modell gar nicht lädt – sucht die Wortsuche
 * allein; niemand wartet auf das Modell.
 *
 * Next bündelt Seiten und Route Handler getrennt, jede Bündelung bekommt
 * eigene Modulvariablen. Index, Vektoren und Modell hängen deshalb an
 * `globalThis`: das Modell soll einmal im Speicher liegen, nicht zweimal.
 */

interface State {
  indexes: Map<string, SearchIndex>;
  stores: Map<string, Promise<VectorStore>>;
  embedding: Map<string, Promise<void>>;
  queries: Map<string, Float32Array>;
  embedder?: Embedder;
  /** Das Modell ist in diesem Prozess gescheitert – bis zum Neustart nur Wortsuche. */
  broken?: boolean;
}

const state: State = ((globalThis as { __hierausgehenSearch?: State }).__hierausgehenSearch ??= {
  indexes: new Map(),
  stores: new Map(),
  embedding: new Map(),
  queries: new Map(),
});

const QUERY_CACHE_SIZE = 500;
/** Länger wartet eine Anfrage nicht auf ihren Vektor – dann eben ohne Bedeutung. */
const QUERY_EMBED_TIMEOUT_MS = 2_500;

export function semanticEnabled(): boolean {
  return process.env.EVENT_SEMANTIC !== '0' && !state.broken;
}

function embedder(): Embedder {
  return (state.embedder ??= createEmbedder());
}

function storeFile(cityId: string): string {
  return path.join(process.cwd(), '.cache', 'embeddings', `${cityId}.json`);
}

function store(cityId: string): Promise<VectorStore> {
  let pending = state.stores.get(cityId);
  if (!pending) {
    pending = readStore(storeFile(cityId), embedder().model);
    state.stores.set(cityId, pending);
  }
  return pending;
}

/* --------------------------------- Index --------------------------------- */

export async function searchIndex(cityId: string): Promise<SearchIndex> {
  const snapshot = await getSnapshot(cityId);
  const fingerprint = [
    snapshot.events.length,
    ...snapshot.sources.map((source) => `${source.sourceId}:${source.fetchedAt}:${source.eventCount}`),
  ].join('|');

  const existing = state.indexes.get(cityId);
  if (existing?.fingerprint === fingerprint) return existing;

  const started = performance.now();
  const index = buildSearchIndex(snapshot.events, snapshot.definitions, {
    cityId,
    timeZone: cityById(cityId).timeZone,
    fingerprint,
  });
  state.indexes.set(cityId, index);
  console.log(
    `[search] "${cityId}": Index mit ${index.docs.length} Produktionen in ${Math.round(performance.now() - started)} ms`,
  );
  if (semanticEnabled()) void embedIndex(cityId, index);
  return index;
}

/**
 * Fehlende Vektoren im Hintergrund nachziehen. Läuft je Stadt höchstens
 * einmal gleichzeitig; ein neuerer Index wartet, bis der laufende fertig ist,
 * und bettet dann nur noch ein, was danach dazugekommen ist.
 */
export function embedIndex(cityId: string, index: SearchIndex): Promise<void> {
  const previous = state.embedding.get(cityId) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (!semanticEnabled() || state.indexes.get(cityId) !== index) return;
    const vectors = await store(cityId);
    const started = performance.now();
    let lastSave = performance.now();
    try {
      const added = await fillStore(index.docs, vectors, embedder(), {
        onBatch: async (done, total) => {
          // Zwischendurch speichern: ein Neustart mitten im ersten Lauf soll
          // nicht von vorn beginnen.
          if (done === total || performance.now() - lastSave > 15_000) {
            await writeStore(storeFile(cityId), vectors);
            lastSave = performance.now();
          }
        },
      });
      const removed = pruneStore(index.docs, vectors);
      if (removed > 0 && added === 0) await writeStore(storeFile(cityId), vectors);
      if (added > 0 || removed > 0) {
        console.log(
          `[search] "${cityId}": ${added} Produktionen eingebettet, ${removed} entfernt, ${Math.round(performance.now() - started)} ms`,
        );
      }
    } catch (error) {
      state.broken = true;
      console.error('[search] Embedding-Modell nicht verfügbar – es bleibt bei der Wortsuche', error);
    }
  });
  state.embedding.set(cityId, next);
  return next;
}

/** Beim Hochfahren: Indizes bauen und einbetten, damit die erste Suche nicht wartet. */
export async function warmSearch(cityIds: string[]): Promise<void> {
  for (const cityId of cityIds) {
    try {
      const index = await searchIndex(cityId);
      if (semanticEnabled()) await embedIndex(cityId, index);
    } catch (error) {
      console.warn(`[search] Aufwärmen für "${cityId}" fehlgeschlagen`, error);
    }
  }
}

/* -------------------------------- Anfrage -------------------------------- */

async function queryVector(text: string): Promise<Float32Array | undefined> {
  const key = text.trim().toLocaleLowerCase('de-DE');
  const cached = state.queries.get(key);
  if (cached) {
    // Zuletzt gebraucht ans Ende – die Map ist so ein einfacher LRU.
    state.queries.delete(key);
    state.queries.set(key, cached);
    return cached;
  }
  const timeout = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), QUERY_EMBED_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    const vector = await Promise.race([embedder().embed([text], 'query').then(([v]) => v), timeout]);
    if (!vector) return undefined;
    state.queries.set(key, vector);
    if (state.queries.size > QUERY_CACHE_SIZE) state.queries.delete(state.queries.keys().next().value!);
    return vector;
  } catch (error) {
    state.broken = true;
    console.error('[search] Anfrage ließ sich nicht einbetten – es bleibt bei der Wortsuche', error);
    return undefined;
  }
}

async function similarityFor(index: SearchIndex, parsed: ParsedQuery): Promise<Float32Array | undefined> {
  if (!semanticEnabled()) return undefined;
  if (parsed.words.length === 0 && !parsed.vague) return undefined;
  if (!parsed.semanticText) return undefined;
  const vectors = await store(index.cityId);
  // Ohne einen einzigen Vektor (erster Lauf noch nicht durch) lohnt die Anfrage nicht.
  if (vectors.vectors.size === 0) return undefined;
  const query = await queryVector(parsed.semanticText);
  return query ? similarities(query, index.docs, vectors) : undefined;
}

export interface SearchRequest {
  query: string;
  /** Stadt der Auswahl; eine in der Anfrage genannte Stadt gewinnt. */
  cityId: string;
  ignore?: Facet[];
  limit?: number;
  debug?: boolean;
  now?: Date;
}

export interface SearchResponse {
  query: string;
  cityId: string;
  parsed: ParsedQuery;
  result: SearchResult;
  /** Anteil der Produktionen mit Vektor – 1, sobald das Einbetten durch ist. */
  semanticCoverage: number;
}

export async function runSearch(request: SearchRequest): Promise<SearchResponse> {
  const now = request.now ?? new Date();
  const pickerCity = isKnownCityId(request.cityId) ? request.cityId : 'muenchen';
  let parsed = parseQuery(request.query, { now, timeZone: cityById(pickerCity).timeZone });
  const cityId = parsed.city?.id ?? pickerCity;
  // „heute" hängt an der Zeitzone der gemeinten Stadt.
  if (cityId !== pickerCity && cityById(cityId).timeZone !== cityById(pickerCity).timeZone) {
    parsed = parseQuery(request.query, { now, timeZone: cityById(cityId).timeZone });
  }

  const index = await searchIndex(cityId);
  const similarity = await similarityFor(index, parsed);
  const result = search(index, parsed, {
    now,
    similarity,
    ignore: request.ignore,
    limit: request.limit,
    debug: request.debug,
  });

  const vectors = semanticEnabled() ? await store(cityId) : undefined;
  const covered = vectors ? index.docs.filter((doc) => vectors.vectors.has(doc.hash)).length : 0;
  return {
    query: request.query,
    cityId,
    parsed,
    result,
    semanticCoverage: index.docs.length ? covered / index.docs.length : 0,
  };
}
