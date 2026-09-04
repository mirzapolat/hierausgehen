import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { zonedIso } from '../../time.ts';
import { clean, decodeEntities } from '../../text.ts';

/**
 * Parser für die Glasgower Häuser von ATG Tickets
 * (`https://www.atgtickets.com/whats-on/glasgow/`).
 *
 * Die Quelle antwortet an drei Stellen, und jede kann nur eine Sache:
 *
 *  1. **Die Übersicht** ist eine Next.js-Seite. Im HTML steht sie zweimal –
 *     einmal als Markup mit generierten MUI-Klassennamen, einmal als die
 *     Daten, aus denen das Markup entstand: `self.__next_f.push([1,"…"])`.
 *     Die Stücke aneinandergehängt ergeben einen Fliesstext, in dem
 *     `"cards":[…]` die Trefferliste ist. Wir lesen die Daten, nicht das
 *     Markup: die Klassennamen wechseln mit jedem Build, `"cards"` nicht.
 *     Eine Karte ist ein **Stück**, keine Vorstellung – Titel, Gattung, Haus,
 *     Laufzeit als Text („Tue 29 Sep - Sat 3 Oct 2026") und der Weg zur
 *     Produktionsseite.
 *  2. **Der Kalenderdienst** (`calendar-service.core.platform.atgtickets.com`,
 *     GraphQL `getShow`) liefert zu einem Stück *alle* Vorstellungen mit
 *     Zeitpunkt, Ticketlage und Preis. Er ist die einzige Stelle, die das
 *     tut: die Produktionsseite trägt nur die nächsten neun im HTML, was bei
 *     einer Weihnachtspantomime mit siebzig Terminen einundsechzig
 *     verschluckt.
 *  3. **Die Produktionsseite** hält in `window.__PRELOADED_STATE__` den langen
 *     Ankündigungstext, die Spieldauer und – bei einer „Season" – die Liste
 *     der Einzelproduktionen dahinter.
 *
 * **Zeitzone:** `performanceDate` ist echtes UTC, kein als `Z` verkleideter
 * Wandkalender. Nachgeprüft an einem Lauf über die Zeitumstellung hinweg
 * (Scottish Opera, Turandot): 22.10. steht als `18:15Z`, 28.10. als `19:15Z` –
 * beide Abende beginnen um 19:15 Ortszeit. Bestätigt durch `showTimes` der
 * Produktionsseite („Tue and Thu at 20:00" zu einem `19:00Z` im Sommer).
 * Umgerechnet wird deshalb über die Zeitzone, nie durch Abschneiden des `Z`.
 *
 * **Vergangenheit** kennt die Quelle nicht: ein laufendes Stück führt nur die
 * noch kommenden Abende. Das ist keine Lücke, sondern die Auskunft eines
 * Ticketshops.
 */

export const SOURCE_ID = 'atg-glasgow';
export const BASE = 'https://www.atgtickets.com';
export const TIME_ZONE = 'Europe/London';

/** Ein Stück aus der Übersicht – noch kein Termin. */
export interface ShowCard {
  /** `show_…` aus der Karte; nur zum Entdoppeln der Liste. */
  id: string;
  title: string;
  /** Slug der Produktion, z. B. `six`. Fehlt bei einer „Season"-Karte. */
  titleSlug?: string;
  /** Slug des Hauses, z. B. `theatre-royal-glasgow`. */
  venueSlug?: string;
  /** Anzeigename des Hauses, z. B. „Theatre Royal Glasgow". */
  venue?: string;
  /** Gattungen im Wortlaut der Quelle („Musicals", „Talk"). */
  genre: string[];
  /** Produktionsseite; bei einer „Season" die Sammelseite. */
  url: string;
  /** Erster Tag des Laufs, `YYYY-MM-DD`. Fehlt bei „Until …". */
  runFrom?: string;
  /** Letzter Tag des Laufs. */
  runTo?: string;
  /** Laufzeit im Wortlaut („Tue 29 Sep - Sat 3 Oct 2026"). */
  runLabel: string;
}

export interface ParsedList {
  shows: ShowCard[];
  /** Zahl der Ergebnisseiten laut Seitendaten; 1, wenn keine dasteht. */
  pageCount: number;
  /** Zahl der Treffer über alle Seiten, wie die Quelle sie nennt. */
  found?: number;
  /** Ist das überhaupt die Übersicht? Sonst: Aufbau geändert. */
  recognised: boolean;
}

