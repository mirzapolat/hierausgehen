import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser fuer Kino am Olympiasee.
 *
 * Die Seite `/events/` rendert die kommenden Vorstellungen serverseitig als
 * Avada-Post-Cards. Es gibt keinen belastbaren Monatsparameter und die
 * WordPress-REST-Routen antworteten beim Probing teils mit 503. Deshalb liest
 * der Adapter die oeffentliche Liste einmal und filtert lokal.
 *
 * Datum und Uhrzeit stehen sichtbar in `.show_start_date`/`.show_start_time`;
 * das Jahr steckt nur in der Detail-URL:
 * `/show/<slug>-2026-09-01-1800/`. Die sichtbare Uhrzeit gewinnt, weil sie bei
 * mindestens einem Termin aktueller war als der URL-Slug.
 */

const SOURCE_ID = 'kinoamolympiasee';
const BASE = 'https://kinoamolympiasee.de';
const VENUE = 'Kino am Olympiasee';

export interface ParseResult extends PageResult {
  /**
   * Keine Vorstellung angekuendigt – etwa ausserhalb der Sommersaison. Avada
   * rendert dann entweder einen leeren Karten-Container oder statt der Liste
   * `.fusion-nothing-found`.
   */
  empty: boolean;
}

export function parseEventsPage(html: string): ParseResult {
  const $ = cheerio.load(html);
  const cards = $('.post-card');

  if (cards.length === 0) {
    const empty = $('.fusion-post-cards, ul.fusion-grid-posts-cards, .fusion-nothing-found').length > 0;
    return { events: [], skipped: 0, empty };
  }

  const events: CalendarEvent[] = [];
  let skipped = 0;

  cards.each((_, element) => {
    const card = $(element) as unknown as Card;
    const link = card.find('a[href*="/show/"]').first();
    const url = absolute(link.attr('href'));
    const fromUrl = parseDateFromShowUrl(url);
    const time = parseTime(clean(card.find('.show_start_time').first().text())) ?? fromUrl;
    const rawTitle = clean(card.find('.fusion-title-heading a').first().text());
    const title = clean(rawTitle.replace(/^AUSVERKAUFT\s*[-:–]?\s*/i, ''));

    if (!url || !fromUrl || !time || !title) {
      skipped++;
      return;
    }

    const category = clean(card.find('.card-cat-name').first().text()) || undefined;
    const ticketUrl = clean(card.find('.ticket-url-value').first().text()).replace(/&amp;/g, '&') || undefined;
    const availability = readAvailability(card, rawTitle, ticketUrl);

    events.push({
      id: `${SOURCE_ID}:${eventKey(url)}`,
      sourceId: SOURCE_ID,
      title,
      category,
      start: berlinIso(fromUrl.date, time.hour, time.minute),
      allDay: false,
      venue: { name: VENUE },
      availability,
      availabilityLabel: readAvailabilityLabel(card, availability),
      ticketUrl: availability === 'soldout' ? undefined : ticketUrl,
      url,
    });
  });

  return { events, skipped, empty: false };
}

export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  const description =
    $('meta[name="description"]').first().attr('content') ??
    $('meta[property="og:description"]').first().attr('content');

  return clean(description ?? '') || undefined;
}

/* ------------------------------------------------------------------ */

type Card = cheerio.Cheerio<never>;

interface DateTime {
  date: string;
  hour: number;
  minute: number;
}

function parseDateFromShowUrl(url: string): DateTime | undefined {
  const match = url.match(/\/show\/([^/]*?)-((?:20)\d{2})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-\d+)?\/?$/);
  if (!match) return undefined;

  const [, , year, month, day, hour, minute] = match;
  const parsed = {
    date: `${year}-${month}-${day}`,
    hour: Number(hour),
    minute: Number(minute),
  };

  if (!validDateTime(parsed)) return undefined;
  return parsed;
}

function parseTime(label: string): Pick<DateTime, 'hour' | 'minute'> | undefined {
  const match = label.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;

  const parsed = { hour: Number(match[1]), minute: Number(match[2]) };
  if (parsed.hour > 23 || parsed.minute > 59) return undefined;
  return parsed;
}

function readAvailability(card: Card, rawTitle: string, ticketUrl: string | undefined): Availability {
  const text = clean(card.text()).toLocaleLowerCase('de-DE');
  if (/^AUSVERKAUFT\b/i.test(rawTitle) || text.includes('ausverkauft')) return 'soldout';
  if (ticketUrl) return 'available';
  return 'unknown';
}

function readAvailabilityLabel(card: Card, availability: Availability): string | undefined {
  if (availability === 'soldout') return 'Ausverkauft';
  return clean(card.find('.ticket-popup-trigger .fusion-button-text').first().text()) || undefined;
}

function validDateTime(value: DateTime): boolean {
  const [year, month, day] = value.date.split('-').map(Number);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  if (value.hour > 23 || value.minute > 59) return false;
  return true;
}

function eventKey(url: string): string {
  const match = url.match(/\/show\/([^/]+)\/?$/);
  return match?.[1] ?? encodeURIComponent(url);
}

function absolute(href: string | undefined): string {
  if (!href) return '';
  return new URL(href, BASE).toString();
}
