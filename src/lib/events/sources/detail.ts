import { dedupe, isFresh, readCache, writeCache } from '../cache.ts';
import { fetchText } from '../http.ts';
import type { Availability, CalendarEvent, EventFetchOptions } from '../types.ts';
import { zonedIso } from '../time.ts';

/**
 * Was eine Detailseite über einen Termin hinaus liefern kann.
 *
 * Viele Listen führen nur Titel, Zeit und Ort; Programmtext, Preise und der
 * Ticketlink stehen erst eine Seite weiter. Was hier ankommt, ergänzt den
 * Termin – es überschreibt nie eine Angabe, die die Liste schon sicher wusste.
 */
export interface EventDetail {
  description?: string;
  /**
   * Veranstaltungsart im Wortlaut der Quelle, falls erst die Detailseite sie
   * nennt. `categories.ts` vereinheitlicht sie wie jede andere Angabe.
   */
  category?: string;
  /**
   * Beginn als "HH:MM" Ortszeit, falls die Liste keine Uhrzeit führte und
   * erst die Detailseite eine nennt. Wirkt nur mit `timeZone` und nur auf
   * Termine, die bisher als ganztägig galten.
   */
  startTime?: string;
  availability?: Availability;
  availabilityLabel?: string;
  ticketUrl?: string;
  notes?: string[];
}

interface DetailOptions<T> {
  sourceId: string;
  events: CalendarEvent[];
  signal?: AbortSignal;
  fetchOptions?: EventFetchOptions;
  parse: (html: string, url: string) => T | undefined;
  merge: (event: CalendarEvent, detail: T) => CalendarEvent;
  cacheKey?: (event: CalendarEvent) => string | undefined;
  fetchUrl?: (event: CalendarEvent) => string | undefined;
  concurrency?: number;
}

interface DetailTask {
  key: string;
  cacheKey: string;
  url: string;
}

const DEFAULT_DESCRIPTION_BUDGET_MS = 6_000;
const DEFAULT_DETAIL_TIMEOUT_MS = 4_000;
const DETAIL_TTL_SECONDS = 24 * 60 * 60;
const FAILURE_TTL_SECONDS = 60 * 60;

/**
 * Nur den langen Programmtext nachladen – die Form, die die meisten Quellen
 * brauchen.
 */
export function enrichEventDescriptions(options: {
  sourceId: string;
  events: CalendarEvent[];
  signal?: AbortSignal;
  fetchOptions?: EventFetchOptions;
  parseDescription: (html: string, url: string) => string | undefined;
  cacheKey?: (event: CalendarEvent) => string | undefined;
  fetchUrl?: (event: CalendarEvent) => string | undefined;
  concurrency?: number;
}): Promise<CalendarEvent[]> {
  const { parseDescription, ...rest } = options;
  return enrichEventDetails({
    ...rest,
    parse: (html, url) => {
      const description = parseDescription(html, url);
      return description ? { description } : undefined;
    },
    merge: mergeDetail,
  });
}

/**
 * Programmtext, Preise und Ticketlage von der Detailseite nachladen.
 *
 * Die Abrufe laufen nach Cache-Schlüssel entdoppelt, mit begrenzter
 * Parallelität und einem eigenen Zeitbudget. Ein fehlgeschlagener Abruf
 * darf die Quelle nie als kaputt melden: der Termin bleibt dann so stehen,
 * wie die Liste ihn kannte.
 */
export function enrichEventDetails(
  options: Omit<DetailOptions<EventDetail>, 'merge'> & {
    merge?: (event: CalendarEvent, detail: EventDetail) => CalendarEvent;
    /** Zeitzone der Quelle – nötig, wenn `startTime` benutzt wird. */
    timeZone?: string;
  },
): Promise<CalendarEvent[]> {
  const { timeZone, ...rest } = options;
  return enrichEvents({
    merge: (event, detail) => mergeDetail(event, detail, timeZone),
    ...rest,
  });
}

/**
 * Die Angaben der Detailseite an den Termin legen.
 *
 * Ergänzen statt überschreiben: der lange Text ersetzt den kurzen nur, wenn er
 * wirklich mehr sagt, und die Ticketlage nur, wenn die Liste keine kannte.
 */
