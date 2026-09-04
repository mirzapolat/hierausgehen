import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { zonedIso } from '../../time.ts';
import { clean } from '../../text.ts';

/**
 * Parser für „What's On" von Glasgow Life
 * (`https://www.glasgowlife.org.uk/whats-on`).
 *
 * Die Seite ist ein Umbraco-Suchergebnis und wird vollständig serverseitig
 * gerendert – kein JSON, kein ld+json, kein Nachladen. Ein Treffer ist ein
 * `article.card` mit genau drei Angaben:
 *
 *     <h2 class="card__title"><a href="/event/3/david-essex">David Essex</a></h2>
 *     <div class="card__meta">Thursday 3rd Sept 2026 7:00pm</div>
 *     <div class="card__meta">Glasgow Royal Concert Hall</div>
 *
 * dazu optional ein `div.card__label` mit der Reihe („RSNO", „Tramway",
 * „Celtic Connections").
 *
 * **Ein Feld für die Veranstaltungsart gibt es nicht** – nicht in der Liste,
 * nicht auf der Detailseite, nicht als Filter. (Die Facette „Age" wäre eine
 * Zielgruppe, aber kein Termin dieses Kanals trägt sie; der Ticketshop steht
 * hinter einer Bot-Erkennung.) Was die Seite stattdessen hergibt, sind drei
 * Stellen, an denen sie die Gattung selbst ausspricht:
 *
 *  1. Die **Programmschiene**, wo sie ein Klangkörper ist: RSNO, SCO und
 *     BBC SSO sind Orchester, Celtic Connections ein Musikfestival.
 *  2. Der **Titel**, wo er die Form nennt: „… in Concert", „Exhibition :",
 *     „Shorts Programme", „Poetry", „Bookbug", „Ceilidh", „Còisirean".
 *  3. Die Zeile **„Check venue opening times"** im Kasten „Dates and times"
 *     der Detailseite: ein Lauf ohne Anfangszeit, also eine Ausstellung oder
 *     Installation. Sie ist genauer als jede Tabelle von Häusern – im Tramway
 *     liegen Ausstellung und Gastspiel nebeneinander, und dieselbe Zeile
 *     unterscheidet sie.
 *
 * Übernommen wird der englische Wortlaut; `categories.ts` bildet ihn ab.
 * Wo keine der drei Stellen etwas sagt, bleibt `category` leer und der
 * Quellen-Fallback „Kultur" greift – geraten wird nichts.
 *
 * Die erste Meta-Zeile kennt vier Formen (alle 288 Treffer eines vollen
 * Abrufs fallen darunter):
 *
 *   Einzeltermin   Thursday 3rd Sept 2026 7:00pm
 *   Lauf           Thursday 3rd - Saturday 5th Sept 2026
 *                  Friday 5th Jun - Sunday 6th Sept 2026
 *                  Saturday 29th Nov 2025 - Sunday 13th Jun 2027
 *   Serie          Every week on Friday from 17th Jul 2026 until 19th Dec 2026
 *
 * Beim Lauf steht Monat und Jahr nur so weit da, wie sie sich ändern; die
 * linke Seite erbt vom rechten Rand. Läufe tragen nie eine Uhrzeit – die
 * Detailseite sagt dazu „Check venue opening times". Sie werden deshalb zu
 * einem ganztägigen Termin am ersten Tag mit gesetztem `end`; die
 * Originalzeile bleibt als Notiz stehen, damit die Laufzeit nicht verloren
 * geht. Serien werden in ihre Einzeltermine ausgerollt.
 *
 * Blätterung: `nav.pagination[data-pages]`. Fehlt sie, ist es die einzige
 * Seite. Ein Ergebnis ohne Treffer ist gültig (die Seitenhülle steht dann
 * trotzdem) – erkennbar an `div.whats-on__filters`.
 */

const SOURCE_ID = 'glasgowlife';
const BASE = 'https://www.glasgowlife.org.uk';
export const TIME_ZONE = 'Europe/London';

/** Serien werden ausgerollt, aber nicht endlos. */
const MAX_OCCURRENCES = 200;

/** Programmschienen, die für sich schon die Gattung nennen. */
const MUSIC_PROGRAMMES = new Set(['RSNO', 'SCO', 'BBC SSO', 'Celtic Connections']);

/**
 * Wörter, mit denen ein Titel die Form selbst benennt. Geprüft wird der Reihe
 * nach, das erste Muster gewinnt – deshalb steht die Form vor der Zielgruppe
 * („Family Film Screening" ist ein Kinotermin) und die Zielgruppe vor dem
 * Allerweltswort Konzert: „Children's Classic Concerts" gehört unter Kinder
 * und Familie, dort sucht danach jemand.
 */
