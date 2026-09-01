/**
 * Erhebt eine Quelle und legt das Ergebnis als Spiegel ab.
 *
 *   npm run mirror -- gaertnerplatz [weitere-id ...]
 *
 * Gedacht für Quellen, die der eigene Server nicht erreicht. Das Staatstheater
 * am Gärtnerplatz liegt bei 1blu hinter einer Firewall, die TCP von der
 * Hetzner-Adresse dieses Projekts verwirft: ICMP kommt an, Port 80 und 443
 * laufen ins Leere. Aus anderen Netzen – etwa von einem GitHub-Runner –
 * antwortet dieselbe Seite normal.
 *
 * Der Workflow `.github/workflows/mirror.yml` ruft dieses Skript täglich auf
 * und schiebt die erzeugten Dateien auf den Server, wo `src/lib/events/mirror.ts`
 * sie liest. Es wird nichts erfunden und nichts umdatiert – im Spiegel steht
 * genau das, was der Adapter geliefert hat, mit dem Zeitpunkt der Erhebung.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { sourceById } from '../src/lib/events/registry.ts';
import { mirrorDir, mirrorPath, type MirrorFile } from '../src/lib/events/mirror.ts';
import { coverageRange } from '../src/lib/calendar.ts';
import { todayInZone } from '../src/lib/events/schedule.ts';
import { cityById } from '../src/lib/cities.ts';
import type { EventFetchOptions } from '../src/lib/events/types.ts';

/** Auf den Spiegel wartet niemand – er darf sich mehr Zeit nehmen als ein Seitenaufruf. */
const FETCH: EventFetchOptions = {
  deadlineMs: 180_000,
  requestTimeoutMs: 20_000,
  descriptionBudgetMs: 120_000,
};

const ids = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (ids.length === 0) {
  console.error('Aufruf: npm run mirror -- <quellen-id> [weitere-id ...]');
  console.error(`Bekannt: ${[...sourceById.keys()].join(', ')}`);
  process.exit(2);
}

await mkdir(mirrorDir(), { recursive: true });

let failed = 0;
for (const id of ids) {
  const source = sourceById.get(id);
  if (!source) {
    console.error(`✗ ${id} — unbekannte Quelle`);
    failed++;
    continue;
  }

  const range = coverageRange(todayInZone(cityById(source.definition.cityId).timeZone));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH.deadlineMs);

  try {
    const events = await source.fetchEvents(range, controller.signal, FETCH);
    // Ein leerer Spiegel würde einen bestehenden, brauchbaren überschreiben.
    // Lieber die alte Datei stehen lassen und den Lauf als Fehler melden.
    if (events.length === 0) throw new Error('keine Termine erhalten');

    const mirror: MirrorFile = {
      sourceId: id,
      range,
      fetchedAt: new Date().toISOString(),
      events,
    };
    await writeFile(mirrorPath(id), JSON.stringify(mirror), 'utf8');
    console.log(`✓ ${id} — ${events.length} Termine (${range.from} bis ${range.to})`);
  } catch (error) {
    console.error(`✗ ${id} — ${error instanceof Error ? error.message : error}`);
    failed++;
  } finally {
    clearTimeout(timer);
  }
}

process.exit(failed > 0 ? 1 : 0);
