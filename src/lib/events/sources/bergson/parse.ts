import * as cheerio from 'cheerio';
import type { CalendarEvent, Availability } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Programm des Bergson Kunstkraftwerks (`https://bergson.com/programm`).
 *
 * Die Seite rendert die gesamte angekündigte Spielzeit serverseitig als
 * `div.program-item` (in der Fixture 245 Termine von November 2026 bis Januar
 * 2028), ohne Blättern und ohne Zeitraum-Parameter. Jeder Block trägt seinen
 * Detaillink in `data-util-url-param` (`/event/<slug>`); der Slug ist die
 * stabile ID.
 *
 * Datum und Zeit stehen vollständig am Termin: "So. 08. Nov. 2026" und
 * "11.00 Uhr - 14.45 Uhr". Ort ist der Saal im Haus ("Elektra Tonquartier",
 * "Barbastelle") oder ein Gastspielort ("Kurhaus Bad Tölz").
 *
 * Gattung: die Schlagworte (`.hashtag`, auf der Seite "Moods") im Wortlaut,
 * mehrere mit Komma verbunden ("Klassik, Kind & Familie"). Brunch und
 * Kulinarik tragen keins – dann greift der Quellen-Fallback.
 *
 * Ticketlage aus zwei Signalen: der Hinweis `.program-extra` ("Ausverkauft",
 * "Nur noch wenige Tickets verfügbar") und der Knopf `a.program-ticket` in den
 * Ticketshop. Fehlt beides, bleibt sie `unknown`.
 */

const SOURCE_ID = 'bergson';
const BASE = 'https://bergson.com';
const HOUSE = 'Bergson Kunstkraftwerk';

/** Deutsche Monatskürzel, wie die Seite sie schreibt ("Nov.", "März", "Juni"). */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

/** "So. 08. Nov. 2026" */
const DATE = /(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\.?\s*(\d{4})/;
/** "10.00 Uhr - 15.00 Uhr" */
const TIME = /(\d{1,2})[.:](\d{2})/g;

export function parseProgrammePage(html: string): PageResult {
  const $ = cheerio.load(html);
  const list = $('[data-controller="filter-events"]');
  const blocks = $('div.program-item');

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  blocks.each((_, element) => {
    const event = parseItem($(element));
    if (!event) {
      skipped++;
      return;
    }
    if (seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  });

  return { events, skipped, empty: events.length === 0 && skipped === 0 && list.length > 0 };
}

/**
 * Langer Programmtext der Detailseite aus deren `ld+json`-Event. Doppelte
 * Leerzeichen trennen dort die Absätze.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  let description: string | undefined;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (description) return;
    try {
      const data = JSON.parse($(element).text()) as { '@type'?: string; description?: unknown };
      if (data['@type'] === 'Event' && typeof data.description === 'string') {
        description = data.description;
      }
    } catch {
      // Kaputtes JSON: dann eben ohne langen Text.
    }
  });

  if (!description) return undefined;
  const paragraphs = description
    .split(/\s{2,}|\n+/)
    .map(clean)
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : undefined;
}

/* ------------------------------------------------------------------ */

type Item = ReturnType<cheerio.CheerioAPI>;

function parseItem(item: Item): CalendarEvent | undefined {
  const path = item.attr('data-util-url-param') ?? '';
  const slug = path.match(/^\/event\/([^/?#]+)/)?.[1];
  const title = softenShouted(clean(item.find('.program-title').first().text()));
  const date = parseDate(clean(item.find('.event-date').first().text()));
  if (!slug || !title || !date) return undefined;

  const times = [...clean(item.find('.time').first().text()).matchAll(TIME)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const [startTime, endTime] = times;

  const start = startTime ? berlinIso(date, startTime[0], startTime[1]) : berlinIso(date);
  let end: string | undefined;
  if (startTime && endTime) {
    // Endet nach Mitternacht ("22.00 Uhr - 02.00 Uhr"): Folgetag.
    const overnight = endTime[0] * 60 + endTime[1] < startTime[0] * 60 + startTime[1];
    end = berlinIso(overnight ? nextDay(date) : date, endTime[0], endTime[1]);
  }

  const tags = item
    .find('.program-hashtags .hashtag')
    .map((_, el) => clean(cheerio.load(el).text()))
    .get()
    .filter(Boolean);

  const subtitle = clean(item.find('.program-subtitle').first().text()) || undefined;
  const location = clean(item.find('.location').first().text());

  const ticket = item.find('a.program-ticket').first();
  const ticketHref = ticket.attr('href');
  const ticketUrl = ticketHref ? new URL(ticketHref, BASE).toString() : undefined;
  const extra = clean(item.find('.program-extra').first().text());
  const { availability, availabilityLabel, note } = readAvailability(extra, Boolean(ticketUrl));

  const event: CalendarEvent = {
    id: `${SOURCE_ID}:${slug}`,
    sourceId: SOURCE_ID,
    title,
    start,
    allDay: !startTime,
    venue: { name: location || HOUSE },
    availability,
    url: new URL(path, BASE).toString(),
  };
  if (subtitle) event.subtitle = subtitle;
  if (tags.length > 0) event.category = tags.join(', ');
  if (end) event.end = end;
  if (availabilityLabel) event.availabilityLabel = availabilityLabel;
  if (ticketUrl) event.ticketUrl = ticketUrl;
  if (note) event.notes = [note];
  return event;
}

function readAvailability(
  extra: string,
  hasTicketLink: boolean,
): { availability: Availability; availabilityLabel?: string; note?: string } {
  if (/ausverkauft/i.test(extra)) return { availability: 'soldout', availabilityLabel: extra };
  if (/abgesagt|entfällt/i.test(extra)) return { availability: 'not_on_sale', availabilityLabel: 'Abgesagt' };
  if (/wenige|restkarten|letzte/i.test(extra)) return { availability: 'limited', availabilityLabel: extra };
  // Unbekannter Hinweis: nicht deuten, aber auch nicht verlieren.
  const note = extra || undefined;
  return { availability: hasTicketLink ? 'available' : 'unknown', note };
}

function parseDate(text: string): string | undefined {
  const match = text.match(DATE);
  if (!match) return undefined;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