const TITLE_CATEGORIES: [string, RegExp][] = [
  ['Film', /\b(?:films?|cinema|screening|shorts programme|fiolm)\b/i],
  ['Exhibition', /\b(?:exhibition|display)\b/i],
  ['Comedy', /\b(?:comedy|stand[- ]?up)\b/i],
  ['Poetry', /\b(?:poetry|storytelling|in conversation)\b/i],
  ['Dance', /\b(?:dance|dancing|ballet|ceilidh)\b/i],
  ['Talk', /\b(?:talk|workshops?|lecture|masterclass|quiz|symposium)\b/i],
  ['Family', /\b(?:bookbug|famil(?:y|ies)|kids?|children(?:'s)?)\b/i],
  [
    'Concert',
    /\b(?:in concert|concerts?|symphony|orchestra|philharmonic|recital|choirs?|còisir\w*|sings|the music of)\b/i,
  ],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "Thursday 3rd Sept 2026 7:00pm" – Wochentag, Monat und Jahr sind optional. */
const DATE =
  /^(?:[A-Za-z]+day,?\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+([A-Za-z]{3,9}))?(?:\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?$/i;
/** "Every week on Friday from 17th Jul 2026 until 19th Dec 2026" */
const WEEKLY = /^Every\s+week\s+on\s+[A-Za-z]+\s+from\s+(.+?)\s+until\s+(.+)$/i;

export interface ParsedList {
  events: CalendarEvent[];
  /** Zahl der Ergebnisseiten laut Blätterleiste; 1, wenn es keine gibt. */
  pageCount: number;
  /** Karten, deren Datumszeile keiner bekannten Form entsprach. */
  skipped: number;
  /** Ist das überhaupt eine „What's On"-Seite? Sonst: Aufbau geändert. */
  recognised: boolean;
}

export function parseListPage(html: string): ParsedList {
  const $ = cheerio.load(html);
  const recognised = $('div.whats-on__filters').length > 0;
  const pageCount = Number($('nav.pagination').first().attr('data-pages')) || 1;

  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('article.card').each((_, element) => {
    const card = $(element);
    const link = card.find('a.card__link').first();
    const href = link.attr('href');
    const title = clean(link.text());
    if (!href || !title) return;

    const metas = card
      .find('.card__meta')
      .map((_i, meta) => clean($(meta).text()))
      .get();
    const [when, venue] = metas;
    if (!when) return;

    const occurrences = readWhen(when);
    if (occurrences.length === 0) {
      skipped++;
      return;
    }

    // "/event/3/david-essex" – die Zahl ist ein Zähler über die Termine
    // desselben Titels und verschiebt sich, sobald einer vorbei ist. Als ID
    // taugt sie nicht; Tag, Uhrzeit und Titelkürzel schon.
    const url = new URL(href, BASE).toString();
    const label = clean(card.find('.card__label').first().text());
    const slug = href.split('/').filter(Boolean).pop() ?? '';

    for (const occurrence of occurrences) {
      const { day, hour, minute, endDay } = occurrence;
      const allDay = hour === undefined;
      const stamp = allDay ? '' : `-${pad(hour)}${pad(minute ?? 0)}`;

      const notes: string[] = [];
      // Der Wortlaut der Quelle bleibt stehen, wo der einzelne Termin die
      // Laufzeit oder die Serie nicht mehr erkennen lässt.
      if (endDay || /^Every/i.test(when)) notes.push(when);
      if (label) notes.push(label);

      events.push({
        id: `${SOURCE_ID}:${day}${stamp}-${slug}`,
        sourceId: SOURCE_ID,
        title,
        category: cardCategory(label, title),
        start: zonedIso(TIME_ZONE, day, hour ?? 0, minute ?? 0),
        end: endDay ? zonedIso(TIME_ZONE, endDay, 23, 59) : undefined,
        allDay,
        venue: { name: venue || '' },
        // Weder Liste noch Detailseite nennen die Ticketlage; der Kaufknopf
        // steht erst hinter dem Link.
        availability: 'unknown',
        url,
        notes: notes.length > 0 ? notes : undefined,
      });
    }
  });

  return { events, pageCount, skipped, recognised };
}

/**
 * Was die Detailseite über die Liste hinaus hergibt: Programmtext, Preise,
 * Ticketlink und Ticketlage.
 *
 * Der Kasten „Tickets" ist immer gleich gebaut – erste Zeile die Preise oder
 * „Free …", danach optional der Knopf:
 *
 *     <dt>Tickets</dt>
 *     <dd class="event-details__bd">
 *       <div class="push-bottom--half">£56.94, £40.70, VIP £115.50 (…)</div>
 *       <div class="push-bottom--half"></div>
 *       <div class="push-bottom--half"><a class="btn btn-primary …">Buy tickets now</a></div>
 *
 * Der Knopf heisst „Buy tickets now" (eigener Shop) oder „Book now" (auch
 * Eventbrite); beides ist ein laufender Verkauf. Fehlt er, verkauft die Seite
 * nicht – entweder weil nichts zu verkaufen ist („Free - Drop-in - no ticket
 * required") oder weil anderswo gebucht wird („book in venue or online").
 *
 * **Ausverkauft** meldet die Seite nicht im Ticketkasten: der Kaufknopf bleibt
 * stehen. Der einzige Hinweis ist eine von Hand vorangestellte Zeile im
 * Programmtext, kursiv und für sich allein: „- Sold out -". Deshalb wird nur
 * genau das gewertet – eine eigene kurze Zeile am Anfang. „has consistently
 * sold out concert halls" mitten im Fliesstext ist eine Biografie, kein
 * Zustand, und darf nicht zählen.
 */
export function parseDetailPage(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);

  const tickets = $('dt.event-details__title')
    .filter((_i, el) => clean($(el).text()) === 'Tickets')
    .first()
    .next('dd.event-details__bd');

  const price = clean(tickets.children('div').first().text());
  const button = tickets.find('a.event-details__btn').first();
  const ticketUrl = button.attr('href');

  const article = $('div.editor--article').first();
  // Einmal lesen: `.text()` klebt Blockelemente aneinander ("HallDoors: 7pm"),
  // erst die aufbereitete Fassung trennt sie wieder.
  const description = readDescription(article);
  const soldOut = isSoldOut($, article);
  const { category, startTime } = readDatesAndTimes($);

  let availability: Availability = 'unknown';
  let availabilityLabel: string | undefined;
  if (soldOut) {
    availability = 'soldout';
    availabilityLabel = 'Sold out';
  } else if (ticketUrl) {
    availability = 'available';
    availabilityLabel = clean(button.text()) || undefined;
  } else if (price) {
    // Kein Knopf heisst: über diese Seite wird nicht verkauft. Der Wortlaut
    // sagt, warum – frei und ohne Karte, oder Buchung anderswo.
    availability = 'not_on_sale';
    availabilityLabel = price;
  }

  const detail: EventDetail = {
    description,
    category: category ?? (description && DOORS.test(description) ? 'Concert' : undefined),
    startTime,
    availability,
    availabilityLabel,
    ticketUrl: ticketUrl || undefined,
    notes: price ? [`Tickets: ${price}`] : undefined,
  };

  return detail.description || detail.ticketUrl || price || detail.category || startTime
    ? detail
    : undefined;
}

/** Nur der Programmtext – für Quellen, die sonst nichts von hier brauchen. */
export function parseDetailDescription(html: string): string | undefined {
  return readDescription(cheerio.load(html)('div.editor--article').first());
}

/**
 * Der lange Ankündigungstext (`div.editor--article`).
 *
 * Danach folgen Aufklappkästen mit Anfahrt, Barrierefreiheit und
 * Öffnungszeiten – die sind bei jedem Termin desselben Hauses gleich und
 * gehören nicht in den Text.
 */
function readDescription(article: cheerio.Cheerio<Element>): string | undefined {
  if (article.length === 0) return undefined;

  const copy = article.clone();
  copy.find('script, style').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p, div, h1, h2, h3, h4, li').append('\n');

  const text = clean(copy.text());
  return text.length >= 40 ? text : undefined;
}

/**
 * „Doors: 7pm" im Ankündigungstext.
 *
 * Die Einlasszeit schreibt Glasgow Life nur zu Konzerten – in der Stichprobe
 * von 99 Detailseiten elfmal, und jedes Mal zu einem Auftritt (Mogwai, Jake
 * Bugg, Katherine Jenkins, Morcheeba …). Das ist genau der Block, den weder
 * Programmschiene noch Titel fassen: Popkonzerte, die nur den Namen des
 * Künstlers tragen.
 */
const DOORS = /\bdoors\b\s*:?\s*\d/i;

/**
 * Der Kasten „Dates and times" – die Liste zeigt davon nur die erste Zeile.
 *
 *     Friday 16th - Saturday 17th Oct 2026
 *     <div class="push-bottom--half">7:30pm</div>
 *
 * Zwei Dinge stehen hier, die die Karte verschweigt. Erstens: ein Lauf kann
 * sehr wohl eine Anfangszeit haben („Al Seed Productions – Thrice", 7:30pm an
 * beiden Abenden) – dann ist er kein ganztägiger Termin. Zweitens: steht dort
 * „Check venue opening times", läuft nichts zu einer festen Zeit, sondern das
 * Haus hat geöffnet – eine Ausstellung oder Installation.
 */
function readDatesAndTimes($: cheerio.CheerioAPI): {
  category?: string;
  startTime?: string;
} {
  const block = $('dt.event-details__title')
    .filter((_i, el) => clean($(el).text()) === 'Dates and times')
    .first()
    .next('dd.event-details__bd');
  if (block.length === 0) return {};

  const text = clean(block.text());
  if (/check venue opening times/i.test(text)) return { category: 'Exhibition' };

  const time = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!time) return {};
  const hour = Number(time[1]) % 12;
  const shifted = time[3].toLowerCase() === 'pm' ? hour + 12 : hour;
  return { startTime: `${pad(shifted)}:${time[2]}` };
}

/** "- Sold out -" als eigene Zeile am Anfang des Programmtextes. */
const SOLD_OUT = /^[\s\u2013\u2014-]*sold\s*out[\s\u2013\u2014-]*$/i;

function isSoldOut($: cheerio.CheerioAPI, article: cheerio.Cheerio<Element>): boolean {
  if (article.length === 0) return false;
  return article
    .children()
    .slice(0, 3)
    .toArray()
    .some((element) => SOLD_OUT.test(clean($(element).text())));
}

/**
 * Die Gattung aus dem, was die Karte selbst sagt: erst die Programmschiene,
 * dann der Titel. Sagt keines von beidem etwas, bleibt es leer.
 */
function cardCategory(label: string, title: string): string | undefined {
  if (MUSIC_PROGRAMMES.has(label)) return 'Concert';
  for (const [category, pattern] of TITLE_CATEGORIES) {
    if (pattern.test(title)) return category;
  }
  return undefined;
}

interface Occurrence {
  day: string;
  hour?: number;
  minute?: number;
  /** Letzter Tag eines Laufs. */
  endDay?: string;
}

/** Die erste Meta-Zeile einer Karte in konkrete Termine übersetzen. */
function readWhen(when: string): Occurrence[] {
  const weekly = when.match(WEEKLY);
  if (weekly) {
    const from = readDate(weekly[1]);
    const until = readDate(weekly[2]);
    if (!from?.day || !until?.day) return [];
    const days: Occurrence[] = [];
    for (let day = from.day; day <= until.day && days.length < MAX_OCCURRENCES; day = addDays(day, 7)) {
      days.push({ day, hour: from.hour, minute: from.minute });
    }
    return days;
  }

  const parts = when.split(/\s+[-–]\s+/);
  if (parts.length === 2) {
    // "Thursday 3rd - Saturday 5th Sept 2026": links fehlen Monat und Jahr,
    // beides steht nur am rechten Rand.
    const right = readDate(parts[1]);
    let left = readDate(parts[0], right);
    if (!left?.day || !right?.day) return [];
    // Über den Jahreswechsel ("Wednesday 30th Dec - Sunday 3rd Jan 2027")
    // gehört das geerbte Jahr dem rechten Rand, nicht dem linken.
    if (left.day > right.day && !/\d{4}/.test(parts[0])) {
      left = readDate(parts[0], { ...right, year: right.year! - 1 });
      if (!left?.day) return [];
    }
    return [{ day: left.day, endDay: right.day }];
  }

  const single = readDate(when);
  if (!single?.day) return [];
  return [{ day: single.day, hour: single.hour, minute: single.minute }];
}

interface ReadDate {
  day?: string;
  hour?: number;
  minute?: number;
  month?: number;
  year?: number;
}

/** `fallback` liefert Monat und Jahr, wo die Zeile sie weglässt. */
function readDate(text: string, fallback?: ReadDate): ReadDate | undefined {
  const match = clean(text).match(DATE);
  if (!match) return undefined;

  const date = Number(match[1]);
  const month = match[2] ? MONTHS[match[2].toLowerCase()] : fallback?.month;
  const year = match[3] ? Number(match[3]) : fallback?.year;
  if (!month || !year) return undefined;

  const result: ReadDate = {
    day: `${year}-${pad(month)}-${pad(date)}`,
    month,
    year,
  };

  if (match[4]) {
    const hour = Number(match[4]) % 12;
    result.hour = match[6].toLowerCase() === 'pm' ? hour + 12 : hour;
    result.minute = Number(match[5]);
  }
  return result;
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
