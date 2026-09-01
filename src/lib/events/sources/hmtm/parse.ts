import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';

/**
 * Parser für den Veranstaltungskalender der Hochschule für Musik und Theater
 * München.
 *
 * Die Liste kommt als JSON-Umschlag von `admin-ajax.php`
 * (`action=apply_event_filter`); die Termine stecken als HTML-Fragment im Feld
 * `html`, jeder als `div.eventlistitem`. Kennt der Zeitraum keinen Termin,
 * antwortet die Quelle ausdrücklich mit `success: false` und
 * „Nichts gefunden." – das ist eine gültige Auskunft und kein Fehler.
 *
 * Gattungen führt die Liste nicht mit. Sie stehen in der offenen
 * WordPress-REST-Schnittstelle als Term-IDs und mit Namen in der Filterleiste
 * der Seite – siehe `parseEventTypes` und `parseTypeAssignments`.
 */

const SOURCE_ID = 'hmtm';
const BASE = 'https://hmtm.de';

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke, die nicht verwertbar waren – für Monitoring/Logs. */
  skipped: number;
  /** Die Quelle meldet ausdrücklich, dass der Zeitraum keinen Termin hat. */
  empty: boolean;
  /** Es gäbe weitere Seiten – die Abfrage war zu klein bemessen. */
  hasMore: boolean;
}

export function parseMonthResponse(body: string): ParseResult {
  let envelope: { success?: unknown; html?: unknown; has_more?: unknown };
  try {
    envelope = JSON.parse(body) as typeof envelope;
  } catch {
    return { events: [], skipped: 0, empty: false, hasMore: false };
  }

  // „Nichts gefunden." – die Quelle sagt selbst, dass nichts ansteht.
  if (envelope.success === false) return { events: [], skipped: 0, empty: true, hasMore: false };

  const html = typeof envelope.html === 'string' ? envelope.html : '';
  return { ...parseListFragment(html), hasMore: envelope.has_more === true };
}

/** Nur das HTML-Fragment, ohne den JSON-Umschlag. */
export function parseListFragment(html: string): Omit<ParseResult, 'hasMore'> {
  const $ = cheerio.load(html);

  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('div.eventlistitem').each((_, element) => {
    const item = $(element) as unknown as Item;

    // Bewusst ohne `softenShouted`: die Hochschule schreibt ihre Titel in
    // normaler Schreibweise, Versalien sind hier Kürzel und Eigennamen
    // ("HMTM", "HSO", "(III)", "V01CES//B0D1EZ"). Glätten würde sie zerstören.
    const link = item.find('.eventlistitem__headline a').first();
    const title = clean(link.find('h2').first().text());
    const href = link.attr('href') ?? item.find('.eventlistitem__morelink').first().attr('href');
    const when = parseDateTime(clean(item.find('.eventlistitem__date').first().text()));

    if (!title || !href || !when) {
      skipped++;
      return;
    }

    const url = absolute(href);
    const ticket = readTicket(item);

    events.push({
      id: `${SOURCE_ID}:${eventKey(url)}`,
      sourceId: SOURCE_ID,
      title,
      subtitle: clean(item.find('.eventlistitem__subheadline').first().text()) || undefined,
      // Die Liste führt keinen Programmtext – lieber nichts als Erfundenes.
      // Gattung kommt aus `applyEventTypes`.
      start: berlinIso(when.date, when.hour, when.minute),
      allDay: when.allDay,
      // Die Hochschule spielt auch ausser Haus (Erding, Gasteig, Clubs) –
      // deshalb keine feste Stadt.
      venue: { name: readPlace(item) || 'HMTM' },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      url,
      notes: collectNotes(item),
    });
  });

  return { events, skipped, empty: false };
}

/**
 * Der Sicherheitsschlüssel der Filterabfrage. Er steht offen im Seitenkopf
 * (`var event_filter = {…}`) und wird von `admin-ajax.php` geprüft – ohne ihn
 * bleibt die Antwort leer.
 */
export function parseNonce(html: string): string | undefined {
  return html.match(/var event_filter\s*=\s*\{[^}]*?"nonce"\s*:\s*"([a-z0-9]+)"/i)?.[1];
}

/**
 * Gattungsnamen aus der Filterleiste: `data-type="240"` → „Wettbewerb".
 *
 * Bewusst von der Seite gelesen statt im Code gepflegt – eine neue Gattung
 * taucht damit von selbst auf, statt still zu fehlen.
 */
export function parseEventTypes(html: string): Map<number, string> {
  const $ = cheerio.load(html);
  const types = new Map<number, string>();

  $('.filterui__category_item[data-type]').each((_, element) => {
    const node = $(element);
    const id = Number(node.attr('data-type'));
    const name = clean(node.text());
    if (Number.isInteger(id) && name) types.set(id, name);
  });

  return types;
}

