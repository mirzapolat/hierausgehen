import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { zonedIso } from '../../time.ts';
import { clean } from '../../text.ts';

/**
 * Parser für The Stand Comedy Club Glasgow
 * (`https://www.thestand.co.uk/whats-on/glasgow/<monat>/<jahr>`).
 *
 * Der Club rendert seinen Spielplan serverseitig und **je Vorstellung** – kein
 * Umweg über Produktionen, kein Nachladen im Browser. Eine Karte ist genau ein
 * Abend, mit Beginn, Einlass, Spieldauer, den auftretenden Comedians und der
 * Adresse der Vorstellungsseite.
 *
 * Die Monatsseite ist der eigentliche Fund. Die vom Nutzer genannte Seite
 * `/glasgow-stand-up-comedy` ist eine Werbeseite und zeigt sechs Abende; die
 * Übersicht `/whats-on/glasgow` zeigt neunundsiebzig ohne Zeitraumangabe.
 * Erst `/whats-on/glasgow/october/2026` beantwortet die Frage, die der
 * Kalender stellt – und zwar auch für **vergangene** Monate, was ein
 * Ticketshop sonst selten tut.
 *
 * Drei Dinge, die beim Lesen wichtig sind:
 *
 *  - **Nur das Raster des angefragten Monats zählt.** Die Seite scrollt
 *    endlos weiter und hängt Folgemonate als
 *    `data-listings-month-grid="supplemental"` an. Auf einem leeren Monat ist
 *    das der einzige Inhalt: die August-2027-Seite trägt eine Karte, und die
 *    steht im September 2027. Wer alle Karten nimmt, holt sich Termine, die er
 *    nie angefragt hat.
 *  - **Ein leerer Monat sagt es selbst.** `.new-start-empty-state` mit „No
 *    performances listed for August 2027" – festgemacht wird daran, nicht an
 *    der Antwortlänge.
 *  - **Vergangene Abende tragen „Show archive" statt „Tickets and Info".**
 *    Das ist keine Ticketlage, sondern die Auskunft, dass hier nichts mehr zu
 *    verkaufen ist: solche Termine bleiben `unknown`. Ob sie vorbei sind,
 *    leitet die Anzeige ohnehin aus der Zeit ab.
 *
 * `datetime` ist Ortszeit ohne Zonenzeichen („2026-10-01T20:00:00"); gerechnet
 * wird über die Zeitzone, damit der Offset auch in der Umstellungsnacht stimmt.
 *
 * Zur `robots.txt`: gesperrt sind Konto, Warenkorb, Bezahlung und `/search/`.
 * `/whats-on/…` und `/performance/…` sind frei.
 */

export const SOURCE_ID = 'thestand-glasgow';
export const BASE = 'https://www.thestand.co.uk';
export const TIME_ZONE = 'Europe/London';
export const VENUE = 'The Stand Comedy Club Glasgow';

type Card = cheerio.Cheerio<never>;

export interface ParsedMonth {
  events: CalendarEvent[];
  /**
   * Die Quelle sagt ausdrücklich, dass in diesem Monat nichts ansteht. Kein
   * Ausfall – Sommerpause und noch nicht angekündigte Monate sehen so aus.
   */
  empty: boolean;
  /** Ist das überhaupt die Monatsseite? Sonst: Aufbau geändert. */
  recognised: boolean;
}

