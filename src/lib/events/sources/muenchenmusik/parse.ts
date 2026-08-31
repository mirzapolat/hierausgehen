import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { TZ, berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für die Veranstaltungsliste von MünchenMusik
 * (`/mm/veranstaltungen`, ein Drupal-View mit ausgestellten Filtern).
 *
 * Aufbau: je Termin ein `div.event-overview-extended--item`, darin Datum und
 * Uhrzeit als `<time datetime>`, Titel und Adresse in `h3.headline1 a`, die
 * Besetzungszeilen als weitere `h3`, die Spielstätte in
 * `…--details--time-location` und der Ticketlink als GET-Formular auf den
 * Shop von Virtuopolis. Die Termin-ID steckt in dessen `veranst`.
 *
 * Der Pager `div.view-pager` ist zugleich das Signal, dass die Liste
 * überhaupt gerendert wurde: er steht auch dann da, wenn der View nichts
 * findet – dann zusammen mit einer ausdrücklichen Leermeldung.
 *
 * Die Detailseiten gehören zur **Produktion**, nicht zum einzelnen Abend;
 * mehrere Termine teilen sich dieselbe Adresse.
 */

const SOURCE_ID = 'muenchenmusik';
const BASE = 'https://www.muenchenmusik.de';

/** Der View meldet einen leeren Treffersatz im Klartext. */
const EMPTY_MARKER = 'keine Ergebnisse gefunden';

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke ohne Titel oder Datum – für Monitoring/Logs. */
  skipped: number;
  /** Der View wurde gerendert und meldet ausdrücklich keine Treffer. */
  empty: boolean;
  /** Gefundene Terminblöcke, unabhängig davon, ob sie verwertbar waren. */
  blocks: number;
  /** Der Pager war da – ohne ihn hat sich der Aufbau geändert. */
  rendered: boolean;
  /** Es gibt eine weitere Seite („Mehr Veranstaltungen"). */
  hasNextPage: boolean;
}

export function parseListPage(html: string): ParseResult {
  const $ = cheerio.load(html);

  const pager = $('.view-pager');
  const items = $('.event-overview-extended--item');

  const events: CalendarEvent[] = [];
  let skipped = 0;

  items.each((_, element) => {
    const item = $(element) as unknown as Item;
    const event = readItem($, item);
    if (event) events.push(event);
    else skipped++;
  });

  return {
    events,
    skipped,
    empty: items.length === 0 && clean($('body').text()).includes(EMPTY_MARKER),
    blocks: items.length,
    rendered: pager.length > 0,
    hasNextPage: pager.find('a[rel="next"]').length > 0,
  };
}

/**
 * Programmtext einer Produktionsseite: die Werkliste bzw. der Einführungstext
 * aus `.event--intro-text--desc`. Alles andere auf der Seite sind Abo-Anzeigen,
 * Terminlisten und Empfehlungen – die gehören nicht in die Beschreibung.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);

  const lines: string[] = [];
  $('.event--intro-text--desc')
    .first()
    .find('p, li')
    .each((_, element) => {
      const text = clean($(element).text());
      if (text && !lines.includes(text)) lines.push(text);
    });

  // Steht der Text ohne Absätze im Container, bleibt der Container selbst.
  if (lines.length === 0) {
    const text = clean($('.event--intro-text--desc').first().text());
    if (text) lines.push(text);
  }

  return lines.length ? lines.join('\n') : undefined;
}

/* ------------------------------------------------------------------ */

type Item = cheerio.Cheerio<never>;

function readItem($: cheerio.CheerioAPI, item: Item): CalendarEvent | undefined {
  const link = item.find('h3.headline1 a[href]').first();
  const title = clean(link.text());
  const moment = berlinMoment(item.find('time[datetime]').first().attr('datetime'));

  if (!title || !moment) return undefined;

  const url = absolute(link.attr('href') ?? '');
  const ticketUrl = readTicketUrl($, item);
  const ticketId = item.find('input[name="veranst"]').first().attr('value');

  return {
    id: `${SOURCE_ID}:${clean(ticketId ?? '') || fallbackKey(moment, title)}`,
    sourceId: SOURCE_ID,
    title: softenShouted(title),
    subtitle: readSubtitle($, item),
    // Weder Kurztext noch Gattung stehen in der Liste; der Programmtext kommt
    // von der Produktionsseite, die Gattung über `defaultCategory`.
    start: berlinIso(moment.date, moment.hour, moment.minute),
    allDay: false,
    // Keine Stadt hart setzen: Herrenchiemsee und Frauenchiemsee stehen im
    // selben Programm.
    venue: { name: clean(item.find('.event-overview-extended--item-content--details--time-location').text()) },
    // Die Quelle kennt nur zwei Zustände, und beide leitet sie aus der Uhr ab:
    // der Kaufen-Knopf verschwindet rund anderthalb Stunden vor Beginn. Ein
    // „ausverkauft" oder „Restkarten" gibt es nirgends – deshalb `available`,
    // solange der Knopf da ist, und sonst keine Angabe.
    availability: ticketUrl ? 'available' : 'unknown',
    ticketUrl,
    url,
  };
}

/** Besetzungszeilen unter dem Titel; der versteckte Ticket-Hinweis nicht. */
function readSubtitle($: cheerio.CheerioAPI, item: Item): string | undefined {
  const lines: string[] = [];

  item
    .find('.event-overview-extended--item-content--details h3')
    .not('.headline1')
    .not('.print-at-home')
    .each((_, element) => {
      const text = clean($(element).text());
      if (text) lines.push(text);
    });

  return lines.length ? softenShouted(lines.join(' · ')) : undefined;
}

/**
 * Der Ticketlink ist ein GET-Formular auf den Shop – aus Ziel und versteckten
 * Feldern wird die Adresse, die der Knopf ansteuert.
 */
function readTicketUrl($: cheerio.CheerioAPI, item: Item): string | undefined {
  const form = item.find('form.check-bookable[action]').first();
  const action = form.attr('action');
  if (!action) return undefined;

  const params = new URLSearchParams();
  form.find('input[name]').each((_, element) => {
    const input = $(element);
    const name = input.attr('name');
    const value = input.attr('value');
    if (name && value) params.set(name, value);
  });

  const query = params.toString();
  if (!query) return undefined;

  try {
    return `${new URL(action, BASE).toString()}?${query}`;
  } catch {
    return undefined;
  }
}

/**
 * `datetime` steht als UTC-Zeitpunkt in der Liste ("2026-11-01T19:00:00Z"),
 * angezeigt wird Münchner Zeit. Umgerechnet wird über die Zeitzone, damit
 * Sommer- und Winterzeit von selbst stimmen.
 */
function berlinMoment(value: string | undefined):
  | { date: string; hour: number; minute: number }
  | undefined {
  if (!value) return undefined;

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return undefined;

  const parts = berlinParts.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  return { date, hour: Number(get('hour')), minute: Number(get('minute')) };
}

const berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Notnagel, falls ein Block einmal ohne Ticketformular kommt. */
function fallbackKey(
  moment: { date: string; hour: number; minute: number },
  title: string,
): string {
  const time = `${String(moment.hour).padStart(2, '0')}${String(moment.minute).padStart(2, '0')}`;
  const slug = title
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${moment.date}-${time}-${slug}`;
}

function absolute(href: string): string {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return href;
  }
}
