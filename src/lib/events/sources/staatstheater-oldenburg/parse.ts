import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Kalender des Oldenburgischen Staatstheaters,
 * `https://staatstheater.de/kalender?monat=MMYYYY`.
 *
 * Die Seite rendert jeden Tag zweimal: einmal als Spalten je Haus (ohne
 * Namen des Hauses, nur `spalte-0`, `spalte-1` …) und einmal für schmale
 * Bildschirme, in der jede Vorstellung ihren Spielort selbst nennt
 * (`.auffuehrungen > .spielort`). Gelesen wird nur diese zweite Fassung – sie
 * trägt alles, was die Spalten tragen, plus den Ort.
 *
 * Ein Monat ohne Vorstellung (Theaterferien, Vergangenheit) kommt mit der
 * Monatsleiste, aber ohne einen einzigen Tag zurück; die Monatsleiste ist
 * zugleich das Zeichen, dass die Seite erkannt ist.
 */

const SOURCE_ID = 'staatstheater-oldenburg';
const BASE = 'https://staatstheater.de';

/**
 * Die Sparte steht nur im Pfad der Produktionsseite (`/programm/<sparte>/…`).
 * Die Namen dazu sind die des Genre-Filters auf derselben Seite – der Filter
 * selbst führt keine Pfade, deshalb diese Zuordnung. Unbekannte Pfade bleiben
 * ohne Gattung und fallen auf die Definition zurück.
 */
const GENRES: Record<string, string> = {
  ballett: 'Ballett',
  gastspiele: 'Gastspiel',
  just: 'Junges Staatstheater',
  konzert: 'Konzert',
  musiktheater: 'Musiktheater',
  niederdeutsch: 'Niederdeutsches Schauspiel',
  schauspiel: 'Schauspiel',
  'sparte-7': 'Sparte 7',
  theatervermittlung: 'Theatervermittlung',
};

/** Nicht öffentlich – im Kalender eines Publikums hat so ein Termin nichts zu suchen. */
const CLOSED = /geschlossene veranstaltung/i;

export interface ParseResult extends PageResult {
  /** Termine, die als geschlossene Veranstaltung ausgewiesen sind. */
  excluded: number;
}

export function parseCalendarPage(html: string): ParseResult {
  const $ = cheerio.load(html);
  const recognised = $('.filter-monate').length > 0;

  /**
   * Nach Tag, Uhrzeit, Ort und Titel. Die Seite führt manche Vorstellung
   * zweimal im selben Slot – etwa „Nur noch Stehplätze“ mit Ticketlink neben
   * „Derzeit ausverkauft“ für die Sitzplätze. Für den Kalender ist das eine
   * Vorstellung; es zählt der Eintrag, über den man noch Karten bekommt.
   */
  const bySlot = new Map<string, CalendarEvent>();
  let skipped = 0;
  let excluded = 0;

  $('div.tag').each((_, element) => {
    const day = $(element);
    const blocks = day.find('.auffuehrungen');
    if (blocks.length === 0) return; // die Spaltenfassung desselben Tages

    const date = readDate(day.find('a.date-dmY').first().attr('data-date'));
    if (!date) {
      skipped += blocks.length;
      return;
    }

    blocks.each((_, block) => {
      const item = $(block) as unknown as Item;
      const statuses = item
        .find('.status')
        .map((_, status) => clean($(status).text()))
        .get()
        .filter(Boolean);
      if (statuses.some((status) => CLOSED.test(status))) {
        excluded++;
        return;
      }

      const heading = item.find('h2').first();
      const title = clean(heading.text());
      const time = readTime(clean(item.find('.uhrzeit').first().text()));
      if (!title || !time) {
        skipped++;
        return;
      }

      const link = heading.find('a[href]').first().attr('href');
      const url = absolute(link);
      const ticket = readTicket(item);
      const start = berlinIso(date, time.start.hour, time.start.minute);
      const end = time.end
        ? berlinIso(
            // Endet der Abend vor seinem Beginn, liegt das Ende nach Mitternacht.
            time.end.hour * 60 + time.end.minute < time.start.hour * 60 + time.start.minute
              ? nextDay(date)
              : date,
            time.end.hour,
            time.end.minute,
          )
        : undefined;

      // Die Eventim-Nummer bezeichnet die Vorstellung; ohne Verkauf bleibt
      // nur der Slug aus Tag, Uhrzeit und Titel.
      const key =
        ticket.url?.match(/[?&]event=(\d+)/)?.[1] ??
        `${date}-${pad(time.start.hour)}${pad(time.start.minute)}-${slug(title)}`;

      const venue = clean(item.find('.spielort').first().text()) || 'Oldenburgisches Staatstheater';
      const slot = `${start}|${venue}|${title.toLowerCase()}`;
      const known = bySlot.get(slot);
      if (known?.ticketUrl && !ticket.url) return;

      bySlot.set(slot, {
        id: `${SOURCE_ID}:${key}`,
        sourceId: SOURCE_ID,
        title: softenShouted(title),
        subtitle: clean(item.find('.subtitle').first().text()) || undefined,
        description: readDescription($, item),
        category: readGenre(link),
        start,
        end,
        allDay: false,
        // Keine feste Stadt: das Haus spielt auch ausserhalb (Stadtteiltreffs,
        // Kirchen, Konferenzen).
        venue: { name: venue },
        availability: ticket.availability,
        availabilityLabel: ticket.label,
        ticketUrl: ticket.availability === 'soldout' ? undefined : ticket.url,
        url: url ?? `${BASE}/kalender`,
        notes: statuses.length > 0 ? statuses : undefined,
      });
    });
  });

  const events = [...bySlot.values()];
  return {
    events,
    skipped,
    excluded,
    empty: recognised && events.length === 0 && skipped === 0,
  };
}

