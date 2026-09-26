import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Programm des Bahnwärter Thiel (`https://www.bahnwaerterthiel.de/`).
 *
 * Die Startseite ist das Programm: WordPress rendert die gesamte angekündigte
 * Zeit serverseitig als ineinander geschachtelte `div.bmt-wrap` (Aufklapp-
 * Boxen des Plugins "BookMeTender"). Es gibt weder einen Parameter für den
 * Zeitraum noch eine Schnittstelle – die WordPress-REST-Routen kennen keinen
 * Termin-Typ, der Kalender-Beitragstyp enthält nur eine einzige Seite.
 *
 * Die Schachtelung hat zwei Ebenen: aussen ein Abschnitt je Monat ("Archiv",
 * "September", "Oktober"), innen die Termine. Beide Ebenen tragen dieselbe
 * Klasse; ein Block zählt deshalb nur als Termin, wenn seine Beschriftung mit
 * einem Datum beginnt. Vergangenes bleibt unter "Archiv" stehen und wird
 * mitgelesen – der Zeitraumfilter entscheidet, was davon gebraucht wird.
 *
 * Aufbau einer Beschriftung:
 *
 *     Mittwoch 05.08.2026 – Einlass: 18:30 / 19:15-22:45 Uhr
 *     Bahnwörter Poetry Slam
 *     <p> Line-up, Zeile für Zeile </p>
 *
 * Im aufgeklappten Teil stehen die Preiszeile ("10€ Vorverkauf, 15€ Kasse"),
 * das Plakat und der Ankündigungstext. Der Link im Wort "Vorverkauf" ist der
 * einzige Hinweis auf die Ticketlage: gibt es ihn nicht, wird der Abend nur an
 * der Abendkasse verkauft. Ausverkauft oder Restkarten meldet die Seite nicht.
 *
 * Eine Detailseite je Termin gibt es nicht; alle Termine verweisen auf die
 * Startseite.
 */

const SOURCE_ID = 'bahnwaerterthiel';
const BASE = 'https://www.bahnwaerterthiel.de';
const VENUE = 'Bahnwärter Thiel';

