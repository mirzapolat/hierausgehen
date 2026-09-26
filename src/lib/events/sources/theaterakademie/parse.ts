import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Spielplan der Bayerischen Theaterakademie August Everding.
 *
 * Die Seite rendert den kompletten Spielplan der Spielzeit serverseitig in
 * `<ul id="calendar">`. Gefiltert wird im Browser über eine eingebettete Kopie
 * derselben Liste – es gibt weder Monats-URL noch JSON-Endpunkt.
 *
 * Jeder Termin steht dreimal im Markup, einmal je Breakpoint
 * (`datarecord--small|middle|large`) mit identischen Angaben. Gelesen wird die
 * grosse Variante, deren Spalten eindeutig sind; die IDs entdoppeln den Rest.
 */

const SOURCE_ID = 'theaterakademie';
export const theaterakademieBaseUrl = 'https://theaterakademie.de';
export const theaterakademieProgrammeUrl = `${theaterakademieBaseUrl}/de/theater/programm`;

/**
 * `<br>` wird vor dem Parsen zu einem Zeilenumbruch: sonst klebt der Text
 * beider Zeilen zusammen ("PrinzregententheaterGrosses Haus"). Ein Steuerzeichen
 * als Platzhalter ginge nicht – der HTML-Parser wirft es weg.
 */
const BR = '\n';
const BR_TAG = /<\s*\/?\s*br\s*\/?\s*>/gi;

export interface ParseResult extends PageResult {
  /** Die Liste wurde gerendert, enthält aber keinen Termin. */
  empty: boolean;
  /**
   * Produktionsseiten mit eigenem Programmtext. Die Liste verlinkt nur die
   * Produktionen des Hauses; die Seiten der Gastspiele tragen ausser Titel und
   * Terminen nichts, sie brauchen also gar nicht erst geholt zu werden.
   */
  described: string[];
}

export function parseProgrammePage(html: string): ParseResult {
  const $ = cheerio.load(html.replace(BR_TAG, BR));

  const calendar = $('ul#calendar').first();
  if (calendar.length === 0) return { events: [], skipped: 0, empty: false, described: [] };

  const rows = pickVariant(calendar);
  if (rows.length === 0) return { events: [], skipped: 0, empty: true, described: [] };

  const byId = new Map<string, CalendarEvent>();
  const described = new Set<string>();
  let skipped = 0;

  rows.each((_, node) => {
    const row = parseRow($, $(node));
    if (!row) {
      skipped++;
      return;
    }
    if (row.described) described.add(row.event.url);
    if (!byId.has(row.event.id)) byId.set(row.event.id, row.event);
  });

  const events = [...byId.values()];
  return { events, skipped, empty: events.length === 0, described: [...described] };
}

/**
 * Programmtext der Produktionsseite. Der erste Textblock ist die
 * Inhaltsangabe; danach folgen Besetzungslisten und Ticket-Hinweise, die nicht
 * in die Beschreibung gehören.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html.replace(BR_TAG, BR));
  $('script, style, noscript, header, nav, footer, #calendar').remove();

  for (const node of $('section.textContent').toArray()) {
    const paragraphs = $(node)
      .find('p')
      .toArray()
      .map((paragraph) => lines($(paragraph)).join(' '))
      .filter((text) => text.length > 0 && !/^Tickets\b/.test(text));

    const text = paragraphs.join('\n\n');
    if (text.length >= 80) return text;
  }

  return undefined;
}

/* ------------------------------------------------------------------ */

/** Ein Ausschnitt des geladenen Dokuments – so, wie `$()` ihn liefert. */
type El = ReturnType<cheerio.CheerioAPI>;

interface ParsedRow {
  event: CalendarEvent;
  /** Die Liste verlinkt die Produktionsseite – dann steht dort auch Text. */
  described: boolean;
}

interface Clock {
  hour: number;
  minute: number;
}

function pickVariant(calendar: El): El {
  for (const selector of ['li.datarecord--large', 'li.datarecord--small', 'li.datarecord']) {
    const rows = calendar.find(selector);
    if (rows.length > 0) return rows;
  }
  return calendar.find('li.datarecord');
}

/**
 * Nur Blöcke mit Termin-ID zählen. Sie steht im `id`-Attribut als Pfad
 * `theater/programm/<produktion>/<produktions-id>-<termin-id>`; daraus kommen
 * die stabile ID und der Link auf die Produktionsseite.
 */
