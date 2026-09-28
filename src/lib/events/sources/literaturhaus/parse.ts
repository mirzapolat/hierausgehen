import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';
import type { EventDetail } from '../detail.ts';

/**
 * Parser für das Programm des Literaturhauses München (`/programm/`).
 *
 * Die Seite bringt das ganze veröffentlichte Programm auf einmal mit – vom
 * nächsten Termin bis ans Ende der Saison, ohne Blättern und ohne Parameter
 * für den Zeitraum. `div.termine-container` umschliesst die Liste und ist
 * zugleich das Signal, dass sie überhaupt gerendert wurde; darin ist jeder
 * Termin ein `div.termin-container`.
 *
 * Vergangenes führt die Seite nicht. Der Kalender der Quelle
 * (`POST /loadmonth`) kennt es zwar, gibt aber nur Tage mit Terminen zurück –
 * die Termine selbst müsste man Tag für Tag über `POST /get-event` nachladen.
 * Das wären rund zwanzig Abrufe je Monat für Daten, die der Kalender ohnehin
 * nicht zeigt.
 */

const SOURCE_ID = 'literaturhaus';
const BASE = 'https://www.literaturhaus-muenchen.de';

export interface ParseResult extends PageResult {
  /** Die Liste wurde gerendert, enthält aber keinen Termin. */
  empty: boolean;
}

