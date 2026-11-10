import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Lieber Scholli (Club, Kunst- und Kulturraum) verkauft über einen ticket.io-Shop. Die Tabellenansicht
 * (`/?view=table`) listet alle Termine im Vorverkauf auf einer Seite; jede
 * Zeile trägt ein ld+json `MusicEvent` mit Beginn, Ende, Ort und Angebot.
 * Die Shopseiten der Termine stehen hinter einer Sicherheitsprüfung und werden
 * deshalb nicht gelesen.
 */

export const SOURCE_ID = 'lieberscholli';
export const BASE = 'https://lieberscholli.ticket.io';

/** ticket.io kürzt die Beschreibung im ld+json auf genau so viele Zeichen. */
const TEASER_LIMIT = 250;

interface LdEvent {
  '@type'?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  eventStatus?: string;
  description?: string;
  url?: string;
  location?: { name?: string };
  offers?: { availability?: string; url?: string } | { availability?: string; url?: string }[];
}

export function parseEventTable(html: string): PageResult {
  const $ = cheerio.load(html);
  const table = $('table.table-events');
  if (table.length === 0) return { events: [], skipped: 0, empty: false };

  const rows = table.find('tbody > tr');
  const events: CalendarEvent[] = [];
  let skipped = 0;

  rows.each((_, row) => {
    const $row = $(row);
    if ($row.find('td.dataTables_empty').length > 0) return;
    const event = parseRow($row);
    if (event) events.push(event);
    else skipped += 1;
  });

  return { events, skipped, empty: events.length === 0 && skipped === 0 };
}

function parseRow($row: cheerio.Cheerio<AnyNode>): CalendarEvent | null {
  const ld = readLd($row.find('script[type="application/ld+json"]').first().text());
  const href = $row.find('a.a-eventlink').attr('href') ?? '';
  const slug = /^\/?([A-Za-z0-9]+)\//.exec(href)?.[1];
  const start = ld?.startDate ? toBerlin(ld.startDate) : undefined;
  const title = ld?.name ? softenShouted(clean(ld.name)) : clean($row.find('a.a-eventlink').text());
  if (!slug || !start || !title) return null;

  const offer = Array.isArray(ld?.offers) ? ld?.offers[0] : ld?.offers;
  const url = `${BASE}/${slug}/`;
  const { availability, availabilityLabel } = readAvailability(
    ld?.eventStatus,
    offer?.availability,
    $row.find('.btn-toshop'),
    clean($row.text()),
  );

  const price = clean($row.find('td.tio-overview-tickets-from').first().text());
  const priceMatch = /^Tickets ab\s+(.+)$/i.exec(price);
  const end = ld?.endDate ? toBerlin(ld.endDate) : undefined;

  return {
    id: `${SOURCE_ID}:${slug}`,
    sourceId: SOURCE_ID,
    title,
    description: teaser(ld?.description),
    start,
    ...(end && end > start ? { end } : {}),
    allDay: false,
    // ld+json nennt den Ort "lieberscholli - space for art, club and culture".
    venue: { name: 'Lieber Scholli' },
    availability,
    ...(availabilityLabel ? { availabilityLabel } : {}),
    ticketUrl: url,
    url,
    ...(priceMatch ? { notes: [`Tickets ab: ${priceMatch[1]}`] } : {}),
  };
}

function readLd(text: string): LdEvent | undefined {
  if (!text.trim()) return undefined;
  try {
    const data = JSON.parse(text) as LdEvent;
    return data && typeof data === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

/** `2026-11-11T22:00:00+01:00` → Wandzeit in Berlin über `berlinIso`. */
function toBerlin(value: string): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  return m ? berlinIso(m[1], Number(m[2]), Number(m[3])) : undefined;
}

function teaser(raw: string | undefined): string | undefined {
  const text = clean(raw ?? '');
  if (!text || /^n\/?a$/i.test(text)) return undefined;
  if (text.length < TEASER_LIMIT) return text;
  const cut = text.slice(0, text.lastIndexOf(' ')).replace(/[\s,;:–-]+$/, '');
  return `${cut || text} …`;
}

/**
 * Zwei Signale: `offers.availability`/`eventStatus` aus dem ld+json und der
 * Kaufen-Knopf der Zeile. Ohne Knopf meldet die Zeile ggf. „Online-Vorverkauf
 * nicht möglich“. Ein fehlender oder deaktivierter Knopf bzw. ein
 * „ausverkauft“ im Knopf schlägt ein `InStock`.
 */
function readAvailability(
  status: string | undefined,
  offerAvailability: string | undefined,
  button: cheerio.Cheerio<AnyNode>,
  rowText: string,
): { availability: Availability; availabilityLabel?: string } {
  const statusKey = (status ?? '').split('/').pop() ?? '';
  if (statusKey === 'EventCancelled') return { availability: 'not_on_sale', availabilityLabel: 'Abgesagt' };
  if (statusKey === 'EventPostponed') return { availability: 'not_on_sale', availabilityLabel: 'Verschoben' };

  const buttonText = clean(button.text()).toLowerCase();
  const buttonClass = button.attr('class') ?? '';
  if (/ausverkauft|sold\s*out/.test(buttonText)) return { availability: 'soldout' };

  const key = (offerAvailability ?? '').split('/').pop() ?? '';
  let availability: Availability;
  switch (key) {
    case 'InStock':
    case 'OnlineOnly':
      availability = 'available';
      break;
    case 'LimitedAvailability':
      availability = 'limited';
      break;
    case 'SoldOut':
    case 'OutOfStock':
      availability = 'soldout';
      break;
    case 'PreOrder':
    case 'PreSale':
    case 'Discontinued':
      availability = 'not_on_sale';
      break;
    default:
      availability = 'unknown';
  }
  if (button.length === 0 && /Online-Vorverkauf nicht möglich/i.test(rowText)) {
    return { availability: 'not_on_sale', availabilityLabel: 'Online-Vorverkauf nicht möglich' };
  }
  if (availability === 'available' && (button.length === 0 || /\bdisabled\b/.test(buttonClass))) {
    return { availability: 'unknown' };
  }
  return { availability };
}
