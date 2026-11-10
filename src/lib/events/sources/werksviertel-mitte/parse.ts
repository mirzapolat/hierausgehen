import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

export const SOURCE_ID = 'werksviertel-mitte';
export const BASE = 'https://www.werksviertel-mitte.de';

/** Der Name des Geländes, falls ein Teaser keinen Ort nennt. */
const GROUNDS = 'Werksviertel-Mitte';

/**
 * Schlagwörter, die keine Veranstaltungsart sind: „Gratis“ ist ein Filter
 * „Allgemein“ der Seite, „placeholder“ steht in leeren Slider-Skeletten.
 */
const NOT_A_CATEGORY = new Set(['gratis', 'placeholder']);

export interface ListPage extends PageResult {
  /** Treffer insgesamt laut Seite (`{"found": N}`) – Grundlage fürs Nachladen. */
  found: number;
  /** Schlüssel für `admin-ajax.php?action=load_teasers`. */
  hash?: string;
}

/**
 * Gefilterte Liste `/veranstaltungen/?date_start=…&date_end=…`.
 *
 * Mit Treffern trägt die Seite genau einen Container `[data-container=teasers]`
 * („N Veranstaltungen gefunden“) mit den ersten 24 Teasern und einem
 * JSON-Skript `{found, hash}`. Ohne Treffer fehlt der Container ganz, die
 * Filterleiste steht aber da – daran wird der leere Zeitraum erkannt.
 */
export function parseListPage(html: string): ListPage {
  const $ = cheerio.load(html);
  const container = $('[data-container="teasers"]').first();

  if (!container.length) {
    const empty = $('[data-component="filters"]').length > 0;
    return { events: [], skipped: 0, empty, found: 0 };
  }

  let found = 0;
  let hash: string | undefined;
  try {
    const meta = JSON.parse(container.find('script').first().html() ?? '') as {
      found?: number;
      hash?: string;
    };
    found = typeof meta.found === 'number' ? meta.found : 0;
    hash = meta.hash || undefined;
  } catch {
    // ohne Meta lässt sich nicht nachladen; die erste Seite zählt trotzdem
  }

  const { events, skipped } = readTeasers($, container.find('[data-component="teaser"]').toArray());
  return { events, skipped, empty: events.length === 0 && found === 0, found, hash };
}

/**
 * Antwort von `admin-ajax.php` (`action=load_teasers`): nackte Teaser ohne
 * Rahmen. Hinter dem letzten Treffer ist die Antwort leer.
 */
export function parseTeaserFragment(html: string): PageResult {
  const $ = cheerio.load(html);
  const teasers = $('[data-component="teaser"]').toArray();
  const { events, skipped } = readTeasers($, teasers);
  return { events, skipped, empty: teasers.length === 0 && clean(html) === '' };
}

function readTeasers($: CheerioAPI, teasers: AnyNode[]): { events: CalendarEvent[]; skipped: number } {
  const events: CalendarEvent[] = [];
  let skipped = 0;
  for (const node of teasers) {
    const event = readTeaser($, node);
    if (event) events.push(event);
    else skipped += 1;
  }
  return { events, skipped };
}