export function parseProgramme(html: string): ParseResult {
  const $ = cheerio.load(withLineBreaks(html));

  const container = $('.termine-container');
  if (container.length === 0) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('.termin-container').each((_, element) => {
    const item = $(element) as unknown as Item;

    const link = item.find('.item-title-container a').first();
    const title = clean(link.find('.item-title').first().text());
    const href = link.attr('href');
    const date = parseDate(clean(item.find('.event-datum .tag').first().text()));

    if (!title || !href || !date) {
      skipped++;
      return;
    }

    const url = absolute(href);
    const time = parseTime(item);
    const place = splitLines(item.find('.event-datum .zeitraum').first().text());
    const ticket = readTicket(item);

    events.push({
      // Der Slug steht für die Veranstaltung, nicht für den Abend. Solange die
      // Quelle jeden Termin einzeln führt, ist er eindeutig – mit dem Datum
      // bleibt er es auch, wenn sie einmal zwei Abende zusammenlegt.
      id: `${SOURCE_ID}:${slug(url)}-${date}`,
      sourceId: SOURCE_ID,
      title,
      subtitle: clean(item.find('.item-subtitle').first().text()) || undefined,
      // Die Liste führt keinen Programmtext; der kommt von der Detailseite.
      start: berlinIso(date, time?.hour ?? 0, time?.minute ?? 0),
      allDay: !time,
      // Das Haus bespielt auch fremde Bühnen (Münchner Kammerspiele) –
      // deshalb keine feste Stadt.
      venue: { name: place[0] || 'Literaturhaus München' },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      url,
      notes: collectNotes(item, place.slice(1)),
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/**
 * Programmtext und Kartenlink der Veranstaltungsseite.
 *
 * Karten verkauft das Haus über Reservix. Die Übersicht dort
 * (`literaturhaus-muenchen.reservix.de/events`) sperrt Reservix in der
 * `robots.txt` – sie bleibt deshalb unberührt. Die Veranstaltungsseite hier
 * verlinkt aber je Termin direkt auf dessen Karten (`a.ticket-link`), und
 * die holt der Adapter ohnehin. Ein solcher Link ist der Kaufen-Knopf und
 * heisst `available`; das Ausverkauft-Zeichen der Liste geht vor, weil
 * `mergeDetail` die Ticketlage nur ergänzt, wo die Liste keine kannte.
 *
 * Freie Veranstaltungen (Musik im Café) haben keinen `a.ticket-link` – dann
 * bleibt es bei `unknown`. Der allgemeine Kartenknopf im Seitenkopf zeigt auf
 * die Reservix-Übersicht und zählt nicht.
 */
export function parseDetailPage(html: string): EventDetail | undefined {
  const description = parseDetailDescription(html);
  const ticketUrl = readTicketLink(html);
  if (!description && !ticketUrl) return undefined;

  return {
    description,
    ticketUrl,
    availability: ticketUrl ? 'available' : undefined,
  };
}

/** Programmtext der Veranstaltungsseite. */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(withLineBreaks(html));

  const paragraphs: string[] = [];
  const seen = new Set<string>();

  $('.entry-content p').each((_, element) => {
    const text = clean($(element).text());
    // Kurze Zeilen sind Bildunterschriften, Hinweise und Leerabsätze.
    if (text.length < 80 || seen.has(text)) return;
    seen.add(text);
    paragraphs.push(text);
  });

  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

/* ------------------------------------------------------------------ */

/** Nur Links, die auf einen bestimmten Termin im Kartenshop zeigen. */
function readTicketLink(html: string): string | undefined {
  const $ = cheerio.load(html);
  for (const element of $('a.ticket-link').toArray()) {
    const href = $(element).attr('href')?.trim();
    if (href && /^https:\/\/[^/]*reservix\.de\/.*\d/.test(href) && !/\/events\/?$/.test(href)) {
      return href;
    }
  }
  return undefined;
}

type Item = cheerio.Cheerio<never>;

/**
 * `<br>` trennt hier Inhalte, nicht nur Zeilen: in `.zeitraum` steht hinter dem
 * Umbruch ein Hinweis („Saal & Stream<br>Foyer-Bar ab 18 Uhr"). Ohne diesen
 * Schritt klebt er als „Saal & StreamFoyer-Bar ab 18 Uhr" an der Spielstätte.
 */
function withLineBreaks(html: string): string {
  return html.replace(/<\s*\/?\s*br\s*\/?\s*>/gi, '\n');
}

function splitLines(text: string): string[] {
  return text.split('\n').map(clean).filter(Boolean);
}

/** "Sa 12.9.26" – Tag, Monat und zweistelliges Jahr. */
function parseDate(label: string): string | undefined {
  const match = label.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;

  return `${2000 + Number(match[3])}-${pad(month)}-${pad(day)}`;
}

/**
 * Die Uhrzeit steht als blosser Text zwischen den Trennstrichen
 * („// 19 Uhr //"). Spielstätte und Datum müssen vorher raus: in der
 * Spielstätte steht oft eine zweite Uhrzeit („Foyer-Bar ab 18 Uhr").
 */
function parseTime(item: Item): { hour: number; minute: number } | undefined {
  const datum = item.find('.event-datum').first().clone();
  datum.find('.tag, .zeitraum, .sep').remove();

  const match = clean(datum.text()).match(/(\d{1,2})(?:[.:](\d{2}))?\s*Uhr/);
  if (!match) return undefined;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return undefined;

  return { hour, minute };
}

/**
 * Die Liste kennt nur ein Ticketsignal: das Ausverkauft-Zeichen. Einen
 * Kaufen-Knopf gibt es hier nicht, der Kartenlink steht erst auf der
 * Veranstaltungsseite – also bleibt alles Übrige `unknown`.
 */
function readTicket(item: Item): { availability: Availability; label?: string } {
  const soldout = item.find('.tickets-soldout-program').first();
  if (soldout.length === 0) return { availability: 'unknown' };

  return {
    availability: 'soldout',
    label: clean(soldout.find('img[alt]').first().attr('alt') ?? '') || undefined,
  };
}

/** Reihe, Ausstellung und der Hinweis hinter der Spielstätte. */
function collectNotes(item: Item, extraLines: string[]): string[] | undefined {
  const notes = [
    clean(item.find('.item-title-reihe').first().text()),
    clean(item.find('.item-title-ausstellung').first().text()),
    ...extraLines,
  ].filter(Boolean);

  return notes.length ? [...new Set(notes)] : undefined;
}

function slug(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() ?? url;
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
