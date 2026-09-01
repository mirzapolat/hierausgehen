import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, decodeEntities, softenShouted } from '../../text.ts';

type Card = cheerio.Cheerio<never>;

const SOURCE_ID = 'deutsches-theater';
const BASE = 'https://www.deutsches-theater.de';

export interface ProgrammeEntry {
  id: string;
  title: string;
  category?: string;
  venue?: string;
  url: string;
  ticketUrl?: string;
  dateLabel: string;
  dateRange?: DateRange;
  price?: string;
  availability: Availability;
  availabilityLabel?: string;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface DetailInfo {
  title?: string;
  description?: string;
  category?: string;
  venue?: string;
  timeRules: TimeRule[];
  notes?: string[];
  ticketUrl?: string;
}

interface TimeRule {
  weekdays?: number[];
  times: Clock[];
}

interface Clock {
  hour: number;
  minute: number;
}

export interface ParseListResult {
  entries: ProgrammeEntry[];
  skipped: number;
  empty: boolean;
}

export function parseProgrammeList(html: string): ParseListResult {
  const $ = cheerio.load(html);
  const container = $('.vc_row').first();
  if (container.length === 0) return { entries: [], skipped: 0, empty: false };

  const entries: ProgrammeEntry[] = [];
  let skipped = 0;

  $('.wpb_column.vc_col-sm-12').each((_, element) => {
    const card = $(element) as unknown as Card;
    const dateLabel = clean(card.find('.zeitraum').first().text());
    const showUrl = card.find('.dt-teaser a[href*="deutsches-theater.de"]').first().attr('href');
    const ticketUrl = card.find('.preise a[href]').first().attr('href');
    const dateRange = parseDateRange(dateLabel);

    if (!dateLabel || !showUrl || !dateRange) {
      skipped++;
      return;
    }

    const info = card.find('.weitere-informationen > div').toArray().map((node) => clean($(node).text()));
    const category = info[0] || undefined;
    const venue = info[1] || undefined;
    const price = clean(card.find('.preise').first().text()) || priceFromInfo(info);
    const imageSignal = clean([
      card.find('img').first().attr('src'),
      card.find('img').first().attr('alt'),
      card.find('.teaser-uv-title').first().text(),
    ].filter(Boolean).join(' '));
    const ticket = readAvailability({ imageSignal, ticketUrl, price });
    const title = readListTitle($, card, showUrl);

    entries.push({
      id: slugFromUrl(showUrl),
      title,
      category,
      venue,
      url: showUrl,
      ticketUrl,
      dateLabel,
      dateRange,
      price,
      availability: ticket.availability,
      availabilityLabel: ticket.label,
    });
  });

  return { entries, skipped, empty: entries.length === 0 };
}

export function parseDetailPage(html: string): DetailInfo {
  const $ = cheerio.load(html);
  const facts = readFacts($);
  return {
    title: readDetailTitle($),
    description: parseDetailDescription(html),
    category: facts.get('genre'),
    venue: facts.get('ort'),
    timeRules: parseTimeRules(facts.get('vorstellungsbeginn') ?? facts.get('beginn') ?? ''),
    notes: readDetailNotes(facts),
    ticketUrl: $('.dt-tickets a[href]').first().attr('href') || undefined,
  };
}

export function parseDetailDescription(html: string): string | undefined {
  const cut = cutBeforeDetails(html);
  const $ = cheerio.load(cut);
  const seen = new Set<string>();
  const paragraphs: string[] = [];

  $('.wpb_text_column:not(.hinweis) p').each((_, element) => {
    const text = clean($(element).text());
    if (text.length < 60 || /^Fotos?\s*©/i.test(text) || seen.has(text)) return;
    seen.add(text);
    paragraphs.push(text);
  });

  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

export function buildEvents(entry: ProgrammeEntry, detail?: DetailInfo): CalendarEvent[] {
  const range = entry.dateRange;
  if (!range) return [];

  const title = softenShouted(detail?.title ?? entry.title);
  const category = clean(detail?.category ?? entry.category ?? '') || undefined;
  const venue = clean(detail?.venue ?? entry.venue ?? '') || 'Deutsches Theater München';
  const description = detail?.description;
  const ticketUrl = detail?.ticketUrl ?? entry.ticketUrl;
  const notes = collectEventNotes(entry, detail);
  const occurrences = expandOccurrences(range, detail?.timeRules ?? []);

  return occurrences.map((occurrence) => ({
    id: `${SOURCE_ID}:${entry.id}:${occurrence.date}${occurrence.time ? `-${pad(occurrence.time.hour)}${pad(occurrence.time.minute)}` : ''}`,
    sourceId: SOURCE_ID,
    title,
    description,
    category,
    start: berlinIso(occurrence.date, occurrence.time?.hour ?? 0, occurrence.time?.minute ?? 0),
    allDay: !occurrence.time,
    venue: { name: venue },
    availability: entry.availability,
    availabilityLabel: entry.availabilityLabel,
    ticketUrl,
    url: entry.url,
    notes,
  }));
}

function readListTitle($: cheerio.CheerioAPI, card: Card, url: string): string {
  const visible = clean(card.find('.teaser-uv-title').first().text());
  if (visible) return visible;

  // Die meisten Karten tragen nur den Sammel-Alt-Text "Veranstaltung im
  // Deutschen Theater München" – daraus wäre "Veranstaltung" als Titel
  // schlechter als der Slug aus der Adresse.
  const alt = clean(card.find('img').first().attr('alt') ?? '');
  const named = GENERIC_ALT.test(alt)
    ? ''
    : alt.replace(/\s*[–-]?\s*im Deutschen Theater München$/i, '');
  if (named) return named;

  return titleFromSlug(slugFromUrl(url));
}

/** Alt-Text ohne eigenen Titel – auf jeder zweiten Karte derselbe. */
const GENERIC_ALT = /^Veranstaltung(\s*[–-]?\s*im Deutschen Theater München)?$/i;

function readDetailTitle($: cheerio.CheerioAPI): string | undefined {
  return clean($('h1').first().text() || $('.kv-title').first().text()) || undefined;
}

function readFacts($: cheerio.CheerioAPI): Map<string, string> {
  const facts = new Map<string, string>();
  $('.dt-fakten .block').each((_, element) => {
    const block = $(element);
    const label = clean(block.find('label').first().text()).replace(/:$/, '').toLocaleLowerCase('de-DE');
    const valueHtml = block.find('.fakten-vorstellung-rechts').first().html() ?? '';
    // Zeilenumbrüche bleiben erhalten: beim Vorstellungsbeginn steht je Zeile
    // eine eigene Regel ("Dienstag - Freitag: 19:30 Uhr").
    // Tags fallen per Regex, deshalb müssen die Entities hier von Hand
    // aufgelöst werden – sonst steht "Kabarett &amp; Comedy" im Genre.
    const value = decodeEntities(
      valueHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '),
    )
      .split('\n')
      .map(clean)
      .filter(Boolean)
      .join('\n');
    if (label && value) facts.set(label, value);
  });
  return facts;
}

function readDetailNotes(facts: Map<string, string>): string[] | undefined {
  const notes: string[] = [];
  for (const label of ['einlass', 'altersempfehlung', 'preview', 'sprache', 'hinweis']) {
    const value = facts.get(label);
    if (value) notes.push(`${capitalize(label)}: ${clean(value)}`);
  }
  return notes.length ? notes : undefined;
}

function collectEventNotes(entry: ProgrammeEntry, detail?: DetailInfo): string[] | undefined {
  const notes = new Set<string>();
  if (entry.price) notes.add(`Preise: ${entry.price}`);
  if (entry.dateLabel.includes(' bis ')) notes.add(`Zeitraum: ${entry.dateLabel}`);
  for (const note of detail?.notes ?? []) notes.add(note);
  return notes.size ? [...notes] : undefined;
}

function parseDateRange(label: string): DateRange | undefined {
  const matches = [...label.matchAll(/(\d{1,2})\.(\d{1,2})\.(?:(\d{2}))?/g)];
  if (matches.length === 0) return undefined;

  if (matches.length === 1) {
    const [, day, month, year] = matches[0];
    if (!year) return undefined;
    const date = isoDate(2000 + Number(year), Number(month), Number(day));
    return date ? { from: date, to: date } : undefined;
  }

  const [, startDay, startMonth, startYear] = matches[0];
  const [, endDay, endMonth, endYear] = matches[matches.length - 1];
  if (!endYear) return undefined;

  let fromYear = startYear ? 2000 + Number(startYear) : 2000 + Number(endYear);
  if (!startYear && Number(startMonth) > Number(endMonth)) fromYear--;

  const from = isoDate(fromYear, Number(startMonth), Number(startDay));
  const to = isoDate(2000 + Number(endYear), Number(endMonth), Number(endDay));
  return from && to ? { from, to } : undefined;
}

function parseTimeRules(text: string): TimeRule[] {
  // Eine Regel je Zeile. Steht alles in einer Zeile, erst nach einer Uhrzeit
  // trennen – sonst zerfiele "Dienstag - Freitag: 19:30 Uhr" in zwei Regeln.
  const lines = text
    .split('\n')
    .flatMap((line) => line.split(/(?<=Uhr)\s*(?=(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b)/i))
    .map(clean)
    .filter(Boolean);
  const rules: TimeRule[] = [];

  for (const line of lines.length ? lines : [text]) {
    const times = parseTimes(line);
    if (times.length === 0) continue;

    const [head] = line.split(':');
    const weekdays = line.includes(':') ? parseWeekdays(head) : undefined;
    rules.push({ weekdays: weekdays?.length ? weekdays : undefined, times });
  }

  return rules;
}

function parseTimes(text: string): Clock[] {
  const seen = new Set<string>();
  const clocks: Clock[] = [];
  for (const match of text.matchAll(/(\d{1,2})[.:](\d{2})\s*Uhr/g)) {
    const clock = { hour: Number(match[1]), minute: Number(match[2]) };
    const key = `${clock.hour}:${clock.minute}`;
    if (clock.hour > 23 || clock.minute > 59 || seen.has(key)) continue;
    seen.add(key);
    clocks.push(clock);
  }
  return clocks;
}

function parseWeekdays(text: string): number[] {
  const lower = text.toLocaleLowerCase('de-DE');
  const ranges = [...lower.matchAll(/(\p{L}+)\s*[-–]\s*(\p{L}+)/gu)];
  const days = new Set<number>();

  for (const [, from, to] of ranges) {
    const start = WEEKDAYS[shortDay(from)];
    const end = WEEKDAYS[shortDay(to)];
    if (!start || !end) continue;
    for (let day = start; ; day = day === 7 ? 1 : day + 1) {
      days.add(day);
      if (day === end) break;
    }
  }

  for (const match of lower.matchAll(/\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/gu)) {
    const day = WEEKDAYS[shortDay(match[1])];
    if (day) days.add(day);
  }

  return [...days].sort((a, b) => a - b);
}

const WEEKDAYS: Record<string, number> = {
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  sonntag: 7,
};

function shortDay(value: string): string {
  return Object.keys(WEEKDAYS).find((day) => day.startsWith(value.slice(0, 2))) ?? value;
}

function expandOccurrences(range: DateRange, rules: TimeRule[]): { date: string; time?: Clock }[] {
  const dates = datesInRange(range);
  if (rules.length === 0) {
    return range.from === range.to ? [{ date: range.from }] : [{ date: range.from }];
  }

  const occurrences: { date: string; time?: Clock }[] = [];
  for (const date of dates) {
    const weekday = weekdayNumber(date);
    const times = rules.flatMap((rule) => (!rule.weekdays || rule.weekdays.includes(weekday) ? rule.times : []));
    for (const time of times) occurrences.push({ date, time });
  }

  return occurrences.length ? occurrences : [{ date: range.from }];
}

function datesInRange(range: DateRange): string[] {
  const result: string[] = [];
  const current = new Date(`${range.from}T12:00:00Z`);
  const end = new Date(`${range.to}T12:00:00Z`);
  while (current <= end && result.length < 370) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

function weekdayNumber(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function readAvailability({
  imageSignal,
  ticketUrl,
  price,
}: {
  imageSignal: string;
  ticketUrl?: string;
  price?: string;
}): { availability: Availability; label?: string } {
  const lower = `${imageSignal} ${price ?? ''}`.toLocaleLowerCase('de-DE');
  if (lower.includes('ausverkauft')) return { availability: 'soldout', label: 'Ausverkauft' };
  // Abgesagt kennt das Datenmodell nicht; über die Quelle ist nichts mehr zu
  // kaufen, die Originalformulierung bleibt als Beschriftung stehen.
  if (/abgesagt|entf\u00e4llt/.test(lower)) return { availability: 'not_on_sale', label: 'Abgesagt' };
  if (/letzte[\s_-]*tickets?|letzte[\s_-]*karten|wenige/.test(lower)) {
    return { availability: 'limited', label: 'Letzte Tickets' };
  }
  if (ticketUrl) return { availability: 'available', label: price || 'Tickets' };
  if (price && /kostenlos|eintritt frei/.test(price.toLocaleLowerCase('de-DE'))) {
    return { availability: 'not_on_sale', label: price };
  }
  return { availability: 'unknown', label: price };
}

function priceFromInfo(info: string[]): string | undefined {
  const price = info.find((item) => /\d|kostenlos/i.test(item) && !/theatersaal|silbersaal|ballsaal/i.test(item));
  return price || undefined;
}

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).at(-1) ?? 'termin';
  } catch {
    return url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'termin';
  }
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('de-DE') + part.slice(1))
    .join(' ');
}

function cutBeforeDetails(html: string): string {
  const markers = ['<div id="cast"', '<div id="trailer"', '<div id="pressestimmen"', '<div class="dt-fakten"'];
  const end = markers
    .map((marker) => html.indexOf(marker))
    .filter((index) => index > -1)
    .sort((a, b) => a - b)[0];
  return end ? html.slice(0, end) : html;
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('de-DE') + text.slice(1);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export const deutschesTheaterBaseUrl = BASE;
