import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { dedupe, isFresh, readCache, writeCache } from '../../cache.ts';
import { fetchText } from '../../http.ts';
import { dedupeById, errorMessage, today, withinRange } from '../collect.ts';
import { BASE, parseFilmPage, parseFragment, parseProgrammeLinks, toEvent, type FilmPage } from './parse.ts';

/**
 * Cine k – Programmkino in der Kulturetage Oldenburg (Cine k, Muvi, Studio,
 * Kulturplatz).
 *
 * Je Abruf drei Seiten: `/programm/` für die gültigen Fragment-Links, das
 * Fragment dieser Woche (jede Vorstellung mit Uhrzeit) und die Vorschau (die
 * Filme, die später laufen). Die Vorstellungen jenseits dieser Woche stehen
 * nur auf den Filmseiten; die werden wie Detailseiten einen Tag lang behalten
 * und innerhalb eines Zeitbudgets nachgeladen – was nicht hineinpasst, holt
 * der nächste Abruf. Diese Woche ist deshalb immer vollständig, spätere
 * Wochen füllen sich mit den Filmseiten.
 */

const SOURCE_ID = 'cine-k';
const FILM_TTL_SECONDS = 24 * 60 * 60;
const FILM_FAILURE_TTL_SECONDS = 60 * 60;
const FILM_BUDGET_MS = 6_000;
const FILM_TIMEOUT_MS = 4_000;

export const cineK: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'Cine k',
    cityId: 'oldenburg',
    group: 'Kino',
    defaultCategory: 'Kino',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    if (range.to < today()) return [];
    const get = (url: string) => fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs });

    const links = parseProgrammeLinks(await get(`${BASE}/programm/`));
    if (!links.week) throw new Error('Programm: kein Wochen-Link (Layout geändert?)');

    const week = parseFragment(await get(links.week));
    if (!week.recognised) throw new Error('Programm dieser Woche: keine Liste erkannt (Layout geändert?)');
    // Die Vorschau ist Beiwerk: fällt sie aus, bleibt die Woche.
    const preview = links.preview
      ? await get(links.preview).then(parseFragment, () => undefined)
      : undefined;

    const filmUrls = [...new Set([...week.films, ...(preview?.films ?? [])].map((film) => film.url))];
    const pages = await loadFilmPages(filmUrls, signal, options);

    const events: CalendarEvent[] = [];
    for (const [url, page] of pages) {
      for (const screening of page.screenings) events.push(toEvent({ ...page, url }, screening));
    }
    // Diese Woche kommt frisch; Filmseiten können einen Tag alt sein. Gleiche
    // Vorstellungen (gleiche Buchungsnummer) nimmt `dedupeById` einmal.
    for (const film of week.films) {
      const page = pages.get(film.url);
      for (const screening of film.screenings) {
        events.push(toEvent({ ...film, ...page, url: film.url }, screening));
      }
    }

    return dedupeById(events).filter((event) => withinRange(event.start, range));
  },
};

/** Filmseiten aus dem Zwischenspeicher, Fehlendes im Zeitbudget nachladen. */
async function loadFilmPages(
  urls: string[],
  signal: AbortSignal | undefined,
  options: EventFetchOptions | undefined,
): Promise<Map<string, FilmPage>> {
  const pages = new Map<string, FilmPage>();
  const queue: string[] = [];

  for (const url of urls) {
    const cached = await readCache<FilmPage | null>(filmKey(url));
    if (isFresh(cached)) {
      if (cached!.value) pages.set(url, cached!.value);
    } else {
      queue.push(url);
    }
  }

  const deadlineAt = Date.now() + (options?.descriptionBudgetMs ?? FILM_BUDGET_MS);
  let next = 0;
  const worker = async () => {
    while (!signal?.aborted) {
      const remainingMs = deadlineAt - Date.now();
      const url = queue[next++];
      if (!url || remainingMs < 500) return;
      try {
        const page = await dedupe(filmKey(url), async () =>
          parseFilmPage(
            await fetchText(url, {
              signal,
              retries: 0,
              timeoutMs: Math.min(options?.requestTimeoutMs ?? FILM_TIMEOUT_MS, remainingMs),
            }),
          ),
        );
        await writeCache(filmKey(url), page ?? null, page ? FILM_TTL_SECONDS : FILM_FAILURE_TTL_SECONDS);
        if (page) pages.set(url, page);
      } catch (error) {
        if (signal?.aborted) return;
        console.warn(`[${SOURCE_ID}] Filmseite nicht lesbar (${url}): ${errorMessage(error)}`);
        await writeCache(filmKey(url), null, FILM_FAILURE_TTL_SECONDS);
      }
    }
  };
  // Zwei gleichzeitig: ein kleines Kino, kein Ticketportal.
  await Promise.all([worker(), worker()]);
  return pages;
}

function filmKey(url: string): string {
  // Der Slug der Filmseite ist eindeutig: /programm/film/<slug>/
  const slug = url.split('/').filter(Boolean).pop() ?? url;
  return `detail_${SOURCE_ID}_${slug.replace(/[^a-z0-9-]+/gi, '_')}`;
}

export default cineK;
