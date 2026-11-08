import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { lookupCategory } from '../../categories.ts';
import { berlinDay, berlinIso, TZ } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für die Termin-API der Tonhalle Düsseldorf.
 *
 * Die Seite ist eine Inertia-App; die Termine lädt sie nach:
 *
 * - `/api/events?type=dynamic&size=…&from=…` – je Veranstaltung Titel,
 *   Untertitel, Link, Ticketlink und die Termine als UTC-Zeitpunkte
 *   (`isoDateStrings`) mit der Vorstellungsnummer an derselben Stelle
 *   (`projectEventEvisIds`).
 * - `/api/events/metadata` – die Ticketlage je Vorstellungsnummer.
 *
 * Saal, Reihe, Veranstalter und Programmtext stehen erst auf der Seite der
 * Veranstaltung, im Inertia-JSON (`script[data-page="app"]`).
 */

const SOURCE_ID = 'tonhalle';
const BASE = 'https://www.tonhalle.de';

export interface EventsResponse {
  total?: number;
  nextOffset?: number | null;
  events?: ApiEvent[];
}

interface ApiEvent {
  id?: string;
  title?: string;
  subTitle?: string | null;
  link?: string;
  ticketLink?: string | null;
  isoDateStrings?: string[];
  projectEventEvisIds?: string[];
}

export interface Metadata {
  evisId: string;
  state: string;
}

/** Was die Ticketlage je Zustand heisst – derselbe Wortlaut wie auf der Seite. */
const STATES: Record<string, { availability: Availability; label: string }> = {
  LIMITED: { availability: 'limited', label: 'Es gibt nur noch wenige Karten!' },
  SOLD_OUT: { availability: 'soldout', label: 'Ausverkauft!' },
  // Abgesagt und verschoben kennt das Datenmodell nicht; Karten gibt es
  // dafür über die Quelle nicht mehr.
  CANCELLED: { availability: 'not_on_sale', label: 'Abgesagt!' },
  POSTPONED: { availability: 'not_on_sale', label: 'Verschoben!' },
};

/**
 * Eine Antwortseite der API in Termine – je Datum einer, nicht je
 * Veranstaltung. `metadata` darf fehlen; dann trägt nur der Ticketlink.
 */
export function parseEvents(json: string, metadata: Metadata[] = []): PageResult {
  const data = readJson<EventsResponse>(json);
  if (!data || !Array.isArray(data.events)) return { events: [], skipped: 0, empty: false };

  const states = new Map(metadata.map((entry) => [entry.evisId, entry.state]));
  const events: CalendarEvent[] = [];
  let skipped = 0;

  for (const item of data.events) {
    const title = clean(item.title ?? '');
    const dates = item.isoDateStrings ?? [];
    const ids = item.projectEventEvisIds ?? [];
    const link = item.link;
    if (!title || !link || dates.length === 0 || ids.length !== dates.length) {
      skipped++;
      continue;
    }

    dates.forEach((iso, index) => {
      const start = berlinStart(iso);
      if (!start) {
        skipped++;
        return;
      }
      const evisId = ids[index];
      const ticket = readTicket(states.get(evisId), item.ticketLink ?? undefined);
      events.push({
        id: `${SOURCE_ID}:${evisId.replace(/:/g, '-')}`,
        sourceId: SOURCE_ID,
        title,
        subtitle: clean(item.subTitle ?? '') || undefined,
        start,
        allDay: false,
        // Der Saal steht erst auf der Veranstaltungsseite.
        venue: { name: 'Tonhalle Düsseldorf' },
        availability: ticket.availability,
        availabilityLabel: ticket.label,
        // Der Ticketlink gehört zur ersten Vorstellung; für weitere Termine
        // führt er in den falschen Abend.
        ticketUrl: index === 0 ? ticket.url : undefined,
        url: absolute(link),
      });
    });
  }

  return { events, skipped, empty: data.events.length === 0 };
}

export function parseMetadata(json: string): Metadata[] {
  const data = readJson<unknown>(json);
  if (!Array.isArray(data)) return [];
  return data.filter(
    (entry): entry is Metadata =>
      typeof entry === 'object' && entry !== null && typeof entry.evisId === 'string' && typeof entry.state === 'string',
  );
}

