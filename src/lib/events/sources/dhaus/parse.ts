import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Spielplan des Düsseldorfer Schauspielhauses,
 * `https://www.dhaus.de/programm/spielplan/{YYYY-MM}/`.
 *
 * Dasselbe CMS wie die Deutsche Oper am Rhein, aber mit eigener Vorlage für
 * die Termine: `div.performance` mit der ID `{YYYY-MM-DD}-p{NNNN}`, darin
 * Bereiche (`performance__area--…`) für Datum, Ort, Info, Preise und Knopf.
 *
 * Auch hier klemmt die Seite den Monat auf ihr Ladefenster – und das beginnt
 * heute: ein vergangener Monat liefert den laufenden ab heute, ein Monat
 * hinter dem Vorverkauf die letzten angekündigten Tage. `window` sagt, was
 * tatsächlich kam.
 */

const SOURCE_ID = 'dhaus';
const BASE = 'https://www.dhaus.de';

type Node = cheerio.Cheerio<never>;

export interface ScheduleResult extends PageResult {
  window?: { from: string; to: string };
}

export function parseSchedule(html: string): ScheduleResult {
  const $ = cheerio.load(html);
  const container = $('.js-schedule-content').first();
  const events: CalendarEvent[] = [];
  let skipped = 0;

  container.find('div.performance[id]').each((_, element) => {
    const event = readPerformance($, $(element) as unknown as Node);
    if (event) events.push(event);
    else skipped++;
  });

  const from = container.attr('data-dates-from');
  const to = container.attr('data-dates-to');
  return {
    events,
    skipped,
    empty: container.length > 0 && events.length === 0 && skipped === 0,
    window: from && to ? { from, to } : undefined,
  };
}

function readPerformance($: cheerio.CheerioAPI, block: Node): CalendarEvent | undefined {
  const id = block.attr('id')?.match(/^(\d{4}-\d{2}-\d{2})-p(\d+)$/);
  const titleLink = block.find('.performance__title a').first();
  const title = line(block.find('.performance__title').first().text());
  if (!id || !title) return undefined;
  const [, date, performanceId] = id;

  const startAttr = block.find('.performance__time meta[itemprop="startDate"]').attr('content') ?? '';
  const time = startAttr.match(/T(\d{2}):(\d{2})/);

  // „von Ingmar Bergman", „Regie Thorleifur Örn Arnarsson", „Iranische
  // starke Stimmen" – die Regie ist eine Angabe für die Tabelle, der Rest
  // die zweite Zeile.
  const credits: string[] = [];
  const notes: string[] = [];
  block.find('.performance__infos .performance__text').each((_, el) => {
    const text = line($(el).text());
    if (!text) return;
    const director = text.match(/^Regie\s+(.+)$/);
    if (director) notes.push(`Regie: ${director[1]}`);
    else credits.push(text);
  });

  const ticket = readTicket(block);
  notes.push(...collectNotes($, block));
  const href = titleLink.attr('href');

  return {
    id: `${SOURCE_ID}:${performanceId}`,
    sourceId: SOURCE_ID,
    // Das D'haus setzt Titel in Versalien („FANNY UND ALEXANDER").
    title: softenShouted(title),
    subtitle: credits.length ? credits.join(' · ') : undefined,
    // Sparten im Wortlaut: „Schauspiel", „Junges Schauspiel", „Stadt:Kollektiv".
    category: list($, block.find('.performance__categories .attribute')).join(', ') || undefined,
    start: berlinIso(date, time ? Number(time[1]) : 0, time ? Number(time[2]) : 0),
    allDay: !time,
    venue: { name: venueName(block.find('.performance__location').first().text()) },
    availability: ticket.availability,
    availabilityLabel: ticket.label,
    ticketUrl: ticket.url,
    url: href ? absolute(href) : `${BASE}/programm/`,
    notes: notes.length ? notes : undefined,
  };
}

/**
 * Ticketlage aus Klasse und Text des Knopfs:
 *
 * - `a.ticketbutton--style-tickets` „Karten"
 * - `a.ticketbutton--style-leftover` „Restkarten"
 * - `span.ticketbutton--style-soldout` „Ausverkauft"
 * - Banner `performance__changebanner` „Vorstellungsausfall" – das
 *   Datenmodell kennt keine Absage; über die Quelle gibt es keine Karten
 * - kein Knopf: Abendkasse, freie Veranstaltungen, heute schon begonnen
 */
function readTicket(block: Node): { availability: Availability; label?: string; url?: string } {
  const change = line(block.find('.performance__changebanner').first().text());
  if (change && /ausfall|abgesagt|entfällt/i.test(change)) return { availability: 'not_on_sale', label: change };

  const button = block.find('.ticketbutton').first();
  if (!button.length) return { availability: 'unknown' };
  const label = line(button.text());
  const classes = button.attr('class') ?? '';
  const lower = (label ?? '').toLowerCase();
  const url = button.is('a') ? button.attr('href')?.trim() : undefined;

  if (classes.includes('style-soldout') || lower.includes('ausverkauft')) return { availability: 'soldout', label };
  if (classes.includes('style-leftover') || /restkarten|letzte/.test(lower)) {
    return { availability: 'limited', label, url };
  }
  if (url) return { availability: 'available', label, url };
  return { availability: 'unknown', label };
}

