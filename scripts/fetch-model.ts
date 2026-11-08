/**
 * Lädt das Embedding-Modell der Suche in den Modellordner und prüft, dass es
 * rechnet.
 *
 *   npm run model:fetch
 *
 * Im Docker-Build läuft das mit `EMBEDDING_CACHE_DIR=/app/models`: das Modell
 * liegt danach im Abbild, der Container lädt zur Laufzeit nie etwas nach
 * (`EMBEDDING_OFFLINE=1`). Lokal landet es in `.cache/models`.
 */
import { createEmbedder, modelCacheDir } from '../src/lib/search/embedder.ts';

const embedder = createEmbedder();
const started = performance.now();
const [vector] = await embedder.embed(['Konzert am Wochenende'], 'query');
if (!vector || vector.length === 0) {
  console.error('Das Modell hat keinen Vektor geliefert.');
  process.exit(1);
}
console.log(
  `${embedder.model}: ${vector.length} Dimensionen, bereit in ${Math.round(performance.now() - started)} ms (${modelCacheDir()})`,
);