/**
 * Die Monate (`YYYY-MM`), die die Monatsleiste verlinkt. Nur die gibt es:
 * ausserhalb davon antwortet die Seite mit einem Serverfehler. Die Monate der
 * nächsten Spielzeit stehen schon in der Leiste, aber unverlinkt
 * (`span.keineTermine`, „wird Anfang Juli freigeschaltet“).
 */
export function parseCalendarMonths(html: string): string[] {
  const $ = cheerio.load(html);
  const months = new Set<string>();

  // Die Leiste steht je Breakpoint mehrfach auf der Seite.
  $('.filter-monate a[href*="monat="]').each((_, element) => {
    const match = $(element).attr('href')?.match(/monat=(\d{2})(\d{4})/);
    if (match) months.add(`${match[2]}-${match[1]}`);
  });

  return [...months].sort();
}

/** Programmtext der Produktionsseite, ohne Pressestimmen und Besetzung. */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  const paragraphs = $('.beschreibung p')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  const text = paragraphs.join('\n\n');
  // Ein Satzfetzen ist kein Programmtext.
  return text.length >= 80 ? text : undefined;
}

/* ------------------------------------------------------------------ */

type Item = cheerio.Cheerio<never>;

interface Clock {
  hour: number;
  minute: number;
}

function readDate(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** `19:30 - 21:40 Uhr (inkl. Pause)` oder `18:00 Uhr`. */
function readTime(label: string): { start: Clock; end?: Clock } | undefined {
  const match = label.match(/^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?\s*Uhr/);
  if (!match) return undefined;
  const start = clock(match[1], match[2]);
  if (!start) return undefined;
  const end = match[3] ? clock(match[3], match[4]) : undefined;
  return { start, end };
}

function clock(hour: string, minute: string): Clock | undefined {
  const value = { hour: Number(hour), minute: Number(minute) };
  return value.hour <= 23 && value.minute <= 59 ? value : undefined;
}

/**
 * Ticketlage aus zwei Signalen: der Klasse am Knopf und seinem Text.
 *
 * - `a.link-ticket` „Karten“ → verfügbar
 * - `a.restkarten` „Restkarten“ / „Nur noch Stehplätze“ → knapp
 * - `span.ausverkauft` „Derzeit ausverkauft“ → ausverkauft
 * - nichts davon (Anmeldung per Mail, freier Eintritt) → unbekannt
 */
function readTicket(item: Item): { availability: Availability; label?: string; url?: string } {
  const soldout = item.find('.ausverkauft').first();
  if (soldout.length > 0 || /ausverkauft/i.test(item.find('.tickets').text())) {
    return { availability: 'soldout', label: clean(soldout.text()) || 'Ausverkauft' };
  }

  const link = item.find('.tickets a[href]').first();
  if (link.length === 0) return { availability: 'unknown' };

  const url = link.attr('href')?.trim() || undefined;
  const label = clean(link.text()) || undefined;
  if (link.hasClass('restkarten') || /restkarten|stehpl/i.test(label ?? '')) {
    return { availability: 'limited', label, url };
  }
  return { availability: 'available', label, url };
}

/** Freie Absätze zwischen Uhrzeit und Knöpfen – Autor, Gattung, Hinweise. */
function readDescription($: cheerio.CheerioAPI, item: Item): string | undefined {
  const lines = item
    .children('p')
    .not('.uhrzeit')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function readGenre(href: string | undefined): string | undefined {
  const segment = href?.match(/^\/programm\/([^/]+)\//)?.[1];
  return segment ? GENRES[segment] : undefined;
}

function absolute(href: string | undefined): string | undefined {
  if (!href || href.startsWith('mailto:')) return undefined;
  try {
    return new URL(href, BASE).toString();
  } catch {
    return undefined;
  }
}

function nextDay(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