/** Eine Produktion hinter einer „Season"-Sammelkarte. */
export interface SeriesEntry {
  title: string;
  venue?: string;
  titleSlug: string;
  venueSlug: string;
  runLabel: string;
}

export function parseListPage(html: string): ParsedList {
  const payload = flightPayload(html);
  const cards = readJson<RawCard[]>(payload, '"cards":');
  if (!cards) return { shows: [], pageCount: 1, recognised: false };

  const pageCount = readNumber(payload, '"totalPages":') ?? 1;
  const found = readNumber(payload, '"found":');

  const shows: ShowCard[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const show = toShowCard(card);
    if (!show || seen.has(show.id)) continue;
    seen.add(show.id);
    shows.push(show);
  }

  return { shows, pageCount, found, recognised: true };
}

/**
 * Die Produktionen hinter einer „Season"-Karte.
 *
 * Zwei der 101 Karten führen nicht auf eine Produktionsseite, sondern auf eine
 * Sammelseite ohne Haus im Pfad (`/shows/scottish-ballet-emergence/`). Erst
 * `seriesCollection` dort nennt die Paare aus Stück und Haus, mit denen der
 * Kalenderdienst etwas anfangen kann.
 */
export function parseSeasonPage(html: string): SeriesEntry[] {
  const state = preloadedState(html);
  const series = (state?.show?.setData?.seriesCollection ?? []) as RawSeries[];
  return series.flatMap((entry) => {
    const titleSlug = text(entry?.titleSlug);
    const venueSlug = text(entry?.venueSlug);
    if (!titleSlug || !venueSlug) return [];
    return [
      {
        title: clean(decodeEntities(text(entry.title) ?? titleSlug)),
        venue: text(entry.venue),
        titleSlug,
        venueSlug,
        runLabel: text(entry.salePeriod) ?? '',
      },
    ];
  });
}

/**
 * Ankündigungstext und Spieldauer von der Produktionsseite.
 *
 * Beides steht als Feld in `window.__PRELOADED_STATE__` – kein Grund, im
 * gerenderten Markup danach zu suchen. `description` ist der lange Text mit
 * Auszeichnungen, `overview` der Vorspann; fehlt der lange, nehmen wir den
 * kurzen. Besetzung, Pressestimmen, Saalpläne und Zusatzverkäufe stehen in
 * eigenen Feldern und bleiben draussen.
 */
export function parseShowDetail(html: string): EventDetail | undefined {
  const data = preloadedState(html)?.show?.showData as RawShowData | undefined;
  if (!data) return undefined;

  const description = htmlToText(data.description) ?? htmlToText(data.overview);
  const duration = text(data.duration);

  const detail: EventDetail = {
    description,
    notes: duration ? [`Duration: ${duration}`] : undefined,
  };
  return detail.description || detail.notes ? detail : undefined;
}

/**
 * Die Antwort des Kalenderdienstes zu einem Stück in Termine übersetzen.
 *
 * Wirft, wenn die Antwort keine Vorstellungsliste enthält – ein Stück ohne
 * Vorstellungen gibt es im Verkauf nicht, das wäre ein Umbau am Dienst.
 */
export function parsePerformances(json: string, show: ShowCard): CalendarEvent[] {
  let response: RawShowResponse;
  try {
    response = JSON.parse(json) as RawShowResponse;
  } catch {
    throw new Error(`Antwort des Kalenderdienstes ist kein JSON (${show.titleSlug})`);
  }

  const performances: RawPerformance[] | undefined = response.data?.getShow?.show?.performances;
  if (!Array.isArray(performances)) {
    const reason = response.errors?.[0]?.message ?? 'keine Vorstellungsliste';
    throw new Error(`Kalenderdienst ohne Termine für ${show.titleSlug}: ${reason}`);
  }

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const performance of performances) {
    const id = typeof performance?.id === 'string' ? performance.id : undefined;
    const start = localIso(performance?.dates?.performanceDate);
    if (!id || !start || seen.has(id)) continue;
    seen.add(id);
    events.push(toEvent(show, performance, id, start));
  }
  return events;
}

