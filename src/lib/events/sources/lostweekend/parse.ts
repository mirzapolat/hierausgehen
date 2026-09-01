import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für das Lost Weekend (Modern Events Calendar in WordPress).
 *
 * Die Terminliste kommt als JSON-Umschlag von `admin-ajax.php`
 * (`action=mec_list_load_month`); der Monat steckt als HTML-Fragment im Feld
 * `html`. Darin ist jeder Termin ein `article.mec-event-article`, umschlossen
 * von `div.mec-event-list-standard`. Dieser Container ist zugleich das Signal,
 * dass die Liste überhaupt gerendert wurde – ein Monat ohne Veranstaltung ist
 * schlicht ein leerer Container, keine eigene Leermeldung.
 *
 * Was die Liste **nicht** hergibt: Endzeit, Kartenlage, Kartenlink und den
 * vollständigen Programmtext (sie kürzt ihn mit "[…]"). Gattung und langer
 * Text stehen dafür in der offenen WordPress-REST-Schnittstelle
 * (`/wp-json/wp/v2/mec-events`) – siehe `parsePostDetails`.
 */

const SOURCE_ID = 'lostweekend';
const BASE = 'https://lostweekend.de';

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke, die nicht verwertbar waren – für Monitoring/Logs. */
  skipped: number;
  /** Die Liste wurde gerendert, enthält aber keinen Termin. */
  empty: boolean;
  /** `count` aus dem Umschlag – dient dem Vergleich mit den gelesenen Blöcken. */
  reported?: number;
  /** WordPress-Post-IDs der Termine dieses Monats, ohne Wiederholungen. */
  postIds: number[];
}

/**
 * @param body   Antwortkörper von `admin-ajax.php` (JSON mit Feld `html`).
 * @param month  Der angefragte Monat "YYYY-MM". Die Liste schreibt bei jedem
 *               Termin nur Tag und englisches Monatskürzel ("01 Sep"); das
 *               Jahr ergibt sich aus der Anfrage.
 */
export function parseMonthResponse(body: string, month: string): ParseResult {
  let envelope: { html?: unknown; count?: unknown };
  try {
    envelope = JSON.parse(body) as typeof envelope;
  } catch {
    return { events: [], skipped: 0, empty: false, postIds: [] };
  }

  const html = typeof envelope.html === 'string' ? envelope.html : '';
  const reported = typeof envelope.count === 'number' ? envelope.count : undefined;
  return { ...parseMonthFragment(html, month), reported };
}

