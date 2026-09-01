import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CalendarEvent, FetchRange } from './types.ts';

/**
 * Spiegel für Quellen, die der Server nicht erreichen kann.
 *
 * Hintergrund: das Staatstheater am Gärtnerplatz liegt bei 1blu hinter einer
 * Firewall, die TCP von der Hetzner-Adresse dieses Servers verwirft – ICMP
 * kommt an (11 ms), Port 80 und 443 laufen ins Leere. Aus jedem anderen Netz
 * antwortet dieselbe Seite normal. Am Adapter ist dagegen nichts zu machen.
 *
 * Deshalb erhebt ein GitHub-Workflow die Quelle einmal täglich von einem
 * Runner aus und legt das Ergebnis als JSON auf dem Server ab. Findet die
 * Aggregation eine Quelle nicht erreichbar, greift sie darauf zurück.
 *
 * Der Spiegel enthält genau das, was der Adapter geliefert hat – dieselben
 * `CalendarEvent`, nur an anderer Stelle erhoben. Es wird nichts ergänzt und
 * nichts fortgeschrieben: fehlt der Spiegel oder ist er alt, sagt die
 * Oberfläche das über den Quellenstatus.
 */

export interface MirrorFile {
  sourceId: string;
  /** Zeitraum, den die Erhebung abgedeckt hat. */
  range: FetchRange;
  /** Zeitpunkt der Erhebung auf dem Runner. */
  fetchedAt: string;
  events: CalendarEvent[];
}

/** Im Container ein schreibgeschützter Bind-Mount, lokal schlicht nicht da. */
export function mirrorDir(): string {
  return process.env.EVENT_MIRROR_DIR || path.join(process.cwd(), '.mirror');
}

export function mirrorPath(sourceId: string): string {
  return path.join(mirrorDir(), `${sourceId}.json`);
}

/** Liest den Spiegel einer Quelle. Fehlt er oder passt er nicht, `undefined`. */
export async function readMirror(sourceId: string): Promise<MirrorFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(mirrorPath(sourceId), 'utf8');
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as MirrorFile;
    return isMirrorFile(parsed, sourceId) ? parsed : undefined;
  } catch {
    console.warn(`[mirror] "${sourceId}": Datei nicht lesbar`);
    return undefined;
  }
}

/**
 * Ein halb geschriebener oder vertauschter Spiegel darf nicht als Datenstand
 * durchgehen – lieber gar keine Termine als falsch zugeordnete.
 */
function isMirrorFile(value: unknown, sourceId: string): value is MirrorFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Partial<MirrorFile>;
  if (file.sourceId !== sourceId) return false;
  if (!file.fetchedAt || Number.isNaN(Date.parse(file.fetchedAt))) return false;
  if (!Array.isArray(file.events)) return false;
  return file.events.every(
    (event) =>
      typeof event?.id === 'string' &&
      typeof event?.start === 'string' &&
      event?.sourceId === sourceId,
  );
}

export function mirrorEventsInRange(mirror: MirrorFile, range: FetchRange): CalendarEvent[] {
  return mirror.events.filter((event) => {
    const day = event.start.slice(0, 10);
    return day >= range.from && day <= range.to;
  });
}