/** "Mittwoch 05.08.2026 – …" – ohne Datum ist der Block ein Monatsabschnitt. */
const DATE = /(\d{2})\.(\d{2})\.(\d{4})/;
/** "Einlass: 18:30 /" – steht vor der eigentlichen Spielzeit. */
const DOORS = /Einlass:?\s*(\d{1,2})[.:](\d{2})/i;
/** "19:15-22:45 Uhr", "22-5 Uhr", "16-22 Uhr" */
const SPAN = /(\d{1,2})(?:[.:](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?\s*Uhr/;
/** "20 Uhr" – falls eine Zeile nur den Beginn nennt. */
const SINGLE = /(\d{1,2})(?:[.:](\d{2}))?\s*Uhr/;

/** Termine, übersprungene Blöcke und ob die Liste leer ist (siehe `page.ts`). */
export type ParseResult = PageResult;

export function parseProgrammePage(html: string): ParseResult {
  const $ = cheerio.load(html);

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  // Der Container steht auch in der Spielpause; fehlt er, ist der Aufbau neu.
  const list = $('.bmt-events');

  list.find('div.bmt-wrap').each((_, element) => {
    const item = $(element);
    const label = item.children('label').first();
    if (label.length === 0) return;

    // Die Beschriftung ohne das Line-up: erste Zeile Datum und Zeiten,
    // danach der Titel.
    const head = lines($, label.clone().find('p').remove().end());
    const meta = head[0] ?? '';
    const date = readDate(meta);
    // Kein Datum heisst: Monatsabschnitt ("Archiv", "September"), kein Termin.
    if (!date) return;

    const title = clean(head.slice(1).join(' '));
    const time = readTime(meta);
    if (!title || !time) {
      skipped++;
      return;
    }

    const body = item.children('.bmt-collapsible').first();
    // Der Vorverkaufslink steckt in der Preiszeile. Nur dort suchen – im
    // Ankündigungstext stehen auch Links, die nichts mit Tickets zu tun haben.
    const priceLine = readPriceLine($, body);
    const price = priceLine ? clean(priceLine.text()) : undefined;
    const ticketUrl = priceLine?.find('a[href]').first().attr('href')?.trim() || undefined;

    const id = `${SOURCE_ID}:${date}-${slug(title)}`;
    // Ein Termin, der schon gelesen wurde, steht doppelt im Markup.
    if (seen.has(id)) return;
    seen.add(id);

    const lineup = lines($, label.find('p').first());
    const text = paragraphs($, body);
    const description = [lineup.join('\n'), text].filter(Boolean).join('\n\n') || undefined;

    const notes: string[] = [];
    if (time.doors) notes.push(`Einlass: ${time.doors}`);
    if (price) notes.push(price);

    events.push({
      id,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      description,
      // Eine Gattung führt die Seite nicht; sie kommt aus der Definition.
      start: berlinIso(date, time.startHour, time.startMinute),
      end: time.endDate
        ? berlinIso(time.endDate === 'next' ? nextDay(date) : date, time.endHour!, time.endMinute!)
        : undefined,
      allDay: false,
      venue: { name: VENUE },
      // Ohne Vorverkaufslink verkauft das Haus nur an der Abendkasse.
      availability: ticketUrl ? 'available' : price ? 'not_on_sale' : 'unknown',
      ticketUrl,
      url: `${BASE}/`,
      notes: notes.length > 0 ? notes : undefined,
    });
  });

  return { events, skipped, empty: list.length > 0 && events.length === 0 };
}

/* ------------------------------------------------------------------ */

type Root = cheerio.CheerioAPI;
type Node = ReturnType<Root>;

/**
 * Text eines Elements, an `<br>` in Zeilen zerlegt (leere Zeilen fallen weg).
 *
 * Der Zeilenumbruch muss erst markiert werden: das Markup ist eingerückt, ein
 * blosses `\n` liesse sich nicht mehr von der Einrückung unterscheiden – und
 * genau daran zerfiele die Beschriftung in vier statt zwei Zeilen.
 */
const BREAK = '@@br@@';

function lines($: Root, node: Node): string[] {
  if (node.length === 0) return [];
  const html = (node.html() ?? '').replace(/<br\s*\/?>|<\/br>/gi, BREAK);
  return $('<div>')
    .html(html)
    .text()
    .split(BREAK)
    .map(clean)
    .filter(Boolean);
}

function readDate(meta: string): string | undefined {
  const match = meta.match(DATE);
  if (!match) return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

interface Time {
  startHour: number;
  startMinute: number;
  endHour?: number;
  endMinute?: number;
  /** Ob das Ende auf denselben oder den folgenden Tag fällt. */
  endDate?: 'same' | 'next';
  doors?: string;
}

/**
 * "Einlass: 18:30 / 19:15-22:45 Uhr" – der Einlass wird vorher abgeschnitten,
 * sonst läse ihn die Zeitspanne als Beginn. Clubnächte enden am Folgetag
 * ("22-5 Uhr").
 */
function readTime(meta: string): Time | undefined {
  const doorsMatch = meta.match(DOORS);
  const rest = doorsMatch ? meta.slice(doorsMatch.index! + doorsMatch[0].length) : meta;
  const doors = doorsMatch ? `${doorsMatch[1]}:${doorsMatch[2]}` : undefined;

  const span = rest.match(SPAN);
  if (span) {
    const startHour = Number(span[1]);
    const startMinute = Number(span[2] ?? 0);
    const endHour = Number(span[3]);
    const endMinute = Number(span[4] ?? 0);
    if (!valid(startHour, startMinute) || !valid(endHour, endMinute)) return undefined;
    return {
      startHour,
      startMinute,
      endHour,
      endMinute,
      endDate: endHour * 60 + endMinute <= startHour * 60 + startMinute ? 'next' : 'same',
      doors,
    };
  }

  const single = rest.match(SINGLE);
  if (single) {
    const startHour = Number(single[1]);
    const startMinute = Number(single[2] ?? 0);
    if (!valid(startHour, startMinute)) return undefined;
    return { startHour, startMinute, doors };
  }

  // Nur der Einlass ist bekannt – besser als gar keine Uhrzeit.
  if (doorsMatch) {
    return { startHour: Number(doorsMatch[1]), startMinute: Number(doorsMatch[2]) };
  }
  return undefined;
}

function valid(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Die Preiszeile steht als erster Block im aufgeklappten Teil
 * ("10€ Vorverkauf, 15€ Kasse", "Eintritt frei").
 */
function readPriceLine($: Root, body: Node): Node | undefined {
  let line: Node | undefined;
  body.find('div[style*="margin-bottom"]').each((_, element) => {
    if (line) return;
    const node = $(element);
    const text = clean(node.text());
    if (text && /€|eintritt|kasse|spende/i.test(text)) line = node;
  });
  return line;
}

/** Ankündigungstext: die Absätze im aufgeklappten Teil. */
function paragraphs($: Root, body: Node): string {
  const texts: string[] = [];
  body.find('p').each((_, element) => {
    const text = lines($, $(element)).join('\n');
    if (text) texts.push(text);
  });
  return texts.join('\n\n');
}

/** "YYYY-MM-DD" einen Tag weiter. */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
