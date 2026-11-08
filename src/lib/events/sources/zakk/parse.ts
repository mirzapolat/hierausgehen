import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Gesamtprogramm des zakk, `https://zakk.de/programm/alle`.
 *
 * Eine Seite mit allen kommenden Terminen, je Monat eine
 * `ul.ticket-list.programm`, je Termin ein `li.single-ticket`; Monatsüberschriften stehen als
 * `li.single-ticket.monthly-list` dazwischen und zählen nicht.
 *
 * Die Klassen am Termin sind Schlagworte der Filter: Genres („Kabarett",
 * „Poetry-Slam", „Lesung") und Zielgruppen („Selbermachen", „Eintritt-frei",
 * „Jugendliche--U20"). Die Zielgruppen stehen als Radioknöpfe auf derselben
 * Seite und werden von dort gelesen, statt sie hier aufzulisten.
 */

const SOURCE_ID = 'zakk';
const BASE = 'https://zakk.de';

type Node = cheerio.Cheerio<never>;

export function parseProgramme(html: string): PageResult {
  const $ = cheerio.load(html);
  // Eine Liste je Monat.
  const lists = $('ul.ticket-list.programm');
  const audiences = new Set(
    $('input[name="filters"]')
      .map((_, el) => ($(el).attr('value') ?? '').replace(/^\./, ''))
      .get()
      .filter(Boolean),
  );

  const events: CalendarEvent[] = [];
  let skipped = 0;
  lists.children('li.single-ticket').each((_, element) => {
    const item = $(element) as unknown as Node;
    if (item.hasClass('monthly-list')) return;
    const event = readItem($, item, audiences);
    if (event) events.push(event);
    else skipped++;
  });

  return { events, skipped, empty: lists.length > 0 && events.length === 0 && skipped === 0 };
}

function readItem($: cheerio.CheerioAPI, item: Node, audiences: Set<string>): CalendarEvent | undefined {
  const date = item.attr('data-value')?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const link = item.find('.ticket-info h2 a').first();
  const eventId = link.attr('href')?.match(/[?&]event=(\d+)/)?.[1];
  const title = clean(link.text());
  if (!date || !eventId || !title) return undefined;
  const day = `${date[3]}-${date[2]}-${date[1]}`;

  // „18.30 Uhr<br>Einlass 17.30 Uhr<br>Halle" – Beginn, Einlass, Raum.
  const lines = linesOf(item.find('.event-time').first());
  const begin = parseTime(lines[0] ?? '');
  const notes: string[] = [];
  let room: string | undefined;
  for (const text of lines.slice(begin ? 1 : 0)) {
    const doors = text.match(/^Einlass\s+(.+)$/i);
    if (doors) notes.push(`Einlass: ${formatTime(doors[1])}`);
    else room = text;
  }

  notes.push(...priceNotes(item.find('.event-price').first()));
  const ticket = readTicket(item);
  const url = `${BASE}/event-detail?event=${eventId}`;

  return {
    id: `${SOURCE_ID}:${eventId}`,
    sourceId: SOURCE_ID,
    title,
    subtitle: clean(item.find('.ticket-info h3').first().text()) || undefined,
    description: linesOf(item.find('.ticket-info > p').first()).join('\n') || undefined,
    category: category(item, audiences),
    start: berlinIso(day, begin?.hour ?? 0, begin?.minute ?? 0),
    allDay: !begin,
    // „nicht im zakk" ist kein Ort, sondern sagt, dass es woanders stattfindet.
    venue: { name: room ?? 'zakk' },
    availability: ticket.availability,
    availabilityLabel: ticket.label,
    ticketUrl: ticket.availability === 'available' ? url : undefined,
    url,
    icsUrl: `${url}&event-ics-cmd=1`,
    notes: notes.length ? notes : undefined,
  };
}

/**
 * Die Rubrik („Musik", „Wort & Bühne", „Politik & Gesellschaft") ist grob;
 * die Genre-Schlagworte am Termin sagen genauer, was es ist. Beide gehen im
 * Wortlaut weiter, die Genres zuerst – `categories.ts` nimmt das erste, das
 * es kennt. Schlagworte, die beim Erzeugen der Klasse Zeichen verloren haben
 * (`Fr--hst--ck`, `Indie-Rock---Pop`), bleiben weg: ihren Wortlaut kennt die
 * Seite hier nicht.
 */
function category(item: Node, audiences: Set<string>): string | undefined {
  const genres = (item.attr('class') ?? '')
    .split(/\s+/)
    .filter((token) => token && !['single-ticket', 'cf'].includes(token) && !audiences.has(token))
    .filter((token) => !token.includes('--') && /^[\p{L}-]+$/u.test(token))
    .map((token) => token.replace(/-/g, ' '));
  const section = clean(item.find('.event-categorie').first().text());
  const parts = [...new Set([...genres, section].filter(Boolean))];
  return parts.length ? parts.join(', ') : undefined;
}

/**
 * - Warenkorb-Knopf `button.tickets` – Karten im Shop der Seite
 * - `span.event-soldout` „ausverkauft"
 * - `span.event-soldout` „Zurzeit leider keine Tickets verfügbar", „abgesagt"
 *   – trägt dieselbe Klasse, ist aber kein Ausverkauf
 * - nichts: Abendkasse, Eintritt frei, Verkauf anderswo
 */
function readTicket(item: Node): { availability: Availability; label?: string } {
  const buy = item.find('.event-buy').first();
  const status = clean(buy.find('.event-soldout').first().text());
  if (status) {
    if (/ausverkauft/i.test(status)) return { availability: 'soldout', label: status };
    return { availability: 'not_on_sale', label: status };
  }
  if (buy.find('button.tickets').length) return { availability: 'available', label: 'Tickets' };
  return { availability: 'unknown' };
}

/**
 * „VVK € 22,00 / AK € 24,00", „AK € 10,00", „Eintritt frei", dazu Zeilen
 * wie „Anmeldung unter: reservierung.zakk.de". Der Link „zakk Ermäßigung"
 * steht bei jedem Vorverkauf und sagt nichts über den Termin.
 */
function priceNotes<T extends AnyNode>(node: cheerio.Cheerio<T>): string[] {
  const copy = node.clone();
  copy.find('a.small-link').remove();
  return linesOf(copy)
    .map((text) => text.replace(/€\s*(\d)/g, '€ $1'))
    .map((text) => (/€/.test(text) && !/^(?:preise?|tickets?)\b/i.test(text) ? `Preise: ${text}` : text));
}

/* ------------------------------------------------------------------ */
/* Detailseite                                                         */

/**
 * `https://zakk.de/event-detail?event={id}`: der volle Programmtext steht im
 * ersten Absatz von `.event-additional`, der Veranstalter in einem eigenen
 * Absatz („Veranstalter:innen > fiftyfifty & zakk").
 */
export function parseEventDetail(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);
  const paragraphs = $('.event-additional .box > p')
    .map((_, el) => linesOf($(el)).join('\n'))
    .get()
    .filter(Boolean);

  const notes: string[] = [];
  const text: string[] = [];
  for (const paragraph of paragraphs) {
    const organiser = paragraph.match(/^Veranstalter(?::innen)?\s*>\s*(.+)$/i);
    if (organiser) notes.push(`Veranstalter: ${organiser[1]}`);
    else text.push(paragraph);
  }

  const description = text.length ? text.join('\n\n') : undefined;
  if (!description && !notes.length) return undefined;
  return { description, notes: notes.length ? notes : undefined };
}

/* ------------------------------------------------------------------ */

/**
 * Zeilen eines Knotens: nur `<br>` trennt Inhalte. Umbrüche im Quelltext
 * sind Leerraum – „VVK €\n22,00" ist eine Zeile.
 */
function linesOf<T extends AnyNode>(node: cheerio.Cheerio<T>): string[] {
  if (!node.length) return [];
  const copy = node.clone();
  copy.find('br').replaceWith(BREAK);
  return copy
    .text()
    .split(BREAK)
    .map(clean)
    .filter(Boolean);
}

// Ein Zeichen, das in Spielplänen nicht vorkommt; NUL überlebt das
// HTML-Parsen von `replaceWith` nicht.
const BREAK = '\u241E';

/** „18.30 Uhr", „20 Uhr", „08.30 Uhr". */
function parseTime(text: string): { hour: number; minute: number } | undefined {
  const match = text.match(/^(\d{1,2})(?:[.:](\d{2}))?\s*Uhr$/i);
  if (!match) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2] ?? 0) };
}

/** „17.30 Uhr" → „17:30", „19 Uhr" → „19:00"; Unbekanntes bleibt stehen. */
function formatTime(text: string): string {
  const time = parseTime(text.trim());
  if (!time) return text.trim();
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}
