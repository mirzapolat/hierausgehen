/**
 * PRINTHOUSE München: Termine aus der JSON-API der Gästeliste.
 *
 * Die Seite printhousemunich.com/events (Squarespace) bettet nur ein iframe
 * `https://gaesteliste.89-167-86-84.sslip.io/website` ein. Dieses lädt alle
 * kommenden Termine in einem Rutsch über `/api/public/events`:
 *
 *   { events: [{ id, title, subtitle, genre, start, end (UTC-ISO), lineup[],
 *     priceFrom, sale: { status: 'onSale'|'soldOut'|'soon', phase, price,
 *     stages[], current, start? }, ticketUrl (vivenu) }], loadedAt, site }
 *
 * Kein Zeitraum-Parameter, keine Vergangenheit, keine eigene Detailseite je
 * Termin – der vivenu-Shop ist der einzige Link.
 */

import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso, TZ } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

export const SOURCE_ID = 'printhouse';
export const VENUE = 'Printhouse';
export const EVENTS_PAGE = 'https://www.printhousemunich.com/events';

interface RawSale {
  status?: string;
  phase?: string;
  price?: number;
  start?: string;
}

interface RawEvent {
  id?: string;
  title?: string;
  subtitle?: string;
  genre?: string;
  start?: string;
  end?: string;
  lineup?: unknown;
  priceFrom?: number;
  sale?: RawSale | null;
  ticketUrl?: string;
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** UTC-Zeitpunkt der API → ISO mit Berliner Offset (über `berlinIso`). */
function toBerlin(utc: string | undefined): string | undefined {
  if (!utc) return undefined;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return undefined;
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return berlinIso(`${p.year}-${p.month}-${p.day}`, Number(p.hour), Number(p.minute));
}

function euro(value: number | undefined): string | undefined {
  return typeof value === 'number' && value > 0 ? `${value} €` : undefined;
}

function availabilityOf(sale: RawSale | null | undefined): Availability {
  switch (sale?.status) {
    case 'onSale':
      return 'available';
    case 'soldOut':
      return 'soldout';
    case 'soon':
      return 'not_on_sale';
    default:
      return 'unknown';
  }
}

function availabilityLabelOf(sale: RawSale | null | undefined): string | undefined {
  if (sale?.status === 'soldOut') return 'Sold out';
  if (sale?.status === 'soon') {
    const start = toBerlin(sale.start);
    return start ? `On sale ${start.slice(8, 10)}.${start.slice(5, 7)}.${start.slice(0, 4)}` : 'On sale soon';
  }
  return undefined;
}

function notesOf(raw: RawEvent): string[] | undefined {
  const notes: string[] = [];
  const sale = raw.sale;
  const phase = clean(sale?.phase ?? '');
  const price = euro(sale?.price);
  if (sale?.status === 'onSale' && (phase || price)) {
    notes.push(phase && price ? `${phase}: ${price}` : `Ticket: ${phase || price}`);
  }
  const from = euro(raw.priceFrom);
  if (from) notes.push(`From: ${from}`);
  return notes.length ? notes : undefined;
}

function toEvent(raw: RawEvent): CalendarEvent | undefined {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const title = clean(raw.title ?? '');
  const start = toBerlin(raw.start);
  if (!id || !title || !start) return undefined;

  const lineup = Array.isArray(raw.lineup)
    ? raw.lineup.filter((x): x is string => typeof x === 'string').map(clean).filter(Boolean)
    : [];
  const ticketUrl = typeof raw.ticketUrl === 'string' && raw.ticketUrl.startsWith('http') ? raw.ticketUrl : undefined;
  const subtitle = clean(raw.subtitle ?? '');
  const genre = clean(raw.genre ?? '');

  return {
    id: `${SOURCE_ID}:${id}`,
    sourceId: SOURCE_ID,
    title,
    subtitle: subtitle || undefined,
    description: lineup.length ? lineup.join('\n') : undefined,
    category: genre || undefined,
    start,
    end: toBerlin(raw.end),
    allDay: false,
    venue: { name: VENUE },
    availability: availabilityOf(raw.sale),
    availabilityLabel: availabilityLabelOf(raw.sale),
    ticketUrl,
    url: ticketUrl ?? EVENTS_PAGE,
    notes: notesOf(raw),
  };
}

/** Antwort von `/api/public/events` → Termine. Ohne `events`-Liste: nicht erkannt. */
export function parseEvents(json: string): PageResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { events: [], skipped: 0, empty: false };
  }
  const list = (data as { events?: unknown } | null)?.events;
  if (!Array.isArray(list)) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;
  for (const item of list) {
    const event = item && typeof item === 'object' ? toEvent(item as RawEvent) : undefined;
    if (event) events.push(event);
    else skipped++;
  }
  return { events, skipped, empty: list.length === 0 };
}
