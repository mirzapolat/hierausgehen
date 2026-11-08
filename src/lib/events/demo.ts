import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AggregateResult } from './types.ts';

/**
 * Demo-Datenstand für die Entwicklung.
 *
 * Mit `EVENT_DEMO=1` (so startet `npm run dev`) liest der Server den
 * Datenstand aus `demo/<stadt>.json` statt aus Cache und Quellen – kein
 * Abruf, kein Tageslauf, keine Wartezeit. Die Dateien sind ein Abzug der
 * Live-Seite (`npm run demo:pull`), also echte Daten, eingefroren zum
 * Zeitpunkt des Abzugs; erfunden oder umdatiert wird nichts.
 *
 * Gelesen wird der rohe Stand, Normalisierung und Kategorien laufen danach
 * wie gewohnt (`withRegistrySources` in `snapshot.ts`) – eine Änderung an
 * `categories.ts` oder an der Oberfläche ist so sofort zu sehen. Ein neuer
 * Abzug wird ohne Neustart übernommen.
 */

export const DEMO_DIR = path.join(process.cwd(), 'demo');

export interface DemoFile {
  /** Woher der Abzug stammt, etwa `https://hierausgehen.de`. */
  origin: string;
  /** Zeitpunkt des Abzugs (ISO). */
  pulledAt: string;
  cityId: string;
  result: AggregateResult;
}

export function isDemoMode(): boolean {
  return process.env.EVENT_DEMO === '1';
}

export function demoPath(cityId: string): string {
  return path.join(DEMO_DIR, `${cityId.replace(/[^a-z0-9-]+/gi, '_')}.json`);
}

const memory = new Map<string, { mtimeMs: number; result: AggregateResult }>();
const warned = new Set<string>();

/** Der Demo-Stand einer Stadt – ohne Datei ein leerer Stand, nie ein Abruf. */
export async function readDemoSnapshot(cityId: string): Promise<AggregateResult> {
  const file = demoPath(cityId);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    if (!warned.has(cityId)) {
      warned.add(cityId);
      console.warn(`[demo] Kein Demo-Stand für "${cityId}" – \`npm run demo:pull\` holt ihn.`);
    }
    return { events: [], sources: [], definitions: [] };
  }

  const cached = memory.get(cityId);
  if (cached && cached.mtimeMs >= mtimeMs) return cached.result;

  const { result } = JSON.parse(await readFile(file, 'utf8')) as DemoFile;
  memory.set(cityId, { mtimeMs, result });
  return result;
}