/**
 * `/wp-json/wp/v2/events` → Gattungs-Term-IDs je Veranstaltungsadresse.
 *
 * Die Schnittstelle gibt nur kommende Termine heraus; für vergangene Monate
 * bleibt die Zuordnung leer und `defaultCategory` greift.
 */
export function parseTypeAssignments(body: string): Map<string, number[]> {
  const assignments = new Map<string, number[]>();

  let posts: unknown;
  try {
    posts = JSON.parse(body);
  } catch {
    return assignments;
  }
  if (!Array.isArray(posts)) return assignments;

  for (const post of posts as Record<string, unknown>[]) {
    const link = typeof post.link === 'string' ? post.link : '';
    // WordPress benennt die Taxonomie `type` in der Ausgabe um, weil der
    // Schlüssel schon vergeben ist – beide Schreibweisen annehmen.
    const terms = post.Veranstaltungsart ?? post.type;
    if (!link || !Array.isArray(terms)) continue;
    assignments.set(urlKey(link), terms.filter((id): id is number => typeof id === 'number'));
  }

  return assignments;
}

/** Gattung an die Termine heften; ohne Zuordnung bleibt das Feld leer. */
export function applyEventTypes(
  events: CalendarEvent[],
  assignments: Map<string, number[]>,
  names: Map<number, string>,
): CalendarEvent[] {
  if (assignments.size === 0 || names.size === 0) return events;

  return events.map((event) => {
    const category = assignments
      .get(urlKey(event.url))
      ?.map((id) => names.get(id))
      .find(Boolean);
    return category ? { ...event, category } : event;
  });
}

/* ------------------------------------------------------------------ */

type Item = cheerio.Cheerio<never>;

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, 'märz': 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

interface When {
  date: string;
  hour: number;
  minute: number;
  allDay: boolean;
}

/** "Fr. 1. Mai '26 / 19:00 Uhr" – das Jahr steht zweistellig am Termin. */
function parseDateTime(label: string): When | undefined {
  const match = label.match(/(\d{1,2})\.\s*(\p{L}+)\s*'(\d{2})/u);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = MONTHS[match[2].toLocaleLowerCase('de-DE')];
  if (!month || day < 1 || day > 31) return undefined;

  const time = label.match(/(\d{1,2}):(\d{2})/);
  const hour = time ? Number(time[1]) : 0;
  const minute = time ? Number(time[2]) : 0;
  if (hour > 23 || minute > 59) return undefined;

  return {
    date: `${2000 + Number(match[3])}-${pad(month)}-${pad(day)}`,
    hour,
    minute,
    allDay: !time,
  };
}

/**
 * Die Spielstätte steht zweimal im Block (Kopfzeile und Inhalt). Der erste
 * Treffer reicht; leer bleibt sie, wenn die Quelle keine nennt.
 */
function readPlace(item: Item): string {
  return clean(item.find('.eventlistitem__place').first().text());
}

/**
 * Ticketlage aus drei unabhängigen Signalen: der Klasse
 * `eventlistitem--cancelled`, dem Ticketknopf und der Preiszeile.
 *
 * Ein abgesagter Termin ist im Datenmodell nicht vorgesehen; `not_on_sale`
 * kommt dem am nächsten, die Originalformulierung steht daneben.
 */
function readTicket(item: Item): { availability: Availability; label?: string; url?: string } {
  if (item.hasClass('eventlistitem--cancelled')) {
    return {
      availability: 'not_on_sale',
      label: clean(item.find('.eventlistitem__cancelledlabel').first().text()) || 'entfällt!',
    };
  }

  const button = item.find('.eventlistitem__ticketbutton').first();
  const href = button.attr('href');
  if (href) {
    return {
      availability: 'available',
      label: clean(button.find('span').last().text()) || undefined,
      url: absolute(href),
    };
  }

  // Ohne Knopf verkauft die Hochschule hier nicht: freier Eintritt, Abendkasse
  // oder Anmeldung. Die Preiszeile sagt, was gilt.
  const price = readPrice(item);
  if (price) return { availability: 'not_on_sale', label: price };

  return { availability: 'unknown' };
}

function readPrice(item: Item): string {
  return clean(item.find('.eventlistitem__price').first().text());
}

/**
 * Preise und die Hinweisfahne der Quelle („neue Uhrzeit", „verschoben",
 * „Saaländerung") als Zusatzinfos.
 */
function collectNotes(item: Item): string[] | undefined {
  const notes: string[] = [];

  const status = clean(item.find('.eventlistitem__status').first().text());
  if (status) notes.push(status);

  const price = readPrice(item);
  if (price) notes.push(price);

  return notes.length ? [...new Set(notes)] : undefined;
}

/**
 * Stabile ID: der Slug der Veranstaltungsseite. Jeder Termin hat bei der HMTM
 * eine eigene Seite, eine Nummer gibt die Liste nicht heraus.
 */
function eventKey(url: string): string {
  return urlKey(url).split('/').pop() || url;
}

/** Adressen vergleichen sich zuverlässiger ohne Schrägstrich am Ende. */
function urlKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
