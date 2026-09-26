import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Open-Air-Kino „Kino, Mond & Sterne" im Westpark.
 *
 * Die Seite ist eine Vue-Anwendung ohne Inhalt im HTML; die Daten kommen als
 * JSON von `/api/projections`, nach Monaten gruppiert:
 *
 *   { data: [ { month, monthValue, items: [ { dt, fd, movie, afp } ] } ],
 *     meta: { seasons: [...] } }
 *
 * Zwei Dinge fehlen dem Format:
 *
 * - **Eine Uhrzeit.** Das Kino beginnt bei Einbruch der Dunkelheit, deshalb
 *   führt es keine Anfangszeit am einzelnen Termin, sondern nur je Monat im
 *   FAQ. Von dort wird sie gelesen (`parseProgrammeStart`); ohne sie bleibt
 *   der Termin ganztägig, statt eine Zeit zu erfinden.
 * - **Eine Spielstätte.** Es gibt nur eine, und sie steht nicht in den Daten.
 */

const SOURCE_ID = 'kinomondsterne';
const BASE = 'https://www.kino-mond-sterne.de';
/** Die einzige Spielstätte, so wie die Quelle sie selbst nennt. */
const VENUE = 'Seebühne im Westpark';
/** Der Kartenverkauf des Hauses – ein Shop für alle Vorstellungen. */
const TICKET_SHOP = 'https://kms.mobi/index.php?standard';

export interface Clock {
  hour: number;
  minute: number;
}

export interface ParseResult extends PageResult {
  /** Die Antwort war gültig, nennt aber keine Vorstellung (Spielzeitpause). */
  empty: boolean;
}

/**
 * @param starts Anfangszeiten je Monat (1–12) aus `parseProgrammeStart`.
 *               Fehlt der Monat, läuft der Termin ganztägig.
 */
export function parseProjections(body: string, starts: Map<number, Clock>): ParseResult {
  let payload: { data?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return { events: [], skipped: 0, empty: false };
  }

  // Ohne `data`-Liste ist das keine Antwort, die wir kennen.
  if (!Array.isArray(payload.data)) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;
  let seen = 0;

  for (const group of payload.data as Record<string, unknown>[]) {
    const items = Array.isArray(group.items) ? (group.items as Record<string, unknown>[]) : [];
    seen += items.length;

    for (const item of items) {
      const movie = item.movie as Record<string, unknown> | undefined;
      const date = parseDate(item.dt);
      const title = clean(String(movie?.t ?? ''));
      const slug = clean(String(movie?.s ?? ''));

      if (!date || !title || !slug) {
        skipped++;
        continue;
      }

      const start = starts.get(Number(date.slice(5, 7)));
      const forSale = item.afp === true;

      events.push({
        // Ein Film läuft an mehreren Abenden – erst Titel und Tag zusammen
        // sind eindeutig.
        id: `${SOURCE_ID}:${slug}-${date}`,
        sourceId: SOURCE_ID,
        title,
        description: clean(String(movie?.d ?? '')) || undefined,
        // Gattung führt die Quelle nicht (`movie.g` ist durchgehend leer).
        start: berlinIso(date, start?.hour ?? 0, start?.minute ?? 0),
        allDay: !start,
        venue: { name: VENUE },
        // `afp` ist das einzige Kartensignal: die Quelle zeigt genau dann
        // einen Kaufen-Knopf. Es fällt auch weg, sobald der Abend vorbei ist –
        // das rechnet die Anzeige selbst heraus.
        availability: forSale ? 'available' : 'not_on_sale',
        ticketUrl: forSale ? TICKET_SHOP : undefined,
        url: `${BASE}/movie/${slug}/${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`,
        notes: collectNotes(movie),
      });
    }
  }

  // Leer heisst: die Quelle nennt keine Vorstellung. Nennt sie welche, die
  // sich nicht lesen lassen, ist das ein Formatwechsel und kein leerer Monat.
  return { events, skipped, empty: seen === 0 };
}

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, 'märz': 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

/**
 * Anfangszeiten je Monat aus dem FAQ (`/api/single/wichtiges`):
 *
 *   „Programmstart: Im Juni gegen 21.30 Uhr, im Juli gegen 21.15 Uhr,
 *    im August gegen 21.00 Uhr und im September gegen 20.15 Uhr."
 *
 * Bewusst von der Quelle gelesen statt im Code gepflegt – die Zeiten hängen am
 * Sonnenuntergang und ändern sich mit dem Spielplan. Lässt sich der Satz nicht
 * lesen, kommt eine leere Zuordnung zurück und die Termine bleiben ganztägig.
 */
export function parseProgrammeStart(body: string): Map<number, Clock> {
  const starts = new Map<number, Clock>();

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return starts;
  }

  const segment = findProgrammeStartSegment(payload);
  if (!segment) return starts;

  // Monatsnamen sammeln, bis eine Uhrzeit kommt – die gilt dann für alle
  // seither genannten Monate ("Im Juni & Juli 20.00 Uhr").
  let pending: number[] = [];
  for (const token of segment.split(/(\d{1,2}[.:]\d{2}\s*Uhr)/)) {
    const time = token.match(/^(\d{1,2})[.:](\d{2})\s*Uhr$/);
    if (!time) {
      pending.push(...monthsIn(token));
      continue;
    }

    const hour = Number(time[1]);
    const minute = Number(time[2]);
    if (hour <= 23 && minute <= 59) {
      for (const month of pending) starts.set(month, { hour, minute });
    }
    pending = [];
  }

  return starts;
}

/* ------------------------------------------------------------------ */

/** Der Satz hinter „Programmstart:" – ohne Einlass- und Abendkassenzeiten. */
function findProgrammeStartSegment(payload: unknown): string | undefined {
  for (const answer of collectStrings(payload)) {
    if (!answer.includes('Programmstart')) continue;

    const text = clean(cheerio.load(answer.replace(/<\/p>/gi, '</p>\n')).root().text());
    const match = text.match(/Programmstart:?\s*([^]*?)(?:\n|$)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Die FAQ-Antworten stecken verschachtelt im Seitenobjekt. */
function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectStrings(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((entry) => collectStrings(entry, depth + 1));
  }
  return [];
}

function monthsIn(text: string): number[] {
  const found: number[] = [];
  for (const word of text.toLocaleLowerCase('de-DE').match(/\p{L}+/gu) ?? []) {
    const month = MONTHS[word];
    if (month) found.push(month);
  }
  return found;
}

/** `dt` trägt Tag, Monat und Jahr getrennt und als Zeichenkette. */
function parseDate(value: unknown): string | undefined {
  const dt = value as Record<string, unknown> | undefined;
  const day = Number(dt?.d);
  const month = Number(dt?.m);
  const year = Number(dt?.y);

  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  if (!Number.isInteger(month) || month < 1 || month > 12) return undefined;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return undefined;

  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Fassung und Spieldauer als Zusatzinfos. */
function collectNotes(movie: Record<string, unknown> | undefined): string[] | undefined {
  const notes: string[] = [];

  const version = clean(String(movie?.o ?? ''));
  if (version && version !== 'null') notes.push(version);

  const minutes = Number(movie?.du);
  if (Number.isFinite(minutes) && minutes > 0) notes.push(`${minutes} Min.`);

  return notes.length ? notes : undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
