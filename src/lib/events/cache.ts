import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * TTL-Cache mit "stale-while-error": abgelaufene Einträge bleiben erhalten
 * und werden ausgeliefert, wenn die Quelle gerade nicht erreichbar ist.
 *
 * In-Memory für Geschwindigkeit, zusätzlich auf Platte, damit ein Neustart
 * (oder ein Deploy) nicht mit leerem Kalender startet.
 *
 * **Die Platte ist dabei die gemeinsame Wahrheit, nicht bloss die Sicherung.**
 * Denselben Prozess teilen sich mehrere Modulinstanzen: Next bündelt Server
 * Components und Route Handler getrennt, jede bekommt ihren eigenen
 * Speicher-Cache. Ohne Abgleich lieferte die Startansicht wochenlang einen
 * Stand, den die API längst überholt hat – genau so ist die Kartenansicht
 * einmal ohne Punkte dagestanden, während `/api/events` welche hatte.
 * Dasselbe gilt für alles, was von aussen schreibt: `npm run seed`, ein
 * Skript, ein zweiter Prozess.
 *
 * Der Abgleich kostet ein `stat` je Lesevorgang. Neu eingelesen wird nur,
 * wenn die Datei jünger ist als das, was im Speicher liegt.
 */

export interface CacheEntry<T> {
  value: T;
  /** Zeitpunkt der Erhebung. */
  fetchedAt: string;
  /** Ab wann der Eintrag als veraltet gilt (ms Epoch). */
  expiresAt: number;
}

/** Was im Speicher liegt – und aus welchem Stand der Datei es stammt. */
interface Slot {
  entry: CacheEntry<unknown>;
  /** Änderungszeit der Datei beim Lesen bzw. Schreiben. */
  mtimeMs: number;
}

const memory = new Map<string, Slot>();

const CACHE_DIR = path.join(process.cwd(), '.cache', 'events');
const diskEnabled = process.env.EVENT_CACHE_DISK !== '0';

function diskPath(key: string) {
  return path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]+/gi, '_')}.json`);
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
  const slot = memory.get(key);
  if (!diskEnabled) return slot?.entry as CacheEntry<T> | undefined;

  const mtimeMs = await modifiedAt(diskPath(key));
  // Keine Datei (oder keine jüngere) – dann gilt, was im Speicher liegt.
  if (mtimeMs === undefined) return slot?.entry as CacheEntry<T> | undefined;
  if (slot && mtimeMs <= slot.mtimeMs) return slot.entry as CacheEntry<T>;

  try {
    const entry = JSON.parse(await readFile(diskPath(key), 'utf8')) as CacheEntry<T>;
    memory.set(key, { entry, mtimeMs });
    return entry;
  } catch {
    // Halb geschriebene oder kaputte Datei: der Speicher ist die bessere Wahl.
    return slot?.entry as CacheEntry<T> | undefined;
  }
}

export async function writeCache<T>(key: string, value: T, ttlSeconds: number): Promise<CacheEntry<T>> {
  const entry: CacheEntry<T> = {
    value,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  memory.set(key, { entry, mtimeMs: Date.now() });
  if (diskEnabled) {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(diskPath(key), JSON.stringify(entry), 'utf8');
      // Die eigene Datei nicht gleich wieder für fremd halten.
      const written = await modifiedAt(diskPath(key));
      if (written !== undefined) memory.set(key, { entry, mtimeMs: written });
    } catch {
      // Platte optional – der Speicher-Cache genügt.
    }
  }
  return entry;
}

async function modifiedAt(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
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