function collectNotes($: cheerio.CheerioAPI, block: Node): string[] {
  const notes: string[] = [];
  const push = (text: string | undefined) => {
    if (text && !notes.includes(text)) notes.push(text);
  };

  // „Frei" steht im Preisfeld; ohne Beschriftung wäre es mehrdeutig.
  const price = line(block.find('.performance__priceinfotext').first().text());
  if (price) push(/^frei$/i.test(price) ? 'Eintritt frei' : price);

  // „👀 ab 6 Jahren", „👀 Kinder- und Familienstück ab 6 Jahren"
  const age = line(withoutPictographs(block.find('.performance__agerecommendation').first().text()));
  if (age) push(`Alter: ${age}`);

  // „18:45 Einführung", „09:00 Touchtour", „Im Anschluss Nachgespräch"
  for (const [kind, nameClass] of [
    ['introevent', 'introeventname'],
    ['touchtour', 'touchtourdescription'],
  ] as const) {
    block.find(`.performance__${kind}`).each((_, el) => {
      const node = $(el);
      const name = line(node.find(`.performance__${nameClass}`).text());
      const at = line(node.find(`.performance__${kind}time`).text());
      if (!name) return;
      // „Touchtour | Wir bitten um Reservierung" – die Beschriftung ist der
      // erste Teil, der Rest ein Hinweis.
      const [label, ...rest] = name.split(/\s*\|\s*/);
      if (at && /^[\p{L} -]{1,24}$/u.test(label)) push(`${label}: ${[at, ...rest].join(' · ')}`);
      else push(at ? `${at} ${name}` : name);
    });
  }

  const subscription = line(withoutPictographs(block.find('.performance__subscriptioninfo').first().text()));
  if (subscription) push(subscription.replace(/^Abo\s+/, 'Abo: '));

  // „Premiere", „Zu Gast", „Familienvorstellung", „2:1 Weihnachtsaktion"
  for (const attribute of list($, block.find('.performance__attributes .attribute'))) {
    push(attribute.replace(/^➽\s*/, ''));
  }

  block.find('.performance__icon').each((_, el) => push(line($(el).text())));
  // Ein Hinweis kann ein Tooltip sein: Linktext als Notiz, das Popup
  // dahinter ist Fliesstext und kein Fall für eine Tabellenzeile.
  block.find('.performance__infotext').each((_, el) => {
    const copy = $(el).clone();
    copy.find('.tooltip__popup').remove();
    push(line(copy.text()));
  });

  return notes;
}

/* ------------------------------------------------------------------ */
/* Produktionsseite                                                    */

/**
 * Die Produktionsseite (`/programm/spielplan/{produktion}/{NNNN}/`): der
 * Programmtext in `richtext` (ohne das grossgesetzte Zitat am Anfang und ohne
 * Pressestimmen, die in eigenen Blöcken stehen) und die Dauer unter
 * `productiondetails`.
 */
export function parseProductionDetail(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);
  const paragraphs = $('.richtext')
    .not('.richtext--size-large')
    .find('.richtext__text')
    .map((_, el) => {
      const copy = $(el).clone();
      // Nur `<br>` trennt Zeilen; Umbrüche im Quelltext sind Leerraum.
      copy.find('br').replaceWith(BREAK);
      return copy
        .text()
        .split(BREAK)
        .map(clean)
        .filter(Boolean)
        .join('\n');
    })
    .get()
    .filter(Boolean);

  const duration = line($('.productiondetails__durationinfo .productiondetails__item').first().text());
  const description = paragraphs.length ? paragraphs.join('\n\n') : undefined;
  if (!description && !duration) return undefined;
  return { description, notes: duration ? [`Dauer: ${duration}`] : undefined };
}

/* ------------------------------------------------------------------ */

// Ein Zeichen, das in Spielplänen nicht vorkommt; NUL überlebt das
// HTML-Parsen von `replaceWith` nicht.
const BREAK = '\u241E';

/** „📍 Schauspielhaus, Großes Haus" → „Schauspielhaus, Großes Haus". */
function venueName(raw: string): string {
  return line(withoutPictographs(raw)) ?? 'Düsseldorfer Schauspielhaus';
}

function withoutPictographs(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}️]/gu, '');
}

/** Eine Zeile Text ohne `&shy;` („NEIN&shy;horn"). */
function line(text: string | undefined): string | undefined {
  return clean((text ?? '').replace(/­/g, '')) || undefined;
}

function list<T>($: cheerio.CheerioAPI, nodes: cheerio.Cheerio<T>): string[] {
  return nodes
    .map((_, el) => line($(el as never).text()))
    .get()
    .filter((text): text is string => Boolean(text));
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}