function readTicket(
  state: string | undefined,
  ticketUrl: string | undefined,
): { availability: Availability; label?: string; url?: string } {
  const known = state ? STATES[state] : undefined;
  if (known) return { ...known, url: known.availability === 'limited' ? ticketUrl : undefined };
  // NORMAL oder nicht im Webshop (Gastveranstalter mit eigenem Verkauf):
  // dann zählt, ob die Seite einen Kaufen-Knopf zeigt.
  if (ticketUrl) return { availability: 'available', url: ticketUrl };
  return { availability: 'unknown' };
}

/* ------------------------------------------------------------------ */
/* Veranstaltungsseite                                                 */

export interface TonhalleDetail extends EventDetail {
  /** Saal („Mendelssohn-Saal", „Rotunde/Foyer"). */
  venue?: string;
  /** Eigene Seite je Vorstellung, nach Vorstellungsnummer. */
  urls: Record<string, string>;
}

interface EventPage {
  props?: {
    event?: {
      description?: string | null;
      iconTextList?: { icon?: string; text?: string | null }[];
      dates?: { evisId?: string; url?: string }[];
    };
  };
}

/**
 * Das Inertia-JSON der Veranstaltungsseite. Die Kurzangaben stehen dort als
 * Liste mit Symbol: `marker` der Saal, `price-flag` die Reihe („Sternzeichen
 * –\nDie Düsseldorfer Symphoniker im Konzert"), `wand` der Veranstalter,
 * `alarm` Uhrzeiten („19:00 Star-Talk\n20:00 Konzertbeginn"), `warning` ein
 * Hinweis.
 */
export function parseEventPage(html: string): TonhalleDetail | undefined {
  const raw = html.match(/<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  const event = raw ? readJson<EventPage>(raw)?.props?.event : undefined;
  if (!event) return undefined;

  const notes: string[] = [];
  let venue: string | undefined;
  let category: string | undefined;
  for (const { icon, text } of event.iconTextList ?? []) {
    const value = clean(text ?? '');
    if (!value) continue;
    switch (icon) {
      case 'marker':
        venue = value;
        break;
      case 'price-flag': {
        // „Führungen/Guided Tours – durch die Tonhalle": der Name der Reihe
        // steht vor dem Gedankenstrich.
        const series = clean(value.split(/\s+–\s*/)[0]);
        notes.push(`Reihe: ${series}`);
        // Meist ein Eigenname („Sternzeichen", „Komet"); nur wenn er eine
        // Art benennt, taugt er als Veranstaltungsart.
        if (series.split('/').some((part) => lookupCategory(part))) category = series;
        break;
      }
      case 'wand':
        notes.push(value.replace(/^Veranstalter\s*:\s*/i, 'Veranstalter: '));
        break;
      case 'alarm':
        // Der Beginn steht schon am Termin; Vorprogramme werden zur Zeile.
        for (const [, time, label] of (text ?? '').matchAll(/(\d{1,2}:\d{2})\s+([^\n]+)/g)) {
          if (!/beginn/i.test(label)) notes.push(`${clean(label)}: ${time}`);
        }
        break;
      default:
        notes.push(value);
    }
  }

  const urls: Record<string, string> = {};
  for (const date of event.dates ?? []) {
    if (date.evisId && date.url) urls[date.evisId] = absolute(date.url);
  }

  const description = (event.description ?? '')
    .split(/\n{2,}/)
    .map(clean)
    .filter(Boolean)
    .join('\n\n');

  return {
    description: description || undefined,
    category,
    notes: notes.length ? notes : undefined,
    venue,
    urls,
  };
}

/** Vorstellungsnummer aus der Termin-ID (`tonhalle:000000e9-0011784a`). */
export function evisIdOf(event: CalendarEvent): string {
  return event.id.slice(SOURCE_ID.length + 1).replace('-', ':');
}

/* ------------------------------------------------------------------ */

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** UTC-Zeitpunkt der API → Beginn in Düsseldorfer Ortszeit. */
function berlinStart(iso: string): string | undefined {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return undefined;
  const [hour, minute] = timeFormatter.format(instant).split(':').map(Number);
  return berlinIso(berlinDay(iso), hour, minute);
}

function readJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}
