import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für die nachgeladenen Spielplan-Fragmente des Staatstheaters am
 * Gärtnerplatz.
 *
 * Ein Fragment enthält je Termin ein `div.vorstellung` mit sprechenden
 * Klassen: `vorstellung-<id>` (die Termin-ID), `date-DDMMYY`, `sparte-<id>`
 * (Gattung) und `ort-<id>` (Spielstätte). Ist der Spielplan zu Ende, antwortet
 * die Quelle mit „ende erreicht."; ein Monat ohne Termine liefert nichts.
 */

const SOURCE_ID = 'gaertnerplatz';
const BASE = 'https://www.gaertnerplatztheater.de';
/** Antwort, mit der die Quelle das Ende des Spielplans meldet. */
const END_MARKER = 'ende erreicht';

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke, die wie ein Termin aussahen, aber nicht verwertbar waren. */
  skipped: number;
  /** Die Quelle meldet: hinter diesem Monat kommt nichts mehr. */
  end: boolean;
  /** Leere Antwort – ein Monat ohne Vorstellungen (etwa Theaterferien). */
  empty: boolean;
  /** Gefundene Terminblöcke, unabhängig davon, ob sie verwertbar waren. */
  blocks: number;
}

/**
 * @param sparten Zuordnung `sparte-<id>` → Gattungsname, aus der Spielplanseite
 *                gelesen (siehe `parseSparten`). Fehlt ein Eintrag, bleibt die
 *                Gattung leer, statt geraten zu werden.
 */
