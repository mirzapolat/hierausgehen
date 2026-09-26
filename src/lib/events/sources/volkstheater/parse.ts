import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser fuer den oeffentlichen Spielplan des Muenchner Volkstheaters.
 *
 * Die Seite rendert den kompletten veroeffentlichten Spielplan serverseitig.
 * Es gibt keine Monats-URL und keinen leichteren JSON-/Fragment-Endpunkt.
 */

const SOURCE_ID = 'volkstheater';
const BASE = 'https://www.muenchner-volkstheater.de';

export interface ParseResult extends PageResult {
  /** Die Schedule wurde gerendert, enthaelt aber keine Termine. */
  empty: boolean;
}

export function parseSchedulePage(html: string, referenceMonth: string): ParseResult {
  const $ = cheerio.load(html);
  const schedule = $('.schedule.view-display-id-schedule').first();
  if (schedule.length === 0) return { events: [], skipped: 0, empty: false };

  const monthWrappers = schedule.find('.schedule--month-wrapper');
  if (monthWrappers.length === 0) return { events: [], skipped: 0, empty: true };

  const firstMonth = monthNumber(clean(monthWrappers.first().find('.schedule--month-title').first().text()));
  let year = inferFirstYear($, firstMonth, referenceMonth);
  let previousMonth = 0;
  let skipped = 0;
  const events: CalendarEvent[] = [];

  monthWrappers.each((_, monthElement) => {
    const month = monthNumber(clean($(monthElement).find('.schedule--month-title').first().text()));
    if (!month) {
      skipped += $(monthElement).find('.schedule--day-content').length;
      return;
    }

    if (previousMonth && month < previousMonth) year++;
    previousMonth = month;

    $(monthElement).find('.schedule--day-wrapper').each((_, dayElement) => {
      const day = Number(clean($(dayElement).find('.schedule--day-title .schedule--day').first().text()));
      const date = day >= 1 && day <= 31 ? `${year}-${pad(month)}-${pad(day)}` : undefined;

      $(dayElement).find('.schedule--day-content').each((__, rowElement) => {
        const row = $(rowElement) as unknown as Row;
        const event = parseEvent(row, date);
        if (event) events.push(event);
        else skipped++;
      });
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  $('script, style, noscript, header, nav, footer, .schedule').remove();

  const paragraphs = uniqueParagraphs(
    $,
    'article.node--type-event .field-node--body p',
  ).filter((text) => text.length > 80);

  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

/* ------------------------------------------------------------------ */

type Row = cheerio.Cheerio<never>;

interface Clock {
  hour: number;
  minute: number;
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  maerz: 3,
  märz: 3,
  mär: 3,
  mrz: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

function parseEvent(row: Row, date: string | undefined): CalendarEvent | undefined {
  const titleLink = row.find('.schedule--title a').first();
  const title = clean(titleLink.text());
  if (!date || !title) return undefined;

  const time = parseTime(clean(row.find('.field-event-time').first().text()));
  const venue = clean(row.find('.field-event-location').first().text());
  const ticket = readTicket(row);
  const href = titleLink.attr('href');
  const url = href ? absolute(href) : `${BASE}/programm/spielplan`;
  const key = eventKey(ticket, date, time, title, url);
  const subtitle = readSubtitle(row);

  return {
    id: `${SOURCE_ID}:${key}`,
    sourceId: SOURCE_ID,
    title: softenShouted(title),
    subtitle,
    category: readCategory(row),
    start: berlinIso(date, time?.hour ?? 0, time?.minute ?? 0),
    allDay: !time,
    venue: { name: venue || 'Münchner Volkstheater' },
    availability: ticket.availability,
    availabilityLabel: ticket.label,
    ticketUrl: ticket.url,
    url,
    notes: collectNotes(row),
  };
}

function parseTime(text: string): Clock | undefined {
  const match = text.match(/(\d{1,2})[.:](\d{2})\s*Uhr/);
  if (!match) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function readSubtitle(row: Row): string | undefined {
  const subtitle = clean(row.find('.field-subtitle').first().text());
  if (subtitle) return subtitle;

  const contributors = clean(row.find('.field-event-author-director').first().text());
  return contributors ? contributors.replace(/\s+\/\s+/g, ' / ') : undefined;
}

function readCategory(row: Row): string | undefined {
  const titlePost = clean(row.find('.schedule--title-post').first().text());
  if (titlePost) return titlePost;

  const classes = (row.find('.schedule--col-3').first().attr('class') ?? '').split(/\s+/);
  const categoryClass = classes
    .filter((name) => name.startsWith('event-type--'))
    .map((name) => name.slice('event-type--'.length))
    .find((slug) => !['extra', 'repertoire'].includes(slug));

  return categoryClass ? categoryFromSlug(categoryClass) : undefined;
}

function categoryFromSlug(slug: string): string {
  const labels: Record<string, string> = {
    schauspiel: 'Schauspiel',
    konzert: 'Konzert',
    lesung: 'Lesung',
    'musikalische-lesung': 'Musikalische Lesung',
    'szenische-lesung': 'Szenische Lesung',
    'buchpraesentation-mit-gespraech': 'Buchpräsentation mit Gespräch',
    diskussion: 'Diskussion',
    slam: 'Slam',
    comedy: 'Comedy',
    'live-podcast': 'Live-Podcast',
  };
  return labels[slug] ?? slug.split('-').map(capitalize).join(' ');
}

interface Ticket {
  availability: Availability;
  label?: string;
  url?: string;
  sourceEventId?: string;
}

function readTicket(row: Row): Ticket {
  const container = row.find('.field-event-ticket-link').first();
  const cta = container.find('a, button, span').first();
  const label = clean(cta.text() || container.text());
  const lower = label.toLocaleLowerCase('de-DE');
  const href = cta.attr('href');
  const url = href?.startsWith('http') ? href : undefined;
  const sourceEventId = href?.match(/\/event\/(\d+)/)?.[1];
  const dot = row.find('.availability-dot').first();
  const dotClasses = dot.attr('class') ?? '';
  const dotLabel = clean(dot.attr('title') ?? dot.attr('aria-label') ?? '');

  if (lower.includes('ausverkauft') || cta.hasClass('sold-out')) {
    return { availability: 'soldout', label: label || undefined, sourceEventId };
  }
  if (/restkarten|letzte|wenige/.test(lower) || dotClasses.includes('availability-yellow')) {
    return { availability: 'limited', label: label || dotLabel || undefined, url, sourceEventId };
  }
  if (dotClasses.includes('availability-red')) {
    return { availability: 'limited', label: label || dotLabel || undefined, url, sourceEventId };
  }
  if (/vorverkauf|ab\s+\d/.test(lower)) {
    return { availability: 'not_on_sale', label: label || undefined, sourceEventId };
  }
  if (/karten|tickets/.test(lower) || dotClasses.includes('availability-green')) {
    return { availability: 'available', label: label || dotLabel || undefined, url, sourceEventId };
  }

  return { availability: label ? 'not_on_sale' : 'unknown', label: label || undefined, url, sourceEventId };
}

function collectNotes(row: Row): string[] | undefined {
  const notes: string[] = [];

  const pre = clean(row.find('.schedule--title-pre').first().text());
  if (pre) notes.push(pre);

  row.find('.field-event-notes, .field-event-date-notes, .availability-extra-text').each((_, element) => {
    const note = clean(row.find(element).text());
    if (note) notes.push(note);
  });

  return notes.length ? [...new Set(notes)] : undefined;
}

function eventKey(
  ticket: Ticket,
  date: string,
  time: Clock | undefined,
  title: string,
  eventUrl: string,
): string {
  if (ticket.sourceEventId) return ticket.sourceEventId;

  const slug = title.toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const path = new URL(eventUrl).pathname.split('/').filter(Boolean).pop() ?? slug;
  return `${date}-${pad(time?.hour ?? 0)}${pad(time?.minute ?? 0)}-${path}`;
}

function inferFirstYear(
  $: cheerio.CheerioAPI,
  firstMonth: number | undefined,
  referenceMonth: string,
): number {
  const [referenceYear, referenceMonthNumber] = referenceMonth.split('-').map(Number);
  if (!firstMonth) return referenceYear;

  for (const element of $('.schedule-menu .schedule--day').toArray()) {
    const match = clean($(element).text()).match(/\d{1,2}\s+(\p{L}+)\s+(\d{4})/u);
    if (match && monthNumber(match[1]) === firstMonth) return Number(match[2]);
  }

  return [referenceYear - 1, referenceYear, referenceYear + 1].reduce((best, candidate) => {
    const distance = Math.abs(candidate * 12 + firstMonth - (referenceYear * 12 + referenceMonthNumber));
    const bestDistance = Math.abs(best * 12 + firstMonth - (referenceYear * 12 + referenceMonthNumber));
    return distance < bestDistance ? candidate : best;
  }, referenceYear);
}

function monthNumber(label: string): number | undefined {
  return MONTHS[label.toLocaleLowerCase('de-DE')];
}

function uniqueParagraphs($: cheerio.CheerioAPI, selector: string): string[] {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  $(selector).each((_, element) => {
    const text = clean($(element).text());
    if (!text || seen.has(text)) return;
    seen.add(text);
    paragraphs.push(text);
  });
  return paragraphs;
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('de-DE') + value.slice(1);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
