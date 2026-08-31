import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für die Spielplanseite des Residenztheaters
 * (`/spielplan?month=YYYY-MM`).
 *
 * Aufbau: `div.schedule` enthält je Tag eine `section.schedule__day` und darin
 * je Termin ein `article.schedule-act`. Der Container ist zugleich das Signal,
 * dass die Liste überhaupt gerendert wurde – die Seite kennt keine eigene
 * Leermeldung, ein Monat ohne Vorstellungen ist schlicht leer.
 */

const SOURCE_ID = 'residenztheater';
const BASE = 'https://www.residenztheater.de';

export interface ParseResult {
  events: CalendarEvent[];
  /** Termine, die nicht verwertbar waren – für Monitoring/Logs. */
  skipped: number;
  /** Die Liste wurde gerendert, enthält aber keinen Termin. */
  empty: boolean;
}

/**
 * @param month Der angefragte Monat "YYYY-MM". Die Seite nennt bei jedem
 *              Termin nur Tag und Monatskürzel ("Do. 1 Okt"); das Jahr ergibt
 *              sich aus der Anfrage.
 */
export function parseSchedulePage(html: string, month: string): ParseResult {
  const $ = cheerio.load(html);

  const container = $('.schedule');
  if (container.length === 0) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('.schedule-act').each((_, element) => {
    const act = $(element) as unknown as Act;

    const title = clean(act.find('.schedule-act__title a').clone().find('.visuallyhidden').remove().end().text());
    const date = parseDate(clean(act.find('.schedule-act__date').first().text()), month);

    if (!title || !date) {
      skipped++;
      return;
    }

    // "Marstall, 19.00–20.45 Uhr | Publikumsgespräch im Anschluss"
    const segments = clean(act.find('.schedule-act__details').first().text()).split('|').map(clean);
    const { venue, start, end } = parseDetails(segments[0] ?? '');

    const ticket = readTicket(act);
    const link = act.find('.schedule-act__title a').attr('href');
    const icsHref = act.find('.schedule-act__date-links a[href*="calendarics"]').attr('href');

    events.push({
      id: `${SOURCE_ID}:${eventKey(act, icsHref, date, start, title)}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      subtitle: clean(act.find('.schedule-act__author').first().text()) || undefined,
      // Die Quelle führt keine Gattung – lieber nichts als eine erfundene.
      start: berlinIso(date, start?.hour ?? 0, start?.minute ?? 0),
      end: end ? berlinIso(date, end.hour, end.minute) : undefined,
      allDay: !start,
      // Keine feste Stadt: "Gastspiel" steht auch für Auftritte im Ausland.
      venue: { name: venue || 'Residenztheater' },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      url: link ? absolute(link) : `${BASE}/spielplan`,
      icsUrl: icsHref ? absolute(icsHref) : undefined,
      notes: collectNotes(act, segments.slice(1)),
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/* ------------------------------------------------------------------ */

type Act = cheerio.Cheerio<never>;

/** Deutsche Monatskürzel, wie die Seite sie schreibt. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mär: 3, maer: 3, mrz: 3, apr: 4, mai: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

/**
 * "Do. 1 Okt" plus den angefragten Monat zu einem ISO-Tag verbinden.
 *
 * Das Jahr steht nicht auf der Seite. Es wird so gewählt, dass der Termin dem
 * angefragten Monat am nächsten liegt – damit stimmt auch ein Januartermin,
 * der auf einer Dezemberseite auftaucht.
 */
function parseDate(label: string, month: string): string | undefined {
  const match = label.match(/(\d{1,2})\.?\s+(\p{L}+)/u);
  if (!match) return undefined;

  const day = Number(match[1]);
  const monthNumber = MONTHS[match[2].slice(0, 3).toLocaleLowerCase('de-DE')];
  if (!monthNumber || day < 1 || day > 31) return undefined;

  const [requestedYear, requestedMonth] = month.split('-').map(Number);
  const year = [requestedYear - 1, requestedYear, requestedYear + 1].reduce((best, candidate) => {
    const distance = Math.abs(candidate * 12 + monthNumber - (requestedYear * 12 + requestedMonth));
    const bestDistance = Math.abs(best * 12 + monthNumber - (requestedYear * 12 + requestedMonth));
    return distance < bestDistance ? candidate : best;
  }, requestedYear);

  return `${year}-${pad(monthNumber)}-${pad(day)}`;
}

interface Clock {
  hour: number;
  minute: number;
}

/** "Marstall, 19.00–20.45 Uhr" → Spielstätte, Beginn und optionales Ende. */
function parseDetails(head: string): { venue: string; start?: Clock; end?: Clock } {
  const time = head.match(/(\d{1,2})[.:](\d{2})(?:\s*[–—-]\s*(\d{1,2})[.:](\d{2}))?\s*Uhr\s*$/);
  if (!time) return { venue: clean(head.replace(/,\s*$/, '')) };

  return {
    venue: clean(head.slice(0, time.index).replace(/,\s*$/, '')),
    start: { hour: Number(time[1]), minute: Number(time[2]) },
    end: time[3] ? { hour: Number(time[3]), minute: Number(time[4]) } : undefined,
  };
}

/**
 * Ticketlage aus drei voneinander unabhängigen Signalen: der Klasse
 * `schedule-act--inactive`, dem `disabled`-Knopf und dem Text. Fällt eines
 * weg, tragen die anderen noch.
 */
function readTicket(act: Act): { availability: Availability; label?: string; url?: string } {
  const cta = act.find('.schedule-act__cta').first();
  const label = clean(cta.text());
  const lower = label.toLocaleLowerCase('de-DE');
  const href = cta.attr('href');
  const url = href?.startsWith('http') ? href : undefined;

  if (act.hasClass('schedule-act--inactive') || cta.is('[disabled]') || lower.includes('ausverkauft')) {
    return { availability: 'soldout', label: label || undefined };
  }

  if (cta.length === 0) {
    // Ohne Knopf steht hier manchmal noch ein Hinweis ("Karten ab 01.12.2026").
    const hint = clean(act.find('.schedule-act__cards-info-text').text());
    return hint
      ? { availability: 'not_on_sale', label: hint }
      : { availability: 'unknown', label: undefined };
  }

  if (/restkarten|letzte|wenige/.test(lower)) return { availability: 'limited', label, url };
  if (/^(karten|tickets)$/.test(lower)) return { availability: 'available', label, url };

  // "Zur Anmeldung", "Eintritt frei", "Buchung für Schulen": kein Kartenverkauf.
  return { availability: 'not_on_sale', label: label || undefined, url };
}

function collectNotes(act: Act, extraSegments: string[]): string[] | undefined {
  const notes: string[] = [];

  const label = clean(act.find('.schedule-act__label').first().text());
  if (label) notes.push(softenShouted(label));

  const short = clean(act.find('.schedule-act__short-description').first().text());
  if (short) notes.push(short);

  notes.push(...extraSegments.filter(Boolean));

  const abo = clean(act.find('.schedule-act__abo').first().text());
  if (abo) notes.push(abo);

  // "Preise V" steht im eigenen Element, der Betrag daneben im Elternknoten.
  const category = act.find('.schedule-act__category').first();
  if (category.length) {
    const priceLabel = clean(category.find('.schedule-act__price').first().text());
    const amount = clean(category.clone().children('.schedule-act__price').remove().end().text());
    const price = [priceLabel, amount].filter(Boolean).join(': ');
    if (price) notes.push(price);
  }

  return notes.length ? [...new Set(notes)] : undefined;
}

/**
 * Stabile ID: die Termin-Nummer aus dem ICS-Link
 * (`…[activity]=9117`). Ersatzweise die interne Termin-ID aus dem Kommentar,
 * zuletzt ein Schlüssel aus Datum, Zeit und Titel.
 */
function eventKey(act: Act, icsHref: string | undefined, date: string, start: Clock | undefined, title: string) {
  const fromIcs = icsHref?.match(/(?:%5Bactivity%5D|\[activity\])=(\d+)/)?.[1];
  if (fromIcs) return fromIcs;

  const fromComment = act.html()?.match(/datetimeToActivity:\s*(\d+)/)?.[1];
  if (fromComment) return `dt${fromComment}`;

  const slug = title.toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${date}-${pad(start?.hour ?? 0)}${pad(start?.minute ?? 0)}-${slug}`;
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
