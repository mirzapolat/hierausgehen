import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Programm der Kulturetage Oldenburg (`/p_ogramm_12-.html`).
 *
 * Die Seite führt das ganze veröffentlichte Programm in einer Antwort, jeder
 * Termin ein `div.veranst_bild` in `.veranstaltung_bild`. Der Block kennt
 * Datum, Rubrik, Titel, Ticketlink und Hinweis („ausverkauft“,
 * „Ticket-Alarm“) – aber **keine Uhrzeit** und keinen Saal. Beides steht erst
 * auf der Seite der Produktion, zusammen mit Untertitel, Programmtext und
 * Preis; `parseProductionPage` liest sie.
 *
 * Das Datum trägt nur dann ein Jahr, wenn es nicht das laufende ist
 * („01.10.“ gegen „08.01.2027“). Deshalb braucht der Parser den heutigen Tag.
 */

const SOURCE_ID = 'kulturetage';
const BASE = 'https://www.kulturetage.de';
const HOUSE = 'Kulturetage';

export function parseProgramme(html: string, today: string): PageResult {
  const $ = cheerio.load(html);

  const list = $('.veranstaltung_bild');
  if (list.length === 0) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  list.find('.veranst_bild').each((_, element) => {
    const block = $(element);

    // Die Anker-ID gehört zum Termin, nicht zur Produktion.
    const id = block.find('a.v_anker').attr('id')?.match(/^hm(\d+)$/)?.[1];
    const title = clean(block.find('.interpret').first().text());
    const date = parseListDate(clean(block.find('.info .datum span').first().text()), today);
    const href = block.find('.infos > a.button[href]').first().attr('href');

    if (!id || !title || !date || !href) {
      skipped++;
      return;
    }

    const hint = clean(block.find('.hinweis').first().text());
    const ticketHref = block.find('.ext_text a[href]').first().attr('href')?.trim();
    const ticket = readTicket(hint, ticketHref);

    events.push({
      id: `${SOURCE_ID}:${id}`,
      sourceId: SOURCE_ID,
      title,
      category: clean(block.find('.info .rubrik').first().text()) || undefined,
      // Ganztägig, bis die Seite der Produktion die Uhrzeit liefert.
      start: berlinIso(date, 0, 0),
      allDay: true,
      venue: { name: HOUSE },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      url: productionUrl(href),
      notes: ticket.note ? [ticket.note] : undefined,
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/** Was die Seite einer Produktion über ihre Termine hinaus weiss. */
export interface ProductionDetail {
  subtitle?: string;
  description?: string;
  /** Saal oder, auf Tour, der fremde Ort. */
  room?: string;
  price?: string;
  /**
   * Uhrzeiten je Termin, in der Reihenfolge der Seite. `id` ist die
   * Termin-ID der Liste – die Seite nennt sie nur bei Terminen mit
   * Ticketknopf (`exttext835197` ↔ `hm835197`).
   */
  dates: { id?: string; month: number; day: number; year?: number; time?: string }[];
}

export function parseProductionPage(html: string): ProductionDetail | undefined {
  const $ = cheerio.load(html.replace(/<\s*br\s*\/?\s*>/gi, '\n'));
  const page = $('.veranst').first();
  if (page.length === 0) return undefined;

  const dates: ProductionDetail['dates'] = [];
  page.find('.termine .termin').each((_, element) => {
    const termin = $(element);
    // Im Datumsfeld stecken auch Marker und Ticketknopf – nur der Anfang zählt.
    const match = clean(termin.find('.datum').first().text()).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
    if (!match) return;

    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : undefined;
    dates.push({
      id: termin.find('.ext_text[id]').first().attr('id')?.match(/^exttext(\d+)$/)?.[1],
      day: Number(match[1]),
      month: Number(match[2]),
      year,
      time: parseTime(clean(termin.find('.zeit > span').first().text())),
    });
  });

  const info = page.find('.termine .info').first();
  const room = clean(info.find('span').first().text());
  const price = clean(info.find('span').eq(1).text());

  const paragraphs = page
    .find('.infotext')
    .first()
    .text()
    .split(/\n\s*\n|\n/)
    .map(clean)
    .filter(Boolean);

  return {
    subtitle: clean(page.find('.titel h2').first().text()) || undefined,
    description: paragraphs.length ? paragraphs.join('\n\n') : undefined,
    room: room || undefined,
    price: price || undefined,
    dates,
  };
}

/**
 * Uhrzeit, Saal, Untertitel, Text und Preis der Produktion in den Termin.
 *
 * Die Uhrzeit gehört zu dem Block mit derselben Termin-ID; ohne ID zu dem
 * Block desselben Tages. Stehen an einem Tag mehrere Vorstellungen, zählt
 * die Reihenfolge – Liste und Produktionsseite führen sie beide aufsteigend.
 * `ordinal` sagt, die wievielte Vorstellung des Tages dieser Termin in der
 * Liste ist.
 */
export function mergeProduction(
  event: CalendarEvent,
  detail: ProductionDetail,
  ordinal = 0,
): CalendarEvent {
  const next: CalendarEvent = { ...event };
  const [year, month, day] = event.start.slice(0, 10).split('-').map(Number);
  const termId = event.id.slice(`${SOURCE_ID}:`.length);

  const sameDay = detail.dates.filter(
    (entry) => entry.day === day && entry.month === month && (entry.year === undefined || entry.year === year),
  );
  const entry = detail.dates.find((candidate) => candidate.id === termId) ?? sameDay[ordinal];
  const time = entry?.time;
  if (time && event.allDay) {
    const [hour, minute] = time.split(':').map(Number);
    next.start = berlinIso(event.start.slice(0, 10), hour, minute);
    next.allDay = false;
  }

  if (detail.room) next.venue = { name: detail.room };
  if (detail.subtitle && !event.subtitle) next.subtitle = detail.subtitle;
  if (detail.description && !event.description) next.description = detail.description;
  if (detail.price) next.notes = [...(event.notes ?? []), `Eintritt ${detail.price}`];

  return next;
}

/**
 * Die wievielte Vorstellung ihres Tages ein Termin ist – je Produktion, in
 * der Reihenfolge der Liste. Für `mergeProduction`.
 */
export function dayOrdinals(events: CalendarEvent[]): Map<string, number> {
  const seen = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const event of events) {
    const key = `${event.url}|${event.start.slice(0, 10)}`;
    const index = seen.get(key) ?? 0;
    ordinals.set(event.id, index);
    seen.set(key, index + 1);
  }
  return ordinals;
}

/* ------------------------------------------------------------------ */

/**
 * „ausverkauft“ und „Ticket-Alarm“ (in jeder Schreibweise) sind Ticketlage;
 * alle anderen Hinweise – „Gastspiel Theater k“, „Kulturetage auf Tour“,
 * „Eintritt frei - Spende erbeten“ – sind Hinweise zum Abend.
 */
function readTicket(
  hint: string,
  href: string | undefined,
): { availability: Availability; label?: string; url?: string; note?: string } {
  const url = href && /^https?:\/\//.test(href) ? href : undefined;

  if (/ausverkauft/i.test(hint)) return { availability: 'soldout', label: hint, url };
  if (/ticket-?alarm/i.test(hint)) return { availability: 'limited', label: 'Ticket-Alarm', url };

  return {
    availability: url ? 'available' : 'unknown',
    url,
    note: hint || undefined,
  };
}

/** „01.10.“ (laufendes Jahr) oder „08.01.2027“. */
function parseListDate(label: string, today: string): string | undefined {
  const match = label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;

  let year = match[3] ? Number(match[3]) : Number(today.slice(0, 4));
  const date = () => `${year}-${pad(month)}-${pad(day)}`;
  // Ohne Jahr gilt das laufende. Liegt der Tag damit weit zurück, meint die
  // Seite um den Jahreswechsel schon das nächste – Vergangenes führt sie nicht.
  if (!match[3] && date() < shiftMonths(today, -2)) year += 1;
  return date();
}

function parseTime(label: string): string | undefined {
  const match = label.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * „till_reiners_12---385717-1.html“: die Ziffer am Ende ist die Position in
 * der Liste und wandert mit ihr. Die Seite der Produktion ohne sie bleibt.
 */
function productionUrl(href: string): string {
  const path = href.trim().replace(/^\//, '').replace(/(---\d+)-\d+\.html$/, '$1.html');
  return path.startsWith('http') ? path : `${BASE}/${path}`;
}

function shiftMonths(day: string, amount: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + amount);
  return d.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
