/**
 * Backstage München (backstage.eu) — Parser.
 *
 * **Woher die Daten kommen:** `/events` ist eine Next.js-Seite, deren Liste
 * erst im Browser gerendert wird. Der Server legt die Daten aber als
 * vorbereiteten react-query-Zustand in den Flight-Payload
 * (`self.__next_f.push([1,"…"])`): eine Abfrage mit
 * `queryKey: ["upcoming", {limit_count: 200, offset_count: 0}]`, deren
 * `state.data` die kommenden Termine sind, aufsteigend nach Beginn. Wir lesen
 * diese Daten, nicht das Markup.
 *
 * **Nur die ersten 200:** Jeder Datensatz trägt `total_count` (am 8.11.2026:
 * 356). Den Rest lädt der Browser direkt aus dem Backend nach; die Seite selbst
 * liefert ihn nicht. Der Parser meldet deshalb `total` und `loaded`, damit der
 * Adapter das Ende der Abdeckung kennt.
 *
 * **Zeitzone:** `start_time` ist echtes UTC (`+00:00`); die Seite zeigt es über
 * `toLocaleTimeString` in Ortszeit. Umgerechnet wird über die Zeitzone.
 *
 * **Titelzusätze:** Hinter ` | ` steht im Titel oft ein Status
 * („ausverkauft", „leider abgesagt", „verlegt auf den 19.04.27") oder das
 * Datum des Abends („11.11.26"). Status und gleiches Datum werden abgelöst,
 * alles andere („Nations League", „Tag 01") bleibt im Titel.
 */

import type { Availability, CalendarEvent } from '../../types.ts';
import { clean, softenShouted } from '../../text.ts';
import { berlinDay, berlinIso } from '../../time.ts';
import type { PageResult } from '../page.ts';

export const SOURCE_ID = 'backstage';
export const BASE = 'https://www.backstage.eu';
export const LIST_URL = `${BASE}/events`;

export interface RawGenre {
  genre_id?: string;
  name?: string;
}

export interface RawEvent {
  event_id?: string;
  start_time?: string;
  presale_date?: string | null;
  presale_active?: boolean;
  title?: string;
  category?: string | null;
  genres?: RawGenre[];
  subtitle?: string | null;
  location_name?: string | null;
  min_price_cents?: number | null;
  rescheduled_from?: string[] | null;
  cancelled?: boolean;
  total_count?: number;
}

export interface BackstagePage extends PageResult {
  /** `total_count` der Quelle: so viele kommende Termine kennt sie insgesamt. */
  total: number;
  /** So viele Datensätze stehen tatsächlich in der Seite. */
  loaded: number;
}

/**
 * Liest die Terminliste aus `/events`. `now` entscheidet nur, ob ein noch
 * nicht aktiver Vorverkauf in der Zukunft beginnt (`not_on_sale`).
 */
export function parseEventsPage(html: string, now: Date = new Date()): BackstagePage {
  const rows = upcomingRows(flightPayload(html));
  if (!rows) return { events: [], skipped: 0, empty: false, total: 0, loaded: 0 };

  const events: CalendarEvent[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const event = toEvent(row, now);
    if (!event) {
      skipped++;
      continue;
    }
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }

  const total = rows.reduce((max, row) => Math.max(max, row.total_count ?? 0), 0);
  return { events, skipped, empty: rows.length === 0, total, loaded: rows.length };
}

function toEvent(row: RawEvent, now: Date): CalendarEvent | undefined {
  const id = row.event_id?.trim();
  const startUtc = row.start_time;
  const rawTitle = clean(row.title ?? '');
  if (!id || !startUtc || !rawTitle || Number.isNaN(Date.parse(startUtc))) return undefined;

  const start = berlinStart(startUtc);
  const day = start.slice(0, 10);
  const { title, soldOut, cancelled, moved } = splitTitle(rawTitle, day);
  if (!title) return undefined;

  const notes: string[] = [];
  const series = seriesName(row.category);
  if (series) notes.push(`Reihe: ${series}`);
  const genres = (row.genres ?? []).map((genre) => clean(genre.name ?? '')).filter(Boolean);
  if (genres.length) notes.push(`Genre: ${genres.join(', ')}`);
  if (row.min_price_cents && row.min_price_cents > 0) {
    notes.push(`Preis: ab ${(row.min_price_cents / 100).toFixed(2).replace('.', ',')} €`);
  }
  if (moved) notes.push(`Hinweis: ${moved}`);
  for (const from of row.rescheduled_from ?? []) {
    if (!Number.isNaN(Date.parse(from))) notes.push(`Verlegt vom: ${germanDate(berlinDay(from))}`);
  }

  const url = `${BASE}/event/${id}`;
  const { availability, availabilityLabel } = ticketState(row, { soldOut, cancelled, moved }, now);
  const subtitle = clean(row.subtitle ?? '');
  const category = series ? undefined : clean(row.category ?? '') || undefined;
  const venue = clean(row.location_name ?? '');

  return {
    id: `${SOURCE_ID}:${id}`,
    sourceId: SOURCE_ID,
    title: softenShouted(title),
    ...(subtitle ? { subtitle: softenShouted(subtitle) } : {}),
    ...(category ? { category } : {}),
    start,
    allDay: false,
    venue: { name: venue || 'Backstage' },
    availability,
    ...(availabilityLabel ? { availabilityLabel } : {}),
    ...(availability === 'available' ? { ticketUrl: url } : {}),
    url,
    ...(notes.length ? { notes } : {}),
  };
}

