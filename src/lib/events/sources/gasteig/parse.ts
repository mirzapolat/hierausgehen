import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für den Gasteig (HP8 und Motorama).
 *
 * Zwei Antworten der Quelle werden hier verarbeitet:
 *
 * 1. Das Teaser-Fragment der Filterliste (`admin-ajax.php?action=load_teasers`).
 *    Es liefert je Termin – nicht je Produktion – Titel, Untertitel, Beginn,
 *    Link und die vollständigen Schlagworte der Seite (Kategorie, Genre, Saal,
 *    Haus, Hinweise wie „kinder-jugend"). Nur daraus ergibt sich, welche
 *    Termine überhaupt zu dieser Quelle gehören.
 *
 * 2. Der schema.org-Feed (`/wp-json/api/events/upcoming`). Er kennt dieselben
 *    Termine über die Adresse, aber zusätzlich Kurztext, Endzeit, Preis,
 *    Ticketlink und Veranstaltende. Er reicht nur in die Zukunft; für
 *    vergangene Termine bleiben diese Felder leer.
 *
 * Die Klassennamen der Seite sind gehasht und wechseln mit jedem Build –
 * gegriffen wird deshalb ausschliesslich über `data-`Attribute und Tags.
 */

const SOURCE_ID = 'gasteig';
const HOST = 'www.gasteig.de';
const BASE = `https://${HOST}`;

/**
 * Schlagworte, die einen Termin aus dieser Quelle ausschliessen.
 * Erste Ebene ist die Gruppe im Filter-Link (`?categories=…`, `?general=…`).
 */
const EXCLUDED_TAGS = new Set(['categories:kreativ', 'general:kinder-jugend']);

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke ohne Titel, Datum oder ID – für Monitoring/Logs. */
  skipped: number;
  /** Blöcke, die wegen eines ausgeschlossenen Schlagworts wegfallen. */
  excluded: number;
  /** Die Antwort war leer – bei dieser Quelle: kein Termin im Zeitraum. */
  empty: boolean;
  /** Gefundene Teaser-Blöcke, unabhängig davon, ob sie verwertbar waren. */
  blocks: number;
}

/** Angaben aus dem schema.org-Feed, nach Termin-Adresse. */
export type Enrichment = Map<string, FeedEntry>;

export interface FeedEntry {
  description?: string;
  end?: string;
  venueName?: string;
  availability: Availability;
  ticketUrl?: string;
  notes: string[];
}

/**
 * Ein Teaser-Fragment lesen.
 *
 * Eine leere Antwort ist die Auskunft „kein Termin im Zeitraum" – so meldet
 * die Quelle sowohl einen leeren Monat als auch einen Zeitraum jenseits des
 * Vorverkaufs. Antwortet sie dagegen mit Inhalt ohne einen einzigen Teaser,
 * hat sich der Aufbau geändert; das erkennt der Aufrufer an `blocks === 0`
 * bei `empty === false`.
 */