/** Läuft das Stück irgendwann zwischen den beiden Tagen? */
export function overlapsRange(show: ShowCard, from: string, to: string): boolean {
  const first = show.runFrom ?? show.runTo;
  const last = show.runTo ?? show.runFrom;
  // Ohne lesbare Laufzeit lieber nachfragen als stillschweigend auslassen.
  if (!first || !last) return true;
  return last >= from && first <= to;
}

// ---------------------------------------------------------------- Karte

function toShowCard(card: RawCard): ShowCard | undefined {
  const title = text(card?.title);
  const url = text(card?.moreInfo?.url);
  const id = text(card?.id);
  if (!title || !url || !id) return undefined;

  // "/shows/six/theatre-royal-glasgow/" -> ["shows", "six", "theatre-royal-glasgow"]
  const segments = url.split('/').filter(Boolean);
  const runLabel = text(card?.dates) ?? '';
  const run = parseRun(runLabel);

  return {
    id,
    title: clean(decodeEntities(title)),
    titleSlug: segments[0] === 'shows' ? segments[1] : undefined,
    venueSlug: segments[0] === 'shows' ? segments[2] : undefined,
    venue: text(card?.venueInfo),
    genre: Array.isArray(card?.genre) ? card.genre.filter((g): g is string => !!text(g)) : [],
    url: absolute(url),
    runLabel,
    ...run,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Sat 5 Sep 2026" – Wochentag und Jahr dürfen fehlen. */
const DAY = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/;

/**
 * Die Laufzeit einer Karte in zwei Tage übersetzen.
 *
 * Vier Formen kommen vor, alle 101 Karten eines vollen Abrufs fallen darunter:
 *
 *     Fri 4 Sep 2026                     ein Abend
 *     Tue 8 Sep - Sat 19 Sep 2026        Lauf, Jahr nur rechts
 *     Sat 21 Nov 2026 - Sun 3 Jan 2027   Lauf über den Jahreswechsel
 *     Until Sat 5 Sep 2026               laufendes Stück, Beginn war früher
 *
 * Beim Lauf erbt die linke Seite das Jahr vom rechten Rand – „8 Sep" ohne Jahr
 * neben „19 Sep 2026" ist derselbe September.
 */
export function parseRun(label: string): { runFrom?: string; runTo?: string } {
  const value = clean(label);
  if (!value) return {};

  const until = /^Until\s+(.+)$/i.exec(value);
  if (until) return { runTo: parseDay(until[1]) };

  const parts = value.split(/\s+-\s+|\s+–\s+/);
  if (parts.length === 2) {
    const runTo = parseDay(parts[1]);
    const runFrom = parseDay(parts[0], runTo?.slice(0, 4));
    return { runFrom, runTo };
  }

  const day = parseDay(value);
  return { runFrom: day, runTo: day };
}

function parseDay(value: string, fallbackYear?: string): string | undefined {
  const match = DAY.exec(clean(value));
  if (!match) return undefined;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const year = match[3] ?? fallbackYear;
  if (!month || !year) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

// ------------------------------------------------------------- Termine

/**
 * Ticketlage.
 *
 * Der Dienst kennt vier Stufen; die Seite selbst warnt erst bei `LOW`
 * („Low availability!"). `MEDIUM` ist keine Knappheit, sondern der normale
 * Zustand eines gut laufenden Abends – wer das als „Restkarten" ausgibt,
 * färbt zwei Drittel des Spielplans falsch.
 */
function availabilityOf(status: string | undefined): {
  availability: Availability;
  availabilityLabel?: string;
} {
  switch (status) {
    case 'SOLDOUT':
      return { availability: 'soldout', availabilityLabel: 'Sold out' };
    case 'LOW':
      return { availability: 'limited', availabilityLabel: 'Low availability!' };
    case 'MEDIUM':
    case 'GOOD':
      return { availability: 'available' };
    default:
      return { availability: 'unknown' };
  }
}

function toEvent(
  show: ShowCard,
  performance: RawPerformance,
  id: string,
  start: string,
): CalendarEvent {
  const { availability, availabilityLabel } = availabilityOf(performance.availabilityStatus);
  const notes: string[] = [];
  const access = text(performance.accessibilityType);
  if (access) notes.push(access);
  const price = performance.price?.minPrice;
  if (typeof price === 'number' && price > 0) notes.push(`Tickets from £${price.toFixed(2)}`);

  const genre = show.genre.join(' / ');

  return {
    id: `${SOURCE_ID}:${id}`,
    sourceId: SOURCE_ID,
    title: show.title,
    category: genre || undefined,
    start,
    allDay: false,
    venue: { name: show.venue ?? 'ATG Tickets Glasgow' },
    availability,
    availabilityLabel,
    ticketUrl: show.titleSlug && show.venueSlug
      ? `${BASE}/shows/${show.titleSlug}/${show.venueSlug}/tickets/${id}`
      : undefined,
    url: show.url,
    notes: notes.length > 0 ? notes : undefined,
  };
}

const LOCAL_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "2026-09-29T19:00:00.000Z" (UTC) -> "2026-09-29T20:00:00+01:00" (Ortszeit). */
function localIso(utc: unknown): string | undefined {
  if (typeof utc !== 'string') return undefined;
  const instant = new Date(utc);
  if (Number.isNaN(instant.getTime())) return undefined;

  const parts: Record<string, string> = {};
  for (const part of LOCAL_TIME.formatToParts(instant)) parts[part.type] = part.value;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return zonedIso(TIME_ZONE, day, Number(parts.hour), Number(parts.minute));
}

// ----------------------------------------------------- Daten im Markup

/**
 * Die Nutzlast der Next.js-Seite.
 *
 * Sie kommt in Stücken (`self.__next_f.push([1,"…"])`), die der Browser
 * aneinanderhängt. Wir tun dasselbe, denn ein Feld kann über zwei Stücke
 * hinweg brechen – `"cards"` im einen, die Karten im nächsten.
 */
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

/** `window.__PRELOADED_STATE__` der Produktionsseite. */
function preloadedState(html: string): RawState | undefined {
  const marker = 'window.__PRELOADED_STATE__=';
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  const json = balancedJson(html, at + marker.length);
  if (!json) return undefined;
  try {
    return JSON.parse(json) as RawState;
  } catch {
    return undefined;
  }
}

function readNumber(payload: string, key: string): number | undefined {
  const at = payload.indexOf(key);
  if (at < 0) return undefined;
  const match = /^\s*(-?\d+)/.exec(payload.slice(at + key.length));
  return match ? Number(match[1]) : undefined;
}

function readJson<T>(payload: string, key: string): T | undefined {
  const at = payload.indexOf(key);
  if (at < 0) return undefined;
  const json = balancedJson(payload, at + key.length);
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/**
 * Den Wert ab `from` ausschneiden – bis die Klammern wieder aufgehen.
 *
 * Zeichenketten werden dabei übersprungen, sonst zählt eine Klammer in einem
 * Stücktitel („Six (Tour)") mit und der Ausschnitt bricht mitten im Feld ab.
 */
function balancedJson(text: string, from: number): string | undefined {
  let start = from;
  while (start < text.length && /\s/.test(text[start])) start++;
  const open = text[start];
  if (open !== '{' && open !== '[') return undefined;
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

// ------------------------------------------------------------- Kleinkram

/** Auszeichnungen entfernen, Blöcke als Absätze erhalten. */
function htmlToText(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : undefined;
  if (!raw) return undefined;
  const plain = clean(
    decodeEntities(
      raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, ''),
    ),
  );
  return plain.length >= 40 ? plain : undefined;
}

/** Ein Feld, das wirklich etwas sagt – RSC schreibt `"$undefined"` hinein. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = clean(value);
  if (!trimmed || trimmed.startsWith('$')) return undefined;
  return trimmed;
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `${BASE}${url}`;
}

// ------------------------------------------------------- Fremdformat

interface RawCard {
  id?: unknown;
  title?: unknown;
  dates?: unknown;
  genre?: unknown[];
  venueInfo?: unknown;
  moreInfo?: { url?: unknown };
}

interface RawSeries {
  title?: unknown;
  venue?: unknown;
  salePeriod?: unknown;
  titleSlug?: unknown;
  venueSlug?: unknown;
}

interface RawShowData {
  description?: unknown;
  overview?: unknown;
  duration?: unknown;
}

interface RawState {
  show?: {
    showData?: unknown;
    setData?: { seriesCollection?: unknown } | null;
  };
}

interface RawPerformance {
  id?: unknown;
  dates?: { performanceDate?: unknown };
  availabilityStatus?: string;
  accessibilityType?: unknown;
  price?: { minPrice?: unknown };
}

interface RawShowResponse {
  data?: { getShow?: { show?: { performances?: RawPerformance[] } | null } | null };
  errors?: { message?: string }[];
}
