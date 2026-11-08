/**
 * Holt den aktuellen Datenstand der Live-Seite als Demo-Datenbank für
 * `npm run dev` (siehe `src/lib/events/demo.ts`).
 *
 *   npm run demo:pull                 alle Städte neu holen
 *   npm run demo:pull -- --if-missing nur, wenn noch kein Abzug da ist
 *   DEMO_ORIGIN=http://localhost:3000 npm run demo:pull   andere Quelle
 *
 * Gelesen wird `/api/events` – derselbe Stand, den die Seite zeigt. Die Daten
 * landen unverändert in `demo/<stadt>.json`; nichts wird erfunden oder
 * umdatiert. Der laufende Dev-Server übernimmt einen neuen Abzug ohne
 * Neustart.
 */

import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { cities } from '../src/lib/cities.ts';
import { DEMO_DIR, demoPath, type DemoFile } from '../src/lib/events/demo.ts';
import type { AggregateResult } from '../src/lib/events/types.ts';

const origin = (process.env.DEMO_ORIGIN ?? 'https://hierausgehen.de').replace(/\/$/, '');
const ifMissing = process.argv.includes('--if-missing');

if (ifMissing) {
  const existing = await readdir(DEMO_DIR).catch(() => [] as string[]);
  if (existing.some((name) => name.endsWith('.json'))) process.exit(0);
  console.log('Noch keine Demo-Daten – einmalig von der Live-Seite holen …');
}

await mkdir(DEMO_DIR, { recursive: true });

// Der Server beschneidet den Zeitraum auf seinen Datenstand; ein weiter
// Rahmen heisst deshalb schlicht „alles, was er hat“.
const params = (cityId: string) => new URLSearchParams({ city: cityId, from: '2000-01-01', to: '2100-12-31' });

let failed = 0;
for (const city of cities) {
  const url = `${origin}/api/events?${params(city.id)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'hierausgehen-demo-pull' },
      signal: AbortSignal.timeout(120_000),
    });
    // 400 heisst hier: die Live-Seite kennt die Stadt noch nicht (lokal neu
    // eingetragen, noch nicht ausgeliefert). Dann ist ihr Stand leer.
    if (res.status === 400) {
      await save(city.id, { events: [], sources: [], definitions: [] });
      console.log(`· ${city.name.padEnd(12)} auf der Live-Seite noch unbekannt – leer abgelegt`);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = (await res.json()) as AggregateResult;
    await save(city.id, result);

    const problems = result.sources.filter((source) => source.status !== 'ok').length;
    console.log(
      `✓ ${city.name.padEnd(12)} ${String(result.events.length).padStart(5)} Termine, ` +
        `${result.sources.length} Quellen${problems ? ` (${problems} mit Problemen)` : ''}`,
    );
  } catch (error) {
    failed += 1;
    console.error(`✗ ${city.name}: ${error instanceof Error ? error.message : error} (${url})`);
  }
}

async function save(cityId: string, result: AggregateResult): Promise<void> {
  const file: DemoFile = { origin, pulledAt: new Date().toISOString(), cityId, result };
  // Erst vollständig schreiben, dann umbenennen: der laufende Dev-Server
  // soll nie eine halbe Datei lesen.
  const target = demoPath(cityId);
  await writeFile(`${target}.tmp`, JSON.stringify(file), 'utf8');
  await rename(`${target}.tmp`, target);
}

if (failed > 0) {
  console.error(`\n${failed} Städte nicht geholt – ihr bisheriger Abzug bleibt stehen.`);
  // Beim automatischen Holen vor `npm run dev` nicht den Start verhindern.
  if (!ifMissing) process.exit(1);
}