/**
 * Ticketlage aus zwei Signalen: Statuszusatz im Titel und die Felder
 * `cancelled`, `presale_active`, `min_price_cents`. Die Seite zeigt einen Preis
 * (und den Warenkorb) nur bei aktivem Vorverkauf mit Preis — sonst
 * „Demnächst verfügbar", auch wenn es Karten bei externen Anbietern gibt.
 * Das ist für uns `unknown`, nicht „kein Verkauf".
 */
function ticketState(
  row: RawEvent,
  title: { soldOut: boolean; cancelled: boolean; moved?: string },
  now: Date,
): { availability: Availability; availabilityLabel?: string } {
  if (row.cancelled || title.cancelled) return { availability: 'not_on_sale', availabilityLabel: 'Abgesagt' };
  if (title.moved) return { availability: 'not_on_sale', availabilityLabel: 'Verlegt' };
  if (title.soldOut) return { availability: 'soldout' };
  if (row.presale_active && row.min_price_cents && row.min_price_cents > 0) return { availability: 'available' };
  if (!row.presale_active && row.presale_date && Date.parse(row.presale_date) > now.getTime()) {
    return {
      availability: 'not_on_sale',
      availabilityLabel: `Vorverkauf ab ${germanDate(berlinDay(row.presale_date))}`,
    };
  }
  return { availability: 'unknown' };
}

/** Titel ohne Status- und Datumszusätze. */
function splitTitle(
  raw: string,
  day: string,
): { title: string; soldOut: boolean; cancelled: boolean; moved?: string } {
  const [head, ...suffixes] = raw.split(/\s+\|\s+/);
  const kept: string[] = [head];
  let soldOut = false;
  let cancelled = false;
  let moved: string | undefined;
  const short = `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(2, 4)}`;
  for (const suffix of suffixes) {
    const part = clean(suffix);
    if (/ausverkauft|sold\s*out/i.test(part)) soldOut = true;
    else if (/abgesagt/i.test(part)) cancelled = true;
    else if (/^verlegt\b/i.test(part)) moved = part;
    else if (part === short) continue;
    else kept.push(part);
  }
  return { title: clean(kept.join(' | ')), soldOut, cancelled, moved };
}

/** „36 Jahre Backstage" ist eine Jubiläumsreihe, keine Veranstaltungsart. */
function seriesName(category: string | null | undefined): string | undefined {
  const value = clean(category ?? '');
  return /\bJahre Backstage\b/i.test(value) ? value : undefined;
}

const berlinClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function berlinStart(utc: string): string {
  const parts = berlinClock.formatToParts(new Date(utc));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return berlinIso(berlinDay(utc), hour, minute);
}

function germanDate(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

/** Die Flight-Stücke aneinanderhängen, wie der Browser es tut. */
function flightPayload(html: string): string {
  const pushes = html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)\s*(?:<\/script>|;)/g);
  let payload = '';
  for (const push of pushes) {
    let chunk: unknown;
    try {
      chunk = JSON.parse(push[1]);
    } catch {
      continue;
    }
    if (Array.isArray(chunk) && typeof chunk[1] === 'string') payload += chunk[1];
  }
  return payload;
}

interface RawQuery {
  queryKey?: unknown[];
  state?: { data?: unknown };
}

/** `state.data` der Abfrage `["upcoming", …]`, oder `undefined`, wenn sie fehlt. */
function upcomingRows(payload: string): RawEvent[] | undefined {
  const marker = '"queries":';
  for (let at = payload.indexOf(marker); at >= 0; at = payload.indexOf(marker, at + 1)) {
    const json = balancedJson(payload, at + marker.length);
    if (!json) continue;
    let queries: unknown;
    try {
      queries = JSON.parse(json);
    } catch {
      continue;
    }
    if (!Array.isArray(queries)) continue;
    for (const query of queries as RawQuery[]) {
      if (query?.queryKey?.[0] !== 'upcoming') continue;
      const data = query.state?.data;
      if (Array.isArray(data)) return data as RawEvent[];
    }
  }
  return undefined;
}

/** Ein JSON-Array oder -Objekt ab `start` bis zur passenden Klammer. */
function balancedJson(text: string, start: number): string | undefined {
  const open = text[start];
  if (open !== '[' && open !== '{') return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}
