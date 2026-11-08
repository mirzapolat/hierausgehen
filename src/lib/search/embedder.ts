import path from 'node:path';
import type { Embedder } from './semantic.ts';

/**
 * Das Embedding-Modell: multilingual-e5-small über transformers.js, lokal auf
 * der CPU, 8-Bit-quantisiert (gut 100 MB). Kein Schlüssel, keine laufenden
 * Kosten, nichts verlässt den Server.
 *
 * E5 erwartet ein Präfix: „query: " für Anfragen, „passage: " für Texte.
 * Ohne es sinkt die Qualität spürbar.
 *
 * Geladen wird beim ersten Gebrauch, nicht beim Start – wer nie sucht, zahlt
 * keinen Speicher. Im Container liegt das Modell schon im Abbild
 * (`EMBEDDING_CACHE_DIR`, `EMBEDDING_OFFLINE=1`); es wird dort nie
 * nachgeladen.
 */

export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';

const PREFIX = { query: 'query: ', passage: 'passage: ' } as const;

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

export function modelName(): string {
  return process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
}

export function modelCacheDir(): string {
  return process.env.EMBEDDING_CACHE_DIR || path.join(process.cwd(), '.cache', 'models');
}

async function loadExtractor(model: string): Promise<Extractor> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = modelCacheDir();
  if (process.env.EMBEDDING_OFFLINE === '1') env.allowRemoteModels = false;
  const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' });
  return extractor as unknown as Extractor;
}

export function createEmbedder(model = modelName()): Embedder {
  let loading: Promise<Extractor> | undefined;
  const extractor = () =>
    (loading ??= loadExtractor(model).catch((error: unknown) => {
      // Ein gescheiterter Ladeversuch soll den nächsten nicht verhindern.
      loading = undefined;
      throw error;
    }));

  return {
    model,
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      const run = await extractor();
      const output = await run(
        texts.map((text) => PREFIX[kind] + text),
        { pooling: 'mean', normalize: true },
      );
      const dims = output.dims[output.dims.length - 1];
      return texts.map((_, i) => output.data.slice(i * dims, (i + 1) * dims));
    },
  };
}
