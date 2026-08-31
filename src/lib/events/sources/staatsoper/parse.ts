import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für das HTML-Fragment von
 * `https://www.staatsoper.de/spielplan/{YYYY-MM}/calendar.ajax`.
 *
 * Bewusst tolerant: fehlt ein Feld, wird das Event trotzdem übernommen
 * (mit `unknown`/Fallback), statt den ganzen Monat scheitern zu lassen.
 * Nur ohne Datum oder Titel wird eine Zeile verworfen.
 */

const SOURCE_ID = 'staatsoper';
const BASE = 'https://www.staatsoper.de';

/** JSON in `data-schedule-filter`. */
interface ScheduleFilter {
  date?: string;
  filter?: Record<string, { name: string }[] | undefined>;
}

type Row = cheerio.Cheerio<never>;

export interface ParseResult {
  events: CalendarEvent[];
  /** Zeilen, die nicht verwertbar waren – für Monitoring/Logs. */
  skipped: number;
  /**
   * Die Seite meldet ausdrücklich „In diesem Zeitraum gibt es keine
   * Vorstellungen". Das unterscheidet einen leeren Monat (Sommerpause,
   * Vergangenheit) von einem geänderten Layout.
   */
  empty: boolean;
}

export function parseCalendarFragment(html: string): ParseResult {
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];
  let skipped = 0;
  const empty = $('.activity-list__col--empty').length > 0;

  $('.activity-list__row').each((_, el) => {
    const row = $(el) as unknown as Row;

    const date = row.attr('data-date')?.trim() || row.find('time[datetime]').attr('datetime')?.trim();
    const link = row.find('a.activity-list__content').attr('href')?.trim();
    const title = clean(row.find('.activity-list__text .h3').first().text());

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) {
      // Die Leermeldung ist selbst eine Zeile – die zählt nicht als Ausfall.
      if (row.find('.activity-list__col--empty').length === 0) skipped++;
      return;
    }

    // "16.00 Uhr | Nationaltheater | PREMIERE" – nur der erste Teil ist sicher.
    // Alles ab dem dritten Abschnitt sind Hinweise, keine Spielstätte.
    const meta = clean(row.find('.activity-list__text > span').first().text());
    const segments = meta.split('|').map(clean);
    const { hour, minute, hasTime } = parseTime(segments[0] ?? '');
    const venueName = segments[1] ?? '';
    const metaNotes = segments.slice(2).filter(Boolean).map(softenShouted);

    const filter = readScheduleFilter(row.attr('data-schedule-filter'));
    const ticket = readTicket($, row);

    const detailUrl = link ? absolute(link) : `${BASE}/spielplan`;
    const notes = [...metaNotes, ...collectNotes($, row)];
    const subtitle = clean(row.find('.activity-list--toggle__content p').first().text());

    events.push({
      id: `${SOURCE_ID}:${eventKey(link, date, hour, minute, title)}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      subtitle: subtitle || undefined,
      category:
        first(filter.filter?.type) ?? (clean(row.find('.activity-list__col--genre').text()) || undefined),
      start: berlinIso(date, hour, minute),
      allDay: !hasTime,
      // Keine feste Stadt: die Staatsoper führt auch Gastspiele ausserhalb
      // Münchens im selben Spielplan (etwa Baden-Baden).
      venue: { name: venueName || 'Bayerische Staatsoper' },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      url: detailUrl,
      icsUrl: link ? absolute(`${link.replace(/\/$/, '')}/calendar.ics`) : undefined,
      notes: notes.length ? notes : undefined,
    });
  });

  return { events, skipped, empty };
}

/* ------------------------------------------------------------------ */

function readScheduleFilter(raw: string | undefined): ScheduleFilter {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ScheduleFilter;
  } catch {
    return {};
  }
}

function first(list: { name: string }[] | undefined): string | undefined {
  return list?.[0]?.name?.trim() || undefined;
}

/**
 * Ticketlage aus zwei unabhängigen Signalen: dem Button-Label und der
 * CSS-Klasse. Fällt eines weg, trägt das andere noch.
 */
function readTicket($: cheerio.CheerioAPI, row: Row) {
  // Verfügbar/Restkarten sind ein <a>, ausverkauft ein <span> ohne Link.
  const button = row.find('.activity-list__col--tickets .button--ticket').first();
  if (!button.length) {
    return { availability: 'not_on_sale' as Availability, label: undefined, url: undefined };
  }

  const label = clean(button.text());
  const classes = button.attr('class') ?? '';
  const url = button.attr('href')?.trim();
  const lower = label.toLowerCase();

  let availability: Availability = 'unknown';
  if (classes.includes('button--ticket-soldout') || lower.includes('ausverkauft')) {
    availability = 'soldout';
  } else if (lower.includes('letzte') || lower.includes('restkarten')) {
    availability = 'limited';
  } else if (lower.includes('ticket') || lower.includes('karten')) {
    availability = 'available';
  }

  return { availability, label: label || undefined, url: url || undefined };
}

function collectNotes($: cheerio.CheerioAPI, row: Row): string[] {
  const notes: string[] = [];

  row.find('.activity-list--toggle__content p').each((i, element) => {
    if (i === 0) return; // erste Zeile ist der Untertitel

    const paragraph = $(element);
    if (paragraph.hasClass('activity-list-price-info')) {
      // Preise stehen im <span>, Schlagworte (Festival, Kategorie) daneben.
      const priceSpan = paragraph.find('span').first();
      const price = formatPrices(clean(priceSpan.text()));
      if (price) notes.push(price);

      const tags = clean(paragraph.clone().children('span').remove().end().text());
      if (tags) notes.push(tags);
      return;
    }

    const text = clean(paragraph.text());
    if (text) notes.push(text);
  });

  return notes;
}

/**
 * "Preise M , € 193 /168 /- /- /- /- /- /14" -> "Preise M: 193 / 168 / 14 €".
 * Die Quelle füllt nicht belegte Kategorien mit "-"; die fallen weg.
 */
function formatPrices(raw: string): string | undefined {
  if (!raw) return undefined;
  const [head, amounts] = raw.split('€');
  if (amounts === undefined) return raw;

  const values = amounts
    .split('/')
    .map((value) => value.trim())
    .filter((value) => value && value !== '-');
  if (values.length === 0) return undefined;

  const label = clean(head.replace(/,\s*$/, ''));
  return `${label ? `${label}: ` : ''}${values.join(' / ')} €`;
}

function parseTime(meta: string) {
  // "19.00 Uhr", "19:00 Uhr", "9.30 Uhr"
  const match = meta.match(/(\d{1,2})[.:](\d{2})\s*Uhr/);
  if (!match) return { hour: 0, minute: 0, hasTime: false };
  return { hour: Number(match[1]), minute: Number(match[2]), hasTime: true };
}

/**
 * Stabile ID: bevorzugt die numerische Termin-ID aus dem Detail-Link
 * (`/stuecke/macbeth/2026-07-02-1900-15674`), sonst ein Fallback aus
 * Datum, Zeit und Titel.
 */
function eventKey(link: string | undefined, date: string, hour: number, minute: number, title: string) {
  const id = link?.match(/-(\d{3,})\/?$/)?.[1];
  if (id) return id;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${date}-${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}-${slug}`;
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}
