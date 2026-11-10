import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import {
  applyPostDetails,
  parseCategoryNames,
  parseMonthResponse,
  parsePostDetails,
  type PostDetail,
} from './parse.ts';
import { assertRecognised } from '../page.ts';
import { dedupeById, errorMessage, settleParts, withinRange } from '../collect.ts';

/**
 * Lost Weekend – Café, Buchladen, Bar und Veranstaltungsort in der Maxvorstadt.
 *
 * Die Seite `/events/` zeigt nur den laufenden Monat und lädt alles Weitere
 * nach. Ein Parameter für den Zeitraum steckt nicht in der Adresse: die Liste
 * kommt aus dem WordPress-Plugin "Modern Events Calendar" über
 *
 *   POST /wp-admin/admin-ajax.php
 *        action=mec_list_load_month & sf[month]=MM & sf[year]=YYYY
 *
 * Zwei Angaben im Rumpf sind nicht dekorativ: ohne `atts[show_past_events]`
 * bleibt jeder vergangene Monat leer, und ohne eigenes `limit` schneidet die
 * Antwort nach zwölf Terminen ab. Die Antwort ist JSON mit dem Monat als
 * HTML-Fragment im Feld `html`.
 *
 * Gattung und vollständiger Programmtext fehlen in dieser Liste. Beides steht
 * in der offenen REST-Schnittstelle von WordPress, und zwar für alle Termine
 * eines Monats in einer einzigen Abfrage – das ist deutlich sparsamer als je
 * eine Detailseite pro Veranstaltung. Fällt die Schnittstelle aus, laufen die
 * Termine mit dem Kurztext der Liste und ohne Gattung weiter.
 */

const BASE = 'https://lostweekend.de';
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const REST = `${BASE}/wp-json/wp/v2`;

/** Grosszügig über dem beobachteten Höchstwert (20 Termine im Monat). */
const MONTH_LIMIT = 200;

const AJAX_HEADERS = {
  accept: 'application/json, text/javascript, */*; q=0.01',
  'x-requested-with': 'XMLHttpRequest',
  referer: `${BASE}/events/`,
};

export const lostweekend: EventSource = {
  definition: {
    id: 'lostweekend',
    name: 'Lost Weekend',
    cityId: 'muenchen',
    group: 'Club',
    defaultCategory: 'Club',
    concerts: 'Konzert',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7));
    if (months.length === 0) return [];

    // Einzelne Monatslücken sind hinnehmbar, ein Totalausfall nicht.
    const loaded = await settleParts({
      sourceId: 'lostweekend',
      parts: months,
      load: async (month) => {
          const body = await fetchText(AJAX, {
            signal,
            timeoutMs: options?.requestTimeoutMs,
            headers: AJAX_HEADERS,
            body: monthBody(month),
          });

          const { events, skipped, empty, reported, postIds } = parseMonthResponse(body, month);

          // Der leere Container ist eine gültige Auskunft (das Haus bespielt
          // nicht jeden Monat). Fehlt er, hat sich der Aufbau geändert.
          assertRecognised(events.length, empty, month);
          if (skipped > 0) console.warn(`[lostweekend] ${month}: ${skipped} Block/Blöcke übersprungen`);
          if (reported !== undefined && reported >= MONTH_LIMIT) {
            console.warn(`[lostweekend] ${month}: Antwort am Limit (${reported}) – womöglich abgeschnitten`);
          }

          return { events, postIds };
        },
    });
    const events = loaded.flatMap((month) => month.events);
    const postIds = new Set(loaded.flatMap((month) => month.postIds));

    const filtered = dedupeById(events).filter((event) => withinRange(event.start, range));
    return applyPostDetails(filtered, await loadPostDetails([...postIds], signal, options));
  },
};

/**
 * Rumpf der Monatsabfrage. `sf[…]` ist das Suchformular der Seite – über
 * `mec_year`/`mec_month` allein bleibt die Antwort beim laufenden Monat.
 */
function monthBody(month: string): string {
  const [year, m] = month.split('-');
  return new URLSearchParams({
    action: 'mec_list_load_month',
    'sf[month]': m,
    'sf[year]': year,
    apply_sf_date: '1',
    'atts[show_past_events]': '1',
    'atts[sk-options][list][style]': 'standard',
    'atts[sk-options][list][limit]': String(MONTH_LIMIT),
  }).toString();
}

/**
 * Gattungen und lange Texte in zwei Abfragen: einmal die Namen der Gattungen,
 * einmal die Beiträge der gefundenen Termine. Beides ist Beiwerk – schlägt es
 * fehl, ist das kein Grund, den Monat fallen zu lassen.
 */
async function loadPostDetails(
  postIds: number[],
  signal?: AbortSignal,
  options?: EventFetchOptions,
): Promise<Map<string, PostDetail>> {
  if (postIds.length === 0) return new Map();

  try {
    const get = (path: string) =>
      fetchText(`${REST}/${path}`, {
        signal,
        retries: 0,
        timeoutMs: options?.requestTimeoutMs,
        headers: { accept: 'application/json' },
      });

    const categoryNames = parseCategoryNames(await get('mec_category?per_page=100&_fields=id,name'));

    const details = new Map<string, PostDetail>();
    // `per_page` deckelt die Schnittstelle bei 100 – lange Zeiträume brauchen
    // also mehrere Abfragen.
    for (const chunk of chunks(postIds, 100)) {
      const posts = await get(
        `mec-events?per_page=100&_fields=id,link,mec_category,content&include=${chunk.join(',')}`,
      );
      for (const [url, detail] of parsePostDetails(posts, categoryNames)) details.set(url, detail);
    }

    return details;
  } catch (error) {
    console.warn(`[lostweekend] Gattung und Programmtext nicht lesbar: ${errorMessage(error)}`);
    return new Map();
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export default lostweekend;
