import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { dedupe, isFresh, readCache, writeCache } from '../../cache.ts';
import { fetchText } from '../../http.ts';
import {
  buildEvents,
  deutschesTheaterBaseUrl as BASE,
  parseDetailPage,
  parseProgrammeList,
  type DetailInfo,
  type ProgrammeEntry,
} from './parse.ts';

const SOURCE_ID = 'deutsches-theater';
const AJAX = `${BASE}/core/wp-admin/admin-ajax.php`;
const DETAIL_TTL_SECONDS = 24 * 60 * 60;
const DETAIL_FAILURE_TTL_SECONDS = 60 * 60;
const DETAIL_BUDGET_MS = 6_000;
const DETAIL_TIMEOUT_MS = 4_000;

/**
 * Deutsches Theater München.
 *
 * Die Programmseite rendert nur Filter und lädt die Liste per WordPress AJAX:
 *
 *   GET /core/wp-admin/admin-ajax.php?action=filter_results&nonce=…&locations=&tags=&months=&period=0
 *
 * Der Nonce steht auf `/programm/` in `dtAjax.filterNonce`. GET liefert
 * dieselbe HTML-Fragmentantwort wie der Browser-POST, darum bleibt der Adapter
 * beim gemeinsamen HTTP-Client. Das Fragment enthält die Programmkarte; die
 * Detailseite ergänzt Titel, Beschreibung und Beginn.
 */

export const deutschesTheater: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Deutsches Theater',
    cityId: 'muenchen',
    group: 'Theater',
    defaultCategory: 'Theater',
    color: '#8A4F3D',
    homepage: `${BASE}/programm/`,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    if (range.to < today()) return [];

    const page = await fetchText(`${BASE}/programm/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const nonce = readNonce(page);
    if (!nonce) throw new Error('Filter-Nonce nicht gefunden (Layout geändert?)');

    const html = await fetchText(programmeUrl(nonce), {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });
    const { entries, skipped, empty } = parseProgrammeList(html);

    if (entries.length === 0 && !empty) {
      throw new Error('Keine Programmliste erkannt (Layout geändert?)');
    }
    if (skipped > 0) {
      console.warn(`[${SOURCE_ID}] ${skipped} Programmkarte(n) übersprungen`);
    }

    const relevant = entries.filter((entry) => intersects(entry, range));
    const details = await fetchDetails(relevant, signal, options);
    const events = relevant.flatMap((entry) => buildEvents(entry, details.get(entry.url)));
    return dedupeById(events).filter((event) => withinRange(event.start, range));
  },
};

function readNonce(html: string): string | undefined {
  return html.match(/var dtAjax = .*?"filterNonce":"([^"]+)"/)?.[1];
}

function programmeUrl(nonce: string): string {
  const params = new URLSearchParams({
    action: 'filter_results',
    nonce,
    locations: '',
    tags: '',
    months: '',
    period: '0',
  });
  return `${AJAX}?${params.toString()}`;
}

/**
 * Die Detailseiten liefern Titel, Programmtext und vor allem die
 * Vorstellungszeiten. Sie werden einen Tag lang zwischengespeichert und nur
 * innerhalb eines Zeitbudgets nachgeladen: Was nicht mehr hineinpasst, holt
 * der nächste Abruf. Ein Termin ohne Detailseite bleibt erhalten – dann eben
 * ohne Uhrzeit.
 */
async function fetchDetails(
  entries: ProgrammeEntry[],
  signal: AbortSignal | undefined,
  options: EventFetchOptions | undefined,
): Promise<Map<string, DetailInfo>> {
  const details = new Map<string, DetailInfo>();
  const queue: ProgrammeEntry[] = [];

  for (const entry of new Map(entries.map((item) => [item.url, item])).values()) {
    const cached = await readCache<DetailInfo | null>(detailKey(entry.url));
    if (isFresh(cached)) {
      if (cached!.value) details.set(entry.url, cached!.value);
      continue;
    }
    queue.push(entry);
  }

  const deadlineAt = Date.now() + (options?.descriptionBudgetMs ?? DETAIL_BUDGET_MS);
  let next = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs < 500) return;
      const entry = queue[next++];
      if (!entry) return;
      const detail = await fetchDetail(entry.url, signal, options, remainingMs);
      if (detail) details.set(entry.url, detail);
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
  return details;
}

async function fetchDetail(
  url: string,
  signal: AbortSignal | undefined,
  options: EventFetchOptions | undefined,
  remainingMs: number,
): Promise<DetailInfo | undefined> {
  const key = detailKey(url);

  try {
    const detail = await dedupe(key, async () => {
      const html = await fetchText(url, {
        signal,
        retries: 0,
        timeoutMs: Math.min(options?.requestTimeoutMs ?? DETAIL_TIMEOUT_MS, remainingMs),
      });
      return parseDetailPage(html);
    });
    await writeCache(key, detail, DETAIL_TTL_SECONDS);
    return detail;
  } catch (error) {
    if (!signal?.aborted) {
      console.warn(`[${SOURCE_ID}] Detailseite nicht lesbar (${url}): ${errorMessage(error)}`);
      await writeCache(key, null, DETAIL_FAILURE_TTL_SECONDS);
    }
    return undefined;
  }
}

function detailKey(url: string): string {
  return `detail_${SOURCE_ID}_${hash(url)}`;
}

function intersects(entry: ProgrammeEntry, range: FetchRange): boolean {
  return !!entry.dateRange && entry.dateRange.from <= range.to && entry.dateRange.to >= range.from;
}

function withinRange(start: string, range: FetchRange): boolean {
  const day = start.slice(0, 10);
  return day >= range.from && day <= range.to;
}

function dedupeById(events: CalendarEvent[]): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const event of events) byId.set(event.id, event);
  return [...byId.values()];
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = (h * 33) ^ value.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default deutschesTheater;
