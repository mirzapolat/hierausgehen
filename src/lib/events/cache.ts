import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * TTL-Cache mit "stale-while-error": abgelaufene Einträge bleiben erhalten
 * und werden ausgeliefert, wenn die Quelle gerade nicht erreichbar ist.
 *
 * In-Memory für Geschwindigkeit, zusätzlich auf Platte, damit ein Neustart
 * (oder ein Deploy) nicht mit leerem Kalender startet.
 */

export interface CacheEntry<T> {
  value: T;
  /** Zeitpunkt der Erhebung. */
  fetchedAt: string;
  /** Ab wann der Eintrag als veraltet gilt (ms Epoch). */
  expiresAt: number;
}

const memory = new Map<string, CacheEntry<unknown>>();

const CACHE_DIR = path.join(process.cwd(), '.cache', 'events');
const diskEnabled = process.env.EVENT_CACHE_DISK !== '0';

function diskPath(key: string) {
  return path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]+/gi, '_')}.json`);
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
  const hit = memory.get(key);
  if (hit) return hit as CacheEntry<T>;
  if (!diskEnabled) return undefined;
  try {
    const raw = await readFile(diskPath(key), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    memory.set(key, entry);
    return entry;
  } catch {
    return undefined;
  }
}

export async function writeCache<T>(key: string, value: T, ttlSeconds: number): Promise<CacheEntry<T>> {
  const entry: CacheEntry<T> = {
    value,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  memory.set(key, entry);
  if (diskEnabled) {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(diskPath(key), JSON.stringify(entry), 'utf8');
    } catch {
      // Platte optional – der Speicher-Cache genügt.
    }
  }
  return entry;
}

export function isFresh(entry: CacheEntry<unknown> | undefined): boolean {
  return !!entry && entry.expiresAt > Date.now();
}

/** Verhindert, dass parallele Requests dieselbe Quelle mehrfach abrufen. */
const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/* ----------------------------- Quellenzustand ----------------------------- */

/**
 * Merkt sich, wie es einer Quelle zuletzt ergangen ist. Daraus speist sich der
 * Sicherungsschalter in `aggregate.ts`: eine Quelle, die mehrfach hintereinander
 * nicht antwortet, wird eine Weile gar nicht mehr angefasst, statt bei jedem
 * Seitenaufruf erneut ins Zeitlimit zu laufen.
 */
export interface SourceHealth {
  /** Fehlversuche in Folge. */
  failures: number;
  lastError?: string;
  /** Bis zu diesem Zeitpunkt (ms Epoch) wird die Quelle übersprungen. */
  openUntil: number;
}

const HEALTHY: SourceHealth = { failures: 0, openUntil: 0 };
const HEALTH_TTL_SECONDS = 24 * 60 * 60;

export async function readHealth(sourceId: string): Promise<SourceHealth> {
  const entry = await readCache<SourceHealth>(`health_${sourceId}`);
  return entry?.value ?? HEALTHY;
}

export async function recordFailure(sourceId: string, error: string, maxPauseMs: number): Promise<void> {
  const current = await readHealth(sourceId);
  const failures = current.failures + 1;
  // Ab dem zweiten Fehlschlag in Folge pausieren, die Pause verdoppelt sich bis
  // zur Obergrenze. Der erste Fehlversuch kann ein Aussetzer sein und kostet
  // niemanden etwas, weil währenddessen der Cache ausgeliefert wird.
  const pause = failures < 2 ? 0 : Math.min(maxPauseMs, 60_000 * 2 ** (failures - 2));
  await writeCache<SourceHealth>(
    `health_${sourceId}`,
    { failures, lastError: error, openUntil: pause ? Date.now() + pause : 0 },
    HEALTH_TTL_SECONDS,
  );
}

export async function recordSuccess(sourceId: string): Promise<void> {
  const current = await readHealth(sourceId);
  if (current.failures === 0 && current.openUntil === 0) return;
  await writeCache<SourceHealth>(`health_${sourceId}`, HEALTHY, HEALTH_TTL_SECONDS);
}