function parseRow($: cheerio.CheerioAPI, row: El): ParsedRow | undefined {
  const path = clean(row.attr('id') ?? '');
  const match = path.match(/^(.*)\/([^/]+)$/);
  if (!match) return undefined;

  const date = row.find('time[datetime]').first().attr('datetime');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  const dateColumn = row.find('.flex-2').first();
  const venueColumn = row.find('.flex-3').first();
  const titleColumn = row.find('.flex-4').first();

  const title = clean(titleColumn.find('a, span').first().text());
  if (!title) return undefined;

  const time = parseTime([venueColumn, dateColumn, row].map((scope) => clockText($, scope)));
  const venue = lines(venueColumn.children('span').first()).join(' – ');
  const notes = [...venueNotes($, venueColumn), ...titleNotes(titleColumn)];
  const ticket = readTicket(row, notes);
  const subtitle = lines(titleColumn.find('span.eventSubtitle').first()).join(' · ');

  const event: CalendarEvent = {
    id: `${SOURCE_ID}:${match[2]}`,
    sourceId: SOURCE_ID,
    title: softenShouted(title),
    subtitle: subtitle || undefined,
    start: berlinIso(date, time?.hour ?? 0, time?.minute ?? 0),
    allDay: !time,
    venue: { name: venue || 'Bayerische Theaterakademie' },
    availability: ticket.availability,
    availabilityLabel: ticket.label,
    ticketUrl: ticket.url,
    url: `${theaterakademieBaseUrl}/de/${match[1]}`,
    notes: notes.length ? notes : undefined,
  };

  return { event, described: titleColumn.find(`a[href^="${theaterakademieBaseUrl}"]`).length > 0 };
}

/** Die Uhrzeit steht in `<time>` ohne `datetime` – das trägt nur der Tag. */
function clockText($: cheerio.CheerioAPI, scope: El): string {
  const node = scope
    .find('time')
    .toArray()
    .map((item) => $(item))
    .find((item) => !item.attr('datetime'));
  return node ? clean(node.text()) : '';
}

function parseTime(candidates: string[]): Clock | undefined {
  for (const candidate of candidates) {
    const match = candidate.match(/(\d{1,2})[.:](\d{2})/);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }
  return undefined;
}

/**
 * In der Ortsspalte stehen nach der Spielstätte Hinweise: das Merkmal
 * ("Premiere") und Vorprogramme ("19:00 Uhr Werkeinführung").
 */
function venueNotes($: cheerio.CheerioAPI, column: El): string[] {
  return column
    .children('span')
    .slice(1)
    .toArray()
    .map((node) => lines($(node)).join(' '))
    .filter(Boolean);
}

/**
 * In der Produktionsspalte stehen nach Titel und Untertitel freie Zeilen –
 * Vorverkaufsstart, Programmhinweise, Zusatzangaben.
 */
function titleNotes(column: El): string[] {
  const rest = column.clone();
  rest.find('a, span').remove();
  return lines(rest);
}

interface Ticket {
  availability: Availability;
  label?: string;
  url?: string;
}

/**
 * Zwei Signale: der Ticketknopf (ein Link mit Ticket-Icon, meist in den Shop
 * des Veranstalters) und die Hinweiszeilen der Produktionsspalte. Ohne Knopf
 * und ohne Hinweis macht die Quelle keine Angabe.
 */
function readTicket(row: El, notes: string[]): Ticket {
  const link = row.find('svg.ticketlink').first().closest('a');
  const href = link.attr('href');
  const url = href?.startsWith('http') ? href : undefined;
  const hint = notes.find((note) => /ausverkauft|restkarten|letzte karten|vorverkauf/i.test(note));

  if (hint && /ausverkauft/i.test(hint)) return { availability: 'soldout', label: hint };
  if (hint && /restkarten|letzte karten/i.test(hint)) {
    return { availability: 'limited', label: hint, url };
  }
  if (url) return { availability: 'available', url };
  if (hint) return { availability: 'not_on_sale', label: hint };
  return { availability: 'unknown' };
}

/** Text eines Elements, an `<br>` in Zeilen zerlegt. */
function lines(node: El): string[] {
  if (node.length === 0) return [];
  return node.text().split(BR).map(clean).filter(Boolean);
}