export function parseScheduleFragment(
  html: string,
  sparten: Record<string, string> = {},
): ParseResult {
  const body = clean(html);
  if (body.toLowerCase().startsWith(END_MARKER)) {
    return { events: [], skipped: 0, end: true, empty: true, blocks: 0 };
  }
  if (body === '') return { events: [], skipped: 0, end: false, empty: true, blocks: 0 };

  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('.vorstellung').each((_, element) => {
    const block = $(element) as unknown as Block;
    const classes = (block.attr('class') ?? '').split(/\s+/);

    // Ohne `vorstellung-<id>` ist der Block kein Termin, sondern ein Hinweis
    // (etwa der Kasten „Theaterferien", der auf jeder Seite mitläuft).
    const id = classes.find((c) => /^vorstellung-\d+$/.test(c))?.slice('vorstellung-'.length);
    if (!id) return;

    const date = parseDate(block, classes);
    const title = clean(block.find('.fs-3 a').first().text());
    if (!date || !title) {
      skipped++;
      return;
    }

    const { start, end } = parseTime(clean(block.find('.fw-bold').first().text()));
    const ticket = readTicket(block);
    const link = block.find('.fs-3 a').first().attr('href');

    // Die Spielstätte steht nur, wenn es nicht die grosse Bühne ist – und mal
    // als Link auf den Saalplan ("Foyer"), mal als blosser Text bei Gastspielen
    // ("Kempten"). Beides steckt im selben Kasten, der nicht `.icons` ist.
    const venue = clean(block.find('.text-produktion-font-color').not('.icons').first().text());

    const category = sparten[classes.find((c) => /^sparte-(?!0$)\d+$/.test(c)) ?? ''];
    // Die Zeile unter dem Titel ist mal die Gattung, mal eine eigene Zeile.
    const tagline = clean(block.find('span.text-uppercase').first().text());

    events.push({
      id: `${SOURCE_ID}:${id}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      subtitle: tagline && tagline !== category ? softenShouted(tagline) : undefined,
      description: readDescription(block),
      category,
      start: berlinIso(date, start?.hour ?? 0, start?.minute ?? 0),
      end: end ? berlinIso(date, end.hour, end.minute) : undefined,
      allDay: !start,
      // Gastspiele stehen mit dem Ortsnamen ("Kempten") – keine Stadt erfinden.
      venue: { name: venue || 'Staatstheater am Gärtnerplatz' },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      url: link ? absolute(link) : `${BASE}/de/spielplan/index.html`,
      notes: collectNotes($, block),
    });
  });

  return { events, skipped, end: false, empty: false, blocks: $('.vorstellung').length };
}

/**
 * Gattungsnamen aus der Spielplanseite lesen: die Filterkästchen tragen die
 * `sparte`-IDs, die zugehörigen `<label>` den Namen. Damit muss keine Tabelle
 * im Code gepflegt werden, die bei einer neuen Gattung still veraltet.
 */
export function parseSparten(indexHtml: string): Record<string, string> {
  const $ = cheerio.load(indexHtml);
  const sparten: Record<string, string> = {};

  $('input[name="sparte[]"]').each((_, element) => {
    const input = $(element);
    const value = input.attr('value');
    const id = input.attr('id');
    if (!value || value === '0' || !id) return;

    const label = clean($(`label[for="${id}"]`).text());
    if (label) sparten[`sparte-${value}`] = label;
  });

  return sparten;
}

export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  $('script, style, noscript, header, nav, footer').remove();

  const paragraphs = uniqueParagraphs(
    $,
    [
      '.children-without-margin p',
      '.ce-bodytext p',
      '.text-content p',
      'main article p',
      'main .container p',
    ].join(', '),
  ).filter((text) => text.length > 80);

  if (paragraphs.length) return paragraphs.join('\n\n');

  const fallback = uniqueParagraphs($, '.children-without-margin, .ce-bodytext').filter(
    (text) => text.length > 80,
  );
  return fallback.length ? fallback.join('\n\n') : undefined;
}

/* ------------------------------------------------------------------ */

type Block = cheerio.Cheerio<never>;

/**
 * Datum aus der Klasse `date-DDMMYY`; die Textzeile („Fr, 02.10.26") dient
 * als Gegenprobe, falls die Klasse einmal fehlt.
 */
function parseDate(block: Block, classes: string[]): string | undefined {
  const fromClass = classes.find((c) => /^date-\d{6}$/.test(c))?.slice('date-'.length);
  if (fromClass) return isoFrom(fromClass.slice(0, 2), fromClass.slice(2, 4), fromClass.slice(4, 6));

  const fromText = clean(block.find('.fs-3').first().text()).match(/(\d{2})\.(\d{2})\.(\d{2})/);
  return fromText ? isoFrom(fromText[1], fromText[2], fromText[3]) : undefined;
}

function isoFrom(day: string, month: string, year: string): string | undefined {
  const d = Number(day);
  const m = Number(month);
  if (!d || !m || d > 31 || m > 12) return undefined;
  return `20${year}-${month}-${day}`;
}

interface Clock {
  hour: number;
  minute: number;
}

/** "19.30–22.00 Uhr" oder "19.00 Uhr". */
function parseTime(text: string): { start?: Clock; end?: Clock } {
  const match = text.match(/(\d{1,2})[.:](\d{2})(?:\s*[–—-]\s*(\d{1,2})[.:](\d{2}))?\s*Uhr/);
  if (!match) return {};
  return {
    start: { hour: Number(match[1]), minute: Number(match[2]) },
    end: match[3] ? { hour: Number(match[3]), minute: Number(match[4]) } : undefined,
  };
}

/**
 * Ticketlage aus zwei unabhängigen Signalen: der Art des Elements und seinem
 * Text. Buchbares ist ein `<a>` in den Webshop, alles andere ein `<span>`.
 */
function readTicket(block: Block): { availability: Availability; label?: string; url?: string } {
  const cta = block.find('.btn-produktion').first();
  if (cta.length === 0) return { availability: 'unknown' };

  const label = clean(cta.text());
  const lower = label.toLocaleLowerCase('de-DE');
  const href = cta.attr('href');
  const url = href?.startsWith('http') ? href : undefined;

  if (lower.includes('ausverkauft')) return { availability: 'soldout', label };
  if (!url) {
    // "ab 02.10." – Vorverkauf hat noch nicht begonnen.
    return { availability: 'not_on_sale', label: label || undefined };
  }
  if (/restkarten|letzte|wenige/.test(lower)) return { availability: 'limited', label, url };
  if (/^(tickets?|karten)$/.test(lower)) return { availability: 'available', label, url };

  // "Schulbestellung": buchbar, aber nicht für das allgemeine Publikum.
  return { availability: 'not_on_sale', label, url };
}

function collectNotes($: cheerio.CheerioAPI, block: Block): string[] | undefined {
  const notes: string[] = [];

  // Merkmale wie „U30" oder „Familienvorstellung" – mal als Text, mal als
  // Icon, dessen Beschriftung dann den Namen trägt.
  block.find('.icons a').each((_, element) => {
    const anchor = $(element);
    const name = clean(anchor.text()) || clean(anchor.attr('aria-label') ?? '');
    if (name) notes.push(name);
  });

  return notes.length ? [...new Set(notes)] : undefined;
}

function readDescription(block: Block): string | undefined {
  return clean(block.find('.children-without-margin').first().text()) || undefined;
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
  if (href.startsWith('http')) return href;
  // Die Fragmente verlinken relativ zum Spielplan ("./produktionen/…").
  return new URL(href.replace(/^\.\//, ''), `${BASE}/de/spielplan/`).toString();
}
