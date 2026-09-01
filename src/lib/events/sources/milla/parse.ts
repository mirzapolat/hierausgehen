import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für das Programm des Milla (`https://milla-club.de/`).
 *
 * Die Startseite ist das Programm: sie rendert die gesamte angekündigte
 * Spielzeit serverseitig als `div.event`, chronologisch aufsteigend und ohne
 * Blättern. Einen Parameter für den Zeitraum gibt es nicht.
 *
 * Die fünf Blöcke des Kopf-Sliders tragen `featured-event` statt `event` und
 * wiederholen nur die nächsten Termine – sie werden nicht mitgezählt.
 *
 * **Ein Jahr steht nirgends im Markup.** Die Liste nennt je Termin nur
 * "Sep 01" und "Tue 19.00". Weil sie aufsteigend sortiert ist und mit dem
 * nächsten Termin beginnt, ergibt sich das Jahr aus dem Bezugstag plus einem
 * Übertrag bei jedem Rücksprung im Datum (Dez → Jan). Das ist der einzige
 * Weg, den die Quelle offen lässt, und er bricht nur, wenn die Sortierung
 * bricht – dann stimmt aber ohnehin nichts mehr.
 *
 * Ausverkauftes steht als `div.sold-out` im Bild, nicht am Ticketknopf: der
 * heisst auch dann "Tickets" und verlinkt weiter zum Vorverkauf.
 */

const SOURCE_ID = 'milla';
const BASE = 'https://milla-club.de';
const VENUE = 'Milla';

/** "Sep 01" – englische Monatskürzel, wie die Seite sie schreibt. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Tue 19.00" */
const TIME = /(\d{1,2})[.:](\d{2})/;

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke ohne Datum, Titel oder Link – für Monitoring/Logs. */
  skipped: number;
}

/**
 * @param today Bezugstag "YYYY-MM-DD" für das fehlende Jahr.
 */
export function parseProgrammePage(html: string, today: string): ParseResult {
  const $ = cheerio.load(html);

  const events: CalendarEvent[] = [];
  let skipped = 0;

  const nextDate = yearWalker(today);

  $('.event').not('.featured-event').each((_, element) => {
    const item = $(element);

    const link = item.find('.event__title a').first();
    const url = link.attr('href');
    const title = readTitle($, item);
    const day = parseDay(clean(item.find('.column.is-date').first().text()));
    const time = clean(item.find('.column.is-date').first().next().text()).match(TIME);

    if (!url || !title || !day || !time) {
      skipped++;
      return;
    }

    const date = nextDate(day);
    const ticket = item.find('a.event__tickets').first();
    // Ohne Vorverkauf steht der Knopf mit leerer Adresse da.
    const ticketUrl = ticket.attr('href')?.trim() || undefined;
    // Der Ticketknopf heisst immer "Tickets"; ausverkauft steht am Bild.
    const soldout = item.find('.sold-out').length > 0;

    events.push({
      id: `${SOURCE_ID}:${slug(url)}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      // Die Liste führt weder Untertitel noch Programmtext noch Gattung.
      // Der Text kommt von der Detailseite, die Gattung aus der Definition.
      start: berlinIso(date, Number(time[1]), Number(time[2])),
      allDay: false,
      venue: { name: VENUE },
      availability: soldout ? 'soldout' : ticketUrl ? 'available' : 'unknown',
      availabilityLabel: soldout ? clean(item.find('.sold-out').first().text()) : undefined,
      ticketUrl: soldout ? undefined : ticketUrl,
      url,
    });
  });

  return { events, skipped };
}

/**
 * Programmtext der Detailseite. Der erste Absatz ist die Gattung in
 * Versalien ("KONZERT", "SONG SLAM") – der bleibt als Zeile stehen, weil die
 * Quelle sonst nirgends sagt, um was für einen Abend es sich handelt.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);

  const paragraphs: string[] = [];
  $('article .content p').each((_, element) => {
    const text = clean($(element).text());
    if (text) paragraphs.push(text);
  });

  // Ein einzelnes Gattungswort allein ist kein Programmtext.
  if (paragraphs.length < 2) return undefined;
  return paragraphs.join('\n\n');
}

/* ------------------------------------------------------------------ */

type Root = cheerio.CheerioAPI;
type Item = ReturnType<Root>;

interface Day {
  month: number;
  day: number;
}

/**
 * Vergibt die Jahre über eine aufsteigend sortierte Liste von Tagen ohne
 * Jahresangabe. Das erste Datum liegt am Bezugstag oder danach; jeder
 * Rücksprung im Datum ist ein Jahreswechsel.
 *
 * (Kein `class` mit Parameter-Properties: Node zieht TypeScript nur aus,
 * übersetzt es aber nicht.)
 */
function yearWalker(today: string): (day: Day) => string {
  let year = Number(today.slice(0, 4));
  let previous: Day | undefined;

  return (day) => {
    if (previous === undefined) {
      // Ein erstes Datum deutlich vor heute gehört ins nächste Jahr: die
      // Liste beginnt mit dem nächsten Termin, nicht mit einem vergangenen.
      if (iso(year, day) < shift(today, -30)) year++;
    } else if (day.month < previous.month || (day.month === previous.month && day.day < previous.day)) {
      year++;
    }

    previous = day;
    return iso(year, day);
  };
}

function iso(year: number, day: Day): string {
  return `${year}-${pad(day.month)}-${pad(day.day)}`;
}

/** "YYYY-MM-DD" um `days` Tage verschieben. */
function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function parseDay(text: string): Day | undefined {
  const match = text.match(/^(\p{L}{3,})\.?\s+(\d{1,2})$/u);
  const month = MONTHS[match?.[1].slice(0, 3).toLowerCase() ?? ''];
  const day = Number(match?.[2]);
  if (!month || !day || day < 1 || day > 31) return undefined;
  return { month, day };
}

/**
 * Der Titel steht im `h3` zweimal – einmal als Text, einmal im `span`, den
 * die Seite für die Laufschrift braucht. Die Kinder entfernen, dann bleibt er
 * einmal übrig.
 */
function readTitle($: Root, item: Item): string {
  const heading = item.find('.event__title h3').first();
  const own = clean(heading.clone().children().remove().end().text());
  return own || clean(heading.attr('title') ?? '');
}

/** Letztes Pfadstück der Detailadresse – je Termin eindeutig. */
function slug(url: string): string {
  return url.replace(BASE, '').replace(/^\/+|\/+$/g, '') || url;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