/** Nur das HTML-Fragment, ohne den JSON-Umschlag. */
export function parseMonthFragment(html: string, month: string): Omit<ParseResult, 'reported'> {
  const $ = cheerio.load(html);

  const container = $('.mec-event-list-standard');
  if (container.length === 0) return { events: [], skipped: 0, empty: false, postIds: [] };

  const events: CalendarEvent[] = [];
  const postIds = new Set<number>();
  let skipped = 0;

  $('article.mec-event-article').each((_, element) => {
    const article = $(element) as unknown as Article;

    const link = article.find('.mec-event-title a').first();
    const title = clean(link.text());
    const date = parseDate(clean(article.find('.mec-start-date-label').first().text()), month);
    const postId = Number(article.find('[data-event-id]').first().attr('data-event-id'));

    if (!title || !date || !Number.isInteger(postId)) {
      skipped++;
      return;
    }

    const time = parseTime(clean(article.find('.mec-start-time').first().text()));
    const href = link.attr('href');

    postIds.add(postId);
    events.push({
      // Ein Post steht für die ganze Reihe: "Open Stage" liegt mit derselben
      // ID auf vielen Terminen, an einem Tag sogar zweimal zu verschiedenen
      // Zeiten. Erst Post, Tag und Uhrzeit zusammen sind eindeutig.
      id: `${SOURCE_ID}:${postId}-${date}-${pad(time?.hour ?? 0)}${pad(time?.minute ?? 0)}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      description: clean(article.find('.mec-event-description').first().text()) || undefined,
      // Gattung liefert die Liste nicht – sie kommt aus `parsePostDetails`.
      start: berlinIso(date, time?.hour ?? 0, time?.minute ?? 0),
      allDay: !time,
      venue: { name: clean(article.find('.mec-venue-details > span').first().text()) || 'Lost Weekend' },
      // Die Liste sagt nichts über Karten; der Knopf "View Detail" führt nur
      // auf dieselbe Veranstaltungsseite.
      availability: 'unknown',
      url: href ? absolute(href) : `${BASE}/events/`,
    });
  });

  return { events, skipped, empty: events.length === 0, postIds: [...postIds] };
}

/** `/wp-json/wp/v2/mec_category` → Gattungsnamen je Term-ID. */
export function parseCategoryNames(body: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const term of asArray(body)) {
    const id = term.id;
    const name = typeof term.name === 'string' ? decodeEntities(term.name) : '';
    if (typeof id === 'number' && name) names.set(id, name);
  }
  return names;
}

export interface PostDetail {
  category?: string;
  description?: string;
}

/**
 * `/wp-json/wp/v2/mec-events` → Gattung und vollständiger Programmtext,
 * abgelegt unter der Veranstaltungsadresse.
 *
 * Ein Post trägt oft mehrere Gattungen ("Dance", "Other", "Party"), die
 * WordPress alphabetisch ausgibt. Die Oberfläche filtert über genau eine, also
 * fällt die Wahl auf die erste – ohne "Other", das ist der Sammeleimer der
 * Quelle und sagt nichts aus.
 */
export function parsePostDetails(body: string, categoryNames: Map<number, string>): Map<string, PostDetail> {
  const details = new Map<string, PostDetail>();

  for (const post of asArray(body)) {
    const link = typeof post.link === 'string' ? post.link : '';
    if (!link) continue;

    const terms = Array.isArray(post.mec_category) ? (post.mec_category as unknown[]) : [];
    const category = terms
      .map((id) => (typeof id === 'number' ? categoryNames.get(id) : undefined))
      .find((name) => name && name !== 'Other');

    const rendered = (post.content as { rendered?: unknown } | undefined)?.rendered;
    const description = typeof rendered === 'string' ? htmlToText(rendered) : undefined;

    details.set(urlKey(link), { category, description });
  }

  return details;
}

/**
 * Gattung und langen Text an die Termine heften. Der Kurztext der Liste bleibt
 * stehen, solange der Text aus der Schnittstelle nicht mehr hergibt – so
 * gewinnt kein leerer Beitrag gegen die vorhandene Kurzinfo.
 */
export function applyPostDetails(
  events: CalendarEvent[],
  details: Map<string, PostDetail>,
): CalendarEvent[] {
  if (details.size === 0) return events;

  return events.map((event) => {
    const detail = details.get(urlKey(event.url));
    if (!detail) return event;

    const description =
      detail.description && detail.description.length > (event.description?.length ?? 0)
        ? detail.description
        : event.description;

    if (description === event.description && !detail.category) return event;
    return { ...event, category: detail.category ?? event.category, description };
  });
}

/* ------------------------------------------------------------------ */

type Article = cheerio.Cheerio<never>;

/** Englische Monatskürzel, wie die Liste sie schreibt. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "01 Sep" plus den angefragten Monat zu einem ISO-Tag verbinden. Das Jahr
 * steht nicht am Termin; es wird so gewählt, dass der Termin dem angefragten
 * Monat am nächsten liegt.
 */
function parseDate(label: string, month: string): string | undefined {
  const match = label.match(/(\d{1,2})\s+(\p{L}+)/u);
  if (!match) return undefined;

  const day = Number(match[1]);
  const monthNumber = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (!monthNumber || day < 1 || day > 31) return undefined;

  const [requestedYear, requestedMonth] = month.split('-').map(Number);
  const target = requestedYear * 12 + requestedMonth;
  const year = [requestedYear - 1, requestedYear, requestedYear + 1].reduce((best, candidate) =>
    Math.abs(candidate * 12 + monthNumber - target) < Math.abs(best * 12 + monthNumber - target)
      ? candidate
      : best,
  );

  return `${year}-${pad(monthNumber)}-${pad(day)}`;
}

/** "6:30 pm", "12:00 pm", ersatzweise "18:30". */
function parseTime(label: string): { hour: number; minute: number } | undefined {
  const match = label.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!match) return undefined;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = match[3]?.toLowerCase();
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;

  return { hour, minute };
}

/** WordPress liefert Programmtexte als HTML – Absätze bleiben Absätze. */
function htmlToText(html: string): string | undefined {
  const $ = cheerio.load(html);
  const blocks = $('p, li')
    .toArray()
    .map((element) => clean($(element).text()))
    .filter(Boolean);

  const text = blocks.length ? [...new Set(blocks)].join('\n\n') : clean($.root().text());
  return text || undefined;
}

function asArray(body: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

function decodeEntities(value: string): string {
  return clean(cheerio.load(`<span>${value}</span>`)('span').text());
}

/** Adressen vergleichen sich zuverlässiger ohne Schrägstrich am Ende. */
function urlKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