function readTeaser($: CheerioAPI, node: AnyNode): CalendarEvent | undefined {
  const teaser = $(node);
  const link = teaser.find('a[href]').first();
  const url = link.attr('href') ?? '';
  const slug = url.match(/\/veranstaltungen\/([^/?#]+)\/?$/)?.[1];
  const time = teaser.find('time[datetime]').first();
  const stamp = (time.attr('datetime') ?? '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!slug || !stamp) return undefined;

  const heading = teaser.find('h3').first().clone();
  heading.find('.sr-only').remove();
  const subtitleNode = heading.children('span').last();
  const subtitle = clean(subtitleNode.text()).replace(/^[-–]\s*/, '');
  subtitleNode.remove();
  const title = softenShouted(clean(heading.text()));
  if (!title) return undefined;

  const date = stamp[1];
  const start = berlinIso(date, Number(stamp[2]), Number(stamp[3]));
  const end = rangeEnd(date, time);

  const general = teaser
    .find('li[data-type="general"]')
    .toArray()
    .map((li) => clean($(li).text()))
    .filter(Boolean);
  const categories = general.filter((tag) => !NOT_A_CATEGORY.has(tag.toLowerCase()));
  const free = general.some((tag) => tag.toLowerCase() === 'gratis');

  const status = clean(teaser.find('li[data-type="event-status"]').first().text());
  const availability: Availability = status ? 'not_on_sale' : 'unknown';

  const venue = clean(teaser.find('.MlXgSx').first().text()) || GROUNDS;

  const event: CalendarEvent = {
    id: `${SOURCE_ID}:${slug}`,
    sourceId: SOURCE_ID,
    title,
    start,
    allDay: false,
    venue: { name: venue },
    availability,
    url,
  };
  if (subtitle) event.subtitle = subtitle;
  if (categories.length) event.category = categories.join(' / ');
  if (end) event.end = end;
  if (status) event.availabilityLabel = status;
  if (free) event.notes = ['Gratis'];
  return event;
}

/**
 * Mehrtägiges: `<strong>12.11.</strong> bis <strong>20.12.</strong>`. Das Jahr
 * steht nur im Beginn; liegt das Ende im Kalender davor, ist es das Folgejahr.
 */
function rangeEnd(startDate: string, time: cheerio.Cheerio<AnyNode>): string | undefined {
  const text = clean(time.text());
  const match = text.match(/bis\s+(\d{1,2})\.(\d{1,2})\./);
  if (!match) return undefined;
  const [year, startMonth, startDay] = startDate.split('-').map(Number);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const endYear = month < startMonth || (month === startMonth && day < startDay) ? year + 1 : year;
  const iso = `${endYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return berlinIso(iso, 23, 59);
}

/**
 * Detailseite `/veranstaltungen/<slug>/`: Programmtext, Eckdaten (Einlass,
 * Preis, Veranstalter) und der Ticketknopf („Zum Ticket“, Ziel in
 * `data-href`). Eine Detailseite ohne erkennbaren Kopf liefert nichts.
 */
export function parseDetail(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);
  const facts = $('ul.ZZfiXe').first();
  if (!facts.length) return undefined;

  const detail: EventDetail = {};

  // Der erste Textblock ist der Programmtext; danach folgen der Hinweis auf
  // die Veranstalterseite und die Kontaktdaten.
  const paragraphs = $('[data-container="text"]')
    .first()
    .find('p, li')
    .toArray()
    .map((p) => clean($(p).text()))
    .filter(Boolean);
  if (paragraphs.length) detail.description = paragraphs.join('\n\n');

  const notes: string[] = [];
  for (const li of facts.children('li').toArray()) {
    const item = $(li);
    for (const timeNode of item.find('time').toArray()) {
      const text = clean($(timeNode).text()).replace(/,$/, '');
      if (/^Einlass:/.test(text)) notes.push(text);
    }
    const label = clean(item.find('span:not(.sr-only):not([data-icon])').first().text());
    if (label === 'Preis:' || label === 'Veranstalter:') {
      const text = clean(item.text());
      if (text.length > label.length && text.length <= 120) notes.push(text.replace(/:\s*/, ': '));
    }
  }
  if (notes.length) detail.notes = notes;

  const ticket = $('aside [data-href]')
    .toArray()
    .map((el) => $(el))
    .find((el) => /ticket/i.test(el.text()));
  const ticketUrl = ticket?.attr('data-href');
  if (ticketUrl && /^https?:\/\//.test(ticketUrl)) {
    detail.ticketUrl = ticketUrl;
    detail.availability = 'available';
  }

  return Object.keys(detail).length ? detail : undefined;
}