/** Monatsseite eines Monats: `/whats-on/glasgow/october/2026`. */
export function monthUrl(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${BASE}/whats-on/glasgow/${MONTH_NAMES[index - 1]}/${year}`;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Die Karten des angefragten Monats in Termine übersetzen.
 *
 * Gelesen wird ausschliesslich das Raster `month-grid="primary"`; alles
 * darunter gehört zu einem anderen Monat.
 */
export function parseMonth(html: string): ParsedMonth {
  const $ = cheerio.load(html);
  const grid = $('[data-listings-month-grid="primary"]');
  if (grid.length === 0) return { events: [], empty: false, recognised: false };

  if (grid.find('.new-start-empty-state').length > 0) {
    return { events: [], empty: true, recognised: true };
  }

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();

  grid.find('article.new-start-show-card').each((_index, element) => {
    const event = toEvent($, $(element) as unknown as Card);
    if (!event || seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  });

  return { events, empty: false, recognised: true };
}

/**
 * Der lange Ankündigungstext der Vorstellungsseite.
 *
 * Er hängt am Stück, nicht am Abend – „The Saturday Show" läuft jede Woche mit
 * demselben Text. Das Laden entdoppelt deshalb über den Titel-Slug der
 * Adresse, nicht über die Vorstellungs-ID.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  const blurb = $('#show-blurb');
  if (blurb.length === 0) return undefined;

  const paragraphs = blurb
    .find('p')
    .map((_index, element) => clean($(element).text()))
    .get()
    .filter(Boolean);

  const text = clean(paragraphs.length > 0 ? paragraphs.join(' ') : blurb.text());
  return text.length >= 40 ? text : undefined;
}

/**
 * Die Produktion hinter einer Vorstellungsadresse.
 *
 * `/performance/21389/phil-ellis-bath-mat/20260905/glasgow` – die Zahl ist der
 * Abend, der Slug das Stück. Für den Programmtext zählt der Slug.
 */
export function showKey(url: string): string | undefined {
  return /\/performance\/\d+\/([^/]+)\//.exec(url)?.[1];
}

// ------------------------------------------------------------ eine Karte

function toEvent($: cheerio.CheerioAPI, card: Card): CalendarEvent | undefined {
  const link = card.find('a[href^="/performance/"]').first();
  const href = link.attr('href');
  const id = href ? /\/performance\/(\d+)\//.exec(href)?.[1] : undefined;

  const local = card.find('time.new-start-date-badge').attr('datetime');
  const start = local ? localIso(local) : undefined;

  const title = clean(card.find('h3').first().text());
  if (!id || !href || !start || !title) return undefined;

  const details = readDetails(card, $);
  const acts = card
    .find('.new-start-card-acts li a span')
    .map((_index, element) => clean($(element).text()))
    .get()
    .filter(Boolean);

  const { availability, availabilityLabel } = availabilityOf(card, clean(link.text()));

  const notes: string[] = [];
  if (details.doors) notes.push(`Doors: ${details.doors}`);
  if (details.duration) notes.push(`Duration: ${details.duration} mins`);

  return {
    id: `${SOURCE_ID}:${id}`,
    sourceId: SOURCE_ID,
    title,
    // Die Auftretenden sind die zweite Zeile der Karte – bei einer gemischten
    // Bill ("The Saturday Show") ist das die eigentliche Auskunft.
    subtitle: acts.length > 0 ? acts.join(', ') : undefined,
    start,
    end: details.duration ? addMinutes(start, details.duration) : undefined,
    allDay: false,
    venue: { name: VENUE },
    availability,
    availabilityLabel,
    url: `${BASE}${href}`,
    notes: notes.length > 0 ? notes : undefined,
  };
}

/**
 * Ticketlage aus zwei unabhängigen Signalen.
 *
 * Das Abzeichen `--sold-out` und die Beschriftung des Knopfes sagen dasselbe
 * mit verschiedenen Mitteln; „Show archive" statt „Tickets and Info" heisst,
 * dass der Abend gespielt ist und die Quelle zur Ticketlage nichts mehr sagt.
 */
function availabilityOf(
  card: Card,
  buttonLabel: string,
): { availability: Availability; availabilityLabel?: string } {
  const badge = clean(card.find('.new-start-status-badge--sold-out').text());
  if (badge) return { availability: 'soldout', availabilityLabel: badge || 'Sold Out' };
  if (/archive/i.test(buttonLabel)) return { availability: 'unknown' };
  if (/tickets/i.test(buttonLabel)) return { availability: 'available' };
  return { availability: 'unknown' };
}

interface CardDetails {
  doors?: string;
  duration?: number;
}

/** „Doors:19:00", „Starts:20:00 - 21:40", „Duration:100 mins". */
function readDetails($card: Card, $: cheerio.CheerioAPI): CardDetails {
  const details: CardDetails = {};
  $card.find('.new-start-event-details li').each((_index, element) => {
    const text = clean($(element).text());
    const doors = /Doors:?\s*(\d{1,2}:\d{2})/i.exec(text);
    if (doors) details.doors = doors[1];
    const duration = /Duration:?\s*(\d{1,4})\s*mins/i.exec(text);
    if (duration) details.duration = Number(duration[1]);
  });
  return details;
}

/** "2026-10-01T20:00:00" (Ortszeit) -> "2026-10-01T20:00:00+01:00". */
function localIso(local: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return undefined;
  return zonedIso(TIME_ZONE, match[1], Number(match[2]), Number(match[3]));
}

/**
 * Ende aus Beginn und Spieldauer.
 *
 * Über die Zeitzone gerechnet statt am ISO-String geschraubt: ein Abend, der
 * nach Mitternacht endet, wechselt den Tag, und in der Umstellungsnacht auch
 * den Offset.
 */
function addMinutes(start: string, minutes: number): string | undefined {
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  const end = new Date(new Date(start).getTime() + minutes * 60_000);
  const parts: Record<string, string> = {};
  for (const part of LOCAL_TIME.formatToParts(end)) parts[part.type] = part.value;
  return zonedIso(
    TIME_ZONE,
    `${parts.year}-${parts.month}-${parts.day}`,
    Number(parts.hour),
    Number(parts.minute),
  );
}

const LOCAL_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
