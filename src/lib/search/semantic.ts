import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SearchDoc } from './document.ts';

/**
 * Bedeutungssuche: Vektoren je Produktion, Ähnlichkeit je Anfrage.
 *
 * Das Modell selbst steckt hinter `Embedder` – im Betrieb transformers.js
 * (`embedder.ts`), in den Tests ein Stellvertreter mit festen Zahlen. Alles
 * hier ist ohne Modell lauffähig.
 *
 * Eingebettet wird je Produktion, nicht je Termin: der Text ist über alle
 * Vorstellungen derselbe. Gespeichert wird nach Fingerabdruck des Textes;
 * die tägliche Erhebung bettet deshalb nur ein, was neu ist oder sich
 * geändert hat – meist ein paar Dutzend Produktionen.
 */

export interface Embedder {
  /** Kennung des Modells – ändert sie sich, gelten die gespeicherten Vektoren nicht mehr. */
  readonly model: string;
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>;
}

/** Vektoren einer Stadt, nach `SearchDoc.hash`. */
export interface VectorStore {
  model: string;
  vectors: Map<string, Float32Array>;
}

/**
 * Kosinus zwischen Anfrage und jedem Dokument – die Vektoren sind
 * normiert, das Skalarprodukt genügt. Fehlt ein Vektor, steht NaN: die
 * Rangfolge behandelt das Dokument dann so, als gäbe es keine Bedeutung.
 */
export function similarities(query: Float32Array, docs: SearchDoc[], store: VectorStore): Float32Array {
  const out = new Float32Array(docs.length).fill(Number.NaN);
  docs.forEach((doc, i) => {
    const vector = store.vectors.get(doc.hash);
    if (!vector || vector.length !== query.length) return;
    let dot = 0;
    for (let k = 0; k < vector.length; k++) dot += vector[k] * query[k];
    out[i] = dot;
  });
  return out;
}

/** Was noch eingebettet werden muss, ohne Doppelte. */
export function missingDocs(docs: SearchDoc[], store: VectorStore): SearchDoc[] {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    if (store.vectors.has(doc.hash) || seen.has(doc.hash)) return false;
    seen.add(doc.hash);
    return true;
  });
}

/**
 * Fehlende Vektoren berechnen, in kleinen Stapeln. Zwischen den Stapeln
 * kommt die Ereignisschleife zum Zug, damit Seitenaufrufe nicht warten.
 */
export async function fillStore(
  docs: SearchDoc[],
  store: VectorStore,
  embedder: Embedder,
  {
    batchSize = 16,
    onBatch,
  }: { batchSize?: number; onBatch?: (done: number, total: number) => Promise<void> | void } = {},
): Promise<number> {
  const pending = missingDocs(docs, store);
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const vectors = await embedder.embed(
      batch.map((doc) => doc.embedText),
      'passage',
    );
    batch.forEach((doc, i) => store.vectors.set(doc.hash, vectors[i]));
    await onBatch?.(Math.min(start + batchSize, pending.length), pending.length);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return pending.length;
}

/** Nicht mehr gebrauchte Vektoren entfernen – Produktionen, die aus dem Programm sind. */
export function pruneStore(docs: SearchDoc[], store: VectorStore): number {
  const wanted = new Set(docs.map((doc) => doc.hash));
  let removed = 0;
  for (const hash of [...store.vectors.keys()]) {
    if (!wanted.has(hash)) {
      store.vectors.delete(hash);
      removed++;
    }
  }
  return removed;
}

/* ------------------------------- Platte ------------------------------- */

interface StoredVectors {
  model: string;
  dims: number;
  /** hash → Float32-Werte, base64. */
  vectors: Record<string, string>;
}

export async function readStore(file: string, model: string): Promise<VectorStore> {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as StoredVectors;
    if (stored.model !== model) return { model, vectors: new Map() };
    const vectors = new Map<string, Float32Array>();
    for (const [hash, encoded] of Object.entries(stored.vectors)) {
      const bytes = Buffer.from(encoded, 'base64');
      vectors.set(hash, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice());
    }
    return { model, vectors };
  } catch {
    return { model, vectors: new Map() };
  }
}

export async function writeStore(file: string, store: VectorStore): Promise<void> {
  const first = store.vectors.values().next().value as Float32Array | undefined;
  const payload: StoredVectors = {
    model: store.model,
    dims: first?.length ?? 0,
    vectors: Object.fromEntries(
      [...store.vectors].map(([hash, vector]) => [
        hash,
        Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64'),
      ]),
    ),
  };
  await mkdir(path.dirname(file), { recursive: true });
  // Erst daneben schreiben, dann umbenennen: ein Absturz mittendrin hinterlässt
  // keine halbe Datei.
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(payload), 'utf8');
  await rename(temporary, file);
}