export function parseTeaserFragment(html: string): ParseResult {
  if (clean(html) === '') {
    return { events: [], skipped: 0, excluded: 0, empty: true, blocks: 0 };
  }

  const $ = cheerio.load(html);
  const teasers = $('[data-component="teaser"]');

  const events: CalendarEvent[] = [];
  let skipped = 0;
  let excluded = 0;

  teasers.each((_, element) => {
    const teaser = $(element) as unknown as Teaser;

    const id = teaser.attr('data-id');
    const href = teaser.children('a[href]').first().attr('href');
    const datetime = teaser.find('time[datetime]').first().attr('datetime');
    const heading = teaser.find('h3').first();
    const subtitle = clean(heading.find('span').first().text());
    const title = clean(heading.clone().find('span').remove().end().text());

    if (!id || !href || !datetime || !title) {
      skipped++;
      return;
    }

    const tags = readTags($, teaser);
    if (tags.some((tag) => EXCLUDED_TAGS.has(`${tag.group}:${tag.value}`))) {
      excluded++;
      return;
    }

    const moment = parseDateTime(datetime);
    if (!moment) {
      skipped++;
      return;
    }

    const room = labelOf(tags, 'room');
    const house = labelOf(tags, 'locations');

    events.push({
      id: `${SOURCE_ID}:${id}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      subtitle: subtitle ? softenShouted(subtitle) : undefined,
      // Kurztext und Ticketlage kommen aus dem Feed, nicht aus dem Teaser.
      category: categoryOf(tags),
      start: berlinIso(moment.date, moment.hour, moment.minute),
      allDay: moment.allDay,
      // Keine Stadt hart setzen: der Gasteig führt auch auswärtige Termine.
      venue: { name: [room, house].filter(Boolean).join(', ') },
      availability: 'unknown',
      url: absolute(href),
      notes: teaserNotes(teaser, tags),
    });
  });

  return {
    events,
    skipped,
    excluded,
    empty: false,
    blocks: teasers.length,
  };
}

/**
 * Den schema.org-Feed auf die Angaben eindampfen, die der Teaser nicht hat.
 * Schlüssel ist die Termin-Adresse ohne abschliessenden Schrägstrich.
 */
export function parseUpcomingFeed(json: string): Enrichment {
  const map: Enrichment = new Map();

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return map;
  }

  const events = (payload as { events?: unknown })?.events;
  if (!Array.isArray(events)) return map;

  for (const raw of events) {
    const entry = raw as FeedEvent;
    if (typeof entry?.url !== 'string') continue;

    const offer = pickOffer(entry.offers);
    const notes: string[] = [];

    const price = priceNote(offer?.price);
    if (price) notes.push(price);

    const organizer = clean(entry.organizer?.name ?? '');
    if (organizer && organizer !== 'Gasteig München GmbH') {
      notes.push(`Veranstaltet von ${organizer}`);
    }

    map.set(normalizeUrl(entry.url), {
      description: clean(entry.description ?? '') || undefined,
      end: sameOccasionEnd(entry.startDate, entry.endDate),
      venueName: clean(entry.location?.name ?? '') || undefined,
      availability: availabilityOf(offer?.availability),
      ticketUrl: externalTicketUrl(offer?.url),
      notes,
    });
  }

  return map;
}

/**
 * Termine mit den Feed-Angaben zusammenführen. Fehlt ein Eintrag – bei
 * vergangenen Terminen der Normalfall –, bleibt der Termin unverändert.
 */
export function applyEnrichment(events: CalendarEvent[], feed: Enrichment): CalendarEvent[] {
  return events.map((event) => {
    const entry = feed.get(normalizeUrl(event.url));
    if (!entry) return event;

    const notes = [...(event.notes ?? []), ...entry.notes];

    return {
      ...event,
      description: entry.description ?? event.description,
      end: entry.end ?? event.end,
      venue: { ...event.venue, name: event.venue.name || entry.venueName || '' },
      availability: entry.availability,
      ticketUrl: entry.ticketUrl,
      notes: notes.length ? notes : undefined,
    };
  });
}

/* ------------------------------------------------------------------ */

interface FeedEvent {
  url?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?: { name?: string };
  organizer?: { name?: string };
  offers?: FeedOffer[];
}

interface FeedOffer {
  availability?: string;
  price?: string | number;
  url?: string;
}

type Teaser = cheerio.Cheerio<never>;

interface Tag {
  /** Gruppe im Filter-Link: categories, specific, general, room, locations, institute. */
  group: string;
  value: string;
  label: string;
}

/** Schlagworte eines Teasers aus den Filter-Links darunter lesen. */
function readTags($: cheerio.CheerioAPI, teaser: Teaser): Tag[] {
  const tags: Tag[] = [];

  teaser.find('[data-component="tags"] a[href]').each((_, link) => {
    const href = $(link).attr('href') ?? '';
    const match = href.match(/[?&]([a-z_]+)=([^&#"]+)/);
    if (!match) return;
    tags.push({ group: match[1], value: match[2], label: clean($(link).text()) });
  });

  return tags;
}

function labelOf(tags: Tag[], group: string): string | undefined {
  return tags.find((tag) => tag.group === group)?.label || undefined;
}

/**
 * Ein Termin trägt oft mehrere Gattungen, und die Reihenfolge der Seite
 * meint es nicht immer wie wir: „Star Wars in Concert" steht als
 * `film,musik` da. Weil diese Quelle das Musik- und Tanzprogramm des Hauses
 * abbildet, gewinnt die dafür einschlägige Gattung – sonst die erste.
 */
function categoryOf(tags: Tag[]): string | undefined {
  const categories = tags.filter((tag) => tag.group === 'categories');
  const leading = categories.find((tag) => tag.value === 'musik' || tag.value === 'tanz');
  return (leading ?? categories[0])?.label || undefined;
}

/**
 * Hinweise, die schon im Teaser stehen: Absage, Verschiebung und das Genre
 * („Klassik", „Jazz"). Die Gattung selbst steht in `category`.
 */
function teaserNotes(teaser: Teaser, tags: Tag[]): string[] | undefined {
  const notes: string[] = [];

  if (clean(teaser.attr('data-canceled') ?? '')) notes.push('Abgesagt');
  if (clean(teaser.attr('data-postponed') ?? '')) notes.push('Verschoben');

  for (const tag of tags) {
    if (tag.group === 'specific' && tag.label) notes.push(tag.label);
  }

  return notes.length ? notes : undefined;
}

/** `datetime="2026-11-01 20:00"` – Münchner Lokalzeit, Uhrzeit optional. */
function parseDateTime(
  value: string,
): { date: string; hour: number; minute: number; allDay: boolean } | undefined {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return undefined;

  return {
    date: match[1],
    hour: match[2] ? Number(match[2]) : 0,
    minute: match[3] ? Number(match[3]) : 0,
    allDay: match[2] === undefined,
  };
}

/**
 * Von mehreren Angeboten das aussagekräftigste nehmen: eines mit Ticketlink
 * schlägt eines ohne, sonst das erste.
 */
function pickOffer(offers: FeedOffer[] | undefined): FeedOffer | undefined {
  if (!Array.isArray(offers) || offers.length === 0) return undefined;
  return offers.find((offer) => externalTicketUrl(offer.url)) ?? offers[0];
}

/** schema.org-Verfügbarkeit auf unsere grobe Ticketlage abbilden. */
function availabilityOf(value: string | undefined): Availability {
  const name = (value ?? '').split('/').pop()?.toLowerCase();
  switch (name) {
    case 'instock':
    case 'onlineonly':
    case 'instoreonly':
      return 'available';
    case 'limitedavailability':
      return 'limited';
    case 'soldout':
    case 'outofstock':
    case 'discontinued':
      return 'soldout';
    case 'preorder':
    case 'presale':
    case 'backorder':
      return 'not_on_sale';
    default:
      return 'unknown';
  }
}

/**
 * Der Feed setzt als Angebots-Adresse oft die Veranstaltungsseite selbst.
 * Als Ticketlink taugt nur, was tatsächlich in einen fremden Shop führt.
 */
function externalTicketUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host === HOST ? undefined : url;
  } catch {
    return undefined;
  }
}

/**
 * Endzeit nur übernehmen, wenn sie zum selben Termin gehört. Dauerformate
 * („Rallye durch den Gasteig") tragen ein Ende Monate später – das wäre im
 * Kalender ein Balken über den halben Spielplan.
 */
function sameOccasionEnd(start: string | undefined, end: string | undefined): string | undefined {
  if (!start || !end) return undefined;

  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  if (to <= from || to - from > 24 * 60 * 60 * 1000) return undefined;

  return end;
}

/** "74.30" → "Preis ab 74,30 €", "0" → "Eintritt frei". */
function priceNote(price: string | number | undefined): string | undefined {
  if (price === undefined || price === null || price === '') return undefined;

  const value = Number(price);
  if (!Number.isFinite(value)) return undefined;
  if (value === 0) return 'Eintritt frei';

  // Glatte Beträge ohne Nachkommastellen, krumme immer mit zweien:
  // "31 €", aber "74,30 €" statt "74,3 €".
  const decimals = Number.isInteger(value) ? 0 : 2;
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

  return `Preis ab ${formatted} €`;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url, BASE);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function absolute(href: string): string {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return href;
  }
}
