import { dedupe, isFresh, readCache, writeCache } from '../cache.ts';
import { fetchText } from '../http.ts';
import type { CalendarEvent, EventFetchOptions } from '../types.ts';

interface DetailDescriptionOptions {
  sourceId: string;
  events: CalendarEvent[];
  signal?: AbortSignal;
  fetchOptions?: EventFetchOptions;
  parseDescription: (html: string, url: string) => string | undefined;
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
const DESCRIPTION_TTL_SECONDS = 24 * 60 * 60;
const FAILURE_TTL_SECONDS = 60 * 60;

export async function enrichEventDescriptions({
  sourceId,
  events,
  signal,
  fetchOptions,
  parseDescription,
  cacheKey = (event) => event.url,
  fetchUrl = (event) => event.url,
  concurrency = 3,
}: DetailDescriptionOptions): Promise<CalendarEvent[]> {
  if (events.length === 0) return events;

  const byKey = new Map<string, DetailTask>();
  for (const event of events) {
    const key = cacheKey(event);
    const url = fetchUrl(event);
    if (!key || !url || byKey.has(key)) continue;
    byKey.set(key, { key, cacheKey: detailCacheKey(sourceId, key), url });
  }

  if (byKey.size === 0) return events;

  const descriptions = new Map<string, string | null>();
  const tasks: DetailTask[] = [];
  await Promise.all(
    [...byKey.values()].map(async (task) => {
      const cached = await readCache<string | null>(task.cacheKey);
      if (isFresh(cached)) {
        descriptions.set(task.key, cached!.value);
        return;
      }
      tasks.push(task);
    }),
  );

  if (tasks.length > 0 && !signal?.aborted) {
    await fetchMissingDescriptions(sourceId, tasks, descriptions, {
      signal,
      fetchOptions,
      parseDescription,
      concurrency,
    });
  }

  let changed = false;
  const enriched = events.map((event) => {
    const key = cacheKey(event);
    const detail = key ? descriptions.get(key) : undefined;
    if (!detail || !isBetterDescription(event.description, detail)) return event;
    changed = true;
    return { ...event, description: detail };
  });

  return changed ? enriched : events;
}

async function fetchMissingDescriptions(
  sourceId: string,
  tasks: DetailTask[],
  descriptions: Map<string, string | null>,
  options: {
    signal?: AbortSignal;
    fetchOptions?: EventFetchOptions;
    parseDescription: (html: string, url: string) => string | undefined;
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
        const description = await dedupe(task.cacheKey, async () => {
          const html = await fetchText(task.url, {
            signal: options.signal,
            retries: 0,
            timeoutMs: Math.min(
              options.fetchOptions?.requestTimeoutMs ?? DEFAULT_DETAIL_TIMEOUT_MS,
              remainingMs,
            ),
          });
          return options.parseDescription(html, task.url) ?? null;
        });

        descriptions.set(task.key, description);
        await writeCache(
          task.cacheKey,
          description,
          description ? DESCRIPTION_TTL_SECONDS : FAILURE_TTL_SECONDS,
        );
      } catch (error) {
        if (!options.signal?.aborted) {
          console.warn(`[${sourceId}] Detailtext nicht lesbar (${task.url}): ${errorMessage(error)}`);
          descriptions.set(task.key, null);
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

function detailCacheKey(sourceId: string, key: string): string {
  return `description_${sourceId}_${hash(key)}`;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = (h * 33) ^ value.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