export function mergeDetail(
  event: CalendarEvent,
  detail: EventDetail,
  timeZone?: string,
): CalendarEvent {
  const next: CalendarEvent = { ...event };

  if (detail.description && isBetterDescription(event.description, detail.description)) {
    next.description = detail.description;
  }
  if (detail.category && !event.category) next.category = detail.category;
  // Eine Uhrzeit, die erst hier auftaucht, macht aus einem vermeintlich
  // ganztägigen Termin einen mit Beginn. Umgekehrt nie: was die Liste schon
  // wusste, bleibt stehen.
  if (timeZone && detail.startTime && event.allDay) {
    const [hour, minute] = detail.startTime.split(':').map(Number);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      next.start = zonedIso(timeZone, event.start.slice(0, 10), hour, minute);
      next.allDay = false;
    }
  }
  if (detail.availability && detail.availability !== 'unknown' && event.availability === 'unknown') {
    next.availability = detail.availability;
    next.availabilityLabel = detail.availabilityLabel ?? event.availabilityLabel;
  } else if (detail.availabilityLabel && !event.availabilityLabel) {
    next.availabilityLabel = detail.availabilityLabel;
  }
  if (detail.ticketUrl && !event.ticketUrl) next.ticketUrl = detail.ticketUrl;
  if (detail.notes?.length) next.notes = [...(event.notes ?? []), ...detail.notes];

  return next;
}

/**
 * Die allgemeine Form: eigenes Detailformat, eigenes Zusammenführen. Für
 * Detailseiten, die mehr tragen als ein `EventDetail` fasst – etwa eine
 * Produktionsseite mit der Uhrzeit jedes einzelnen Termins (Kulturetage).
 */
export async function enrichEvents<T>({
  sourceId,
  events,
  signal,
  fetchOptions,
  parse,
  merge,
  cacheKey = (event) => event.url,
  fetchUrl = (event) => event.url,
  concurrency = 3,
}: DetailOptions<T>): Promise<CalendarEvent[]> {
  if (events.length === 0) return events;

  const byKey = new Map<string, DetailTask>();
  for (const event of events) {
    const key = cacheKey(event);
    const url = fetchUrl(event);
    if (!key || !url || byKey.has(key)) continue;
    byKey.set(key, { key, cacheKey: detailCacheKey(sourceId, key), url });
  }

  if (byKey.size === 0) return events;

  const details = new Map<string, T | null>();
  const tasks: DetailTask[] = [];
  await Promise.all(
    [...byKey.values()].map(async (task) => {
      const cached = await readCache<T | null>(task.cacheKey);
      if (isFresh(cached)) {
        details.set(task.key, cached!.value);
        return;
      }
      tasks.push(task);
    }),
  );

  if (tasks.length > 0 && !signal?.aborted) {
    await fetchMissingDetails(sourceId, tasks, details, {
      signal,
      fetchOptions,
      parse,
      concurrency,
    });
  }

  let changed = false;
  const enriched = events.map((event) => {
    const key = cacheKey(event);
    const detail = key ? details.get(key) : undefined;
    if (!detail) return event;
    const next = merge(event, detail);
    if (next === event) return event;
    changed = true;
    return next;
  });

  return changed ? enriched : events;
}

async function fetchMissingDetails<T>(
  sourceId: string,
  tasks: DetailTask[],
  details: Map<string, T | null>,
  options: {
    signal?: AbortSignal;
    fetchOptions?: EventFetchOptions;
    parse: (html: string, url: string) => T | undefined;
    concurrency: number;
  },
): Promise<void> {
  const budgetMs = options.fetchOptions?.descriptionBudgetMs ?? DEFAULT_DESCRIPTION_BUDGET_MS;
  const deadlineAt = Date.now() + budgetMs;
  let next = 0;

  const worker = async () => {
    while (!options.signal?.aborted && Date.now() < deadlineAt) {
      const task = tasks[next++];
      if (!task) return;

      const remainingMs = deadlineAt - Date.now();
      if (remainingMs < 500) return;

      try {
        const detail = await dedupe(task.cacheKey, async () => {
          const html = await fetchText(task.url, {
            signal: options.signal,
            retries: 0,
            timeoutMs: Math.min(
              options.fetchOptions?.requestTimeoutMs ?? DEFAULT_DETAIL_TIMEOUT_MS,
              remainingMs,
            ),
          });
          return options.parse(html, task.url) ?? null;
        });

        details.set(task.key, detail);
        await writeCache(task.cacheKey, detail, detail ? DETAIL_TTL_SECONDS : FAILURE_TTL_SECONDS);
      } catch (error) {
        if (!options.signal?.aborted) {
          console.warn(`[${sourceId}] Detailseite nicht lesbar (${task.url}): ${errorMessage(error)}`);
          details.set(task.key, null);
          await writeCache(task.cacheKey, null, FAILURE_TTL_SECONDS);
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, tasks.length) }, () => worker()),
  );
}

function isBetterDescription(current: string | undefined, detail: string): boolean {
  return !current || detail.length > current.length + 40;
}

/**
 * Eigener Namensraum: unter `description_…` lagen früher blosse Strings, unter
 * `detail_…` liegt der ganze Befund. Die alten Einträge laufen von selbst ab.
 */
function detailCacheKey(sourceId: string, key: string): string {
  return `detail_${sourceId}_${hash(key)}`;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = (h * 33) ^ value.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
