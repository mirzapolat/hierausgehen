import type { Availability, CalendarEvent } from '../../types.ts';
import { clean, softenShouted } from '../../text.ts';
import { TZ, zonedDay, zonedIso } from '../../time.ts';
import type { PageResult } from '../page.ts';

/**
 * Friends Studios (München) – Wix-Seite mit dem Wix-Events-Widget.
 *
 * Das Widget rendert seine Termine aus dem eingebetteten
 * `<script id="wix-warmup-data">`. Darin steht unter
 * `appsWarmupData.<app>.<widget>.events` die komplette Liste der kommenden
 * Termine (`events`) samt `hasMore`. Wir lesen dieses JSON statt des Markups.
 */

export const SOURCE_ID = 'friends-studios';
export const BASE = 'https://www.friends-studios.com';

interface WixEvent {
  id?: string;
  title?: string;
  description?: string;
  about?: string;
  slug?: string;
  status?: number;
  location?: { name?: string; tbd?: boolean; fullAddress?: { city?: string } };
  scheduling?: {
    config?: {
      scheduleTbd?: boolean;
      startDate?: string;
      endDate?: string;
      timeZoneId?: string;
      endDateHidden?: boolean;
    };
  };
  registration?: {
    type?: number;
    status?: number;
    ticketing?: {
      soldOut?: boolean;
      lowestTicketPriceFormatted?: string;
      highestTicketPriceFormatted?: string;
    };
  };
}

interface WixEventsList {
  events: WixEvent[];
  hasMore?: boolean;
}

/** Wix `EventStatus`: 3 = abgesagt. */
const STATUS_CANCELED = 3;

/**
 * Wix `RegistrationStatus`: 1 CLOSED, 2 CLOSED_MANUALLY, 3 OPEN_RSVP,
 * 4 OPEN_RSVP_WAITLIST, 5 OPEN_TICKETS, 6 OPEN_EXTERNAL, 7 SCHEDULED_RSVP.
 */
const OPEN_REGISTRATION = new Set([3, 5, 6]);

export interface FriendsPage extends PageResult {
  /** Das Widget kündigt weitere Termine an, die nicht im HTML stehen. */
  hasMore: boolean;
}

export function parseEventsPage(html: string): FriendsPage {
  const list = findEventsList(readWarmupData(html));
  if (!list) return { events: [], skipped: 0, empty: false, hasMore: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;
  for (const raw of list.events) {
    const event = toEvent(raw);
    if (event) events.push(event);
    else skipped++;
  }
  return {
    events,
    skipped,
    empty: list.events.length === 0,
    hasMore: list.hasMore === true,
  };
}

function readWarmupData(html: string): unknown {
  const match = html.match(/<script[^>]*id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

/** Sucht das Objekt `{ events: [...], hasMore }` des Events-Widgets. */
function findEventsList(data: unknown): WixEventsList | undefined {
  const apps = (data as { appsWarmupData?: Record<string, unknown> } | undefined)?.appsWarmupData;
  if (!apps || typeof apps !== 'object') return undefined;
  for (const app of Object.values(apps)) {
    if (!app || typeof app !== 'object') continue;
    for (const widget of Object.values(app as Record<string, unknown>)) {
      const list = (widget as { events?: unknown } | null)?.events;
      if (
        list &&
        typeof list === 'object' &&
        Array.isArray((list as WixEventsList).events) &&
        'hasMore' in list
      ) {
        return list as WixEventsList;
      }
    }
  }
  return undefined;
}

function toEvent(raw: WixEvent): CalendarEvent | undefined {
  const config = raw.scheduling?.config;
  const title = raw.title ? softenShouted(clean(raw.title)) : '';
  if (!raw.id || !raw.slug || !title || !config?.startDate || config.scheduleTbd) return undefined;

  const timeZone = config.timeZoneId || TZ;
  const start = localIso(timeZone, config.startDate);
  if (!start) return undefined;
  const end = config.endDate && !config.endDateHidden ? localIso(timeZone, config.endDate) : undefined;

  const url = `${BASE}/event-details/${raw.slug}`;
  const { availability, availabilityLabel } = readAvailability(raw);
  const description = readDescription(raw);
  const notes = readNotes(raw);
  const venueName = clean(raw.location?.name ?? '');
  const city = raw.location?.fullAddress?.city;

  return {
    id: `${SOURCE_ID}:${raw.id}`,
    sourceId: SOURCE_ID,
    title,
    ...(description ? { description } : {}),
    start,
    ...(end ? { end } : {}),
    allDay: false,
    venue: {
      name: venueName && !raw.location?.tbd ? softenShouted(venueName) : 'Friends Studios',
      ...(city ? { city } : {}),
    },
    availability,
    ...(availabilityLabel ? { availabilityLabel } : {}),
    ...(availability === 'available' || availability === 'limited' ? { ticketUrl: url } : {}),
    url,
    ...(notes.length ? { notes } : {}),
  };
}

/** UTC-Zeitpunkt aus Wix in die Wanduhr der Veranstaltungszeitzone. */
function localIso(timeZone: string, utc: string): string | undefined {
  const instant = new Date(utc);
  if (Number.isNaN(instant.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return zonedIso(timeZone, zonedDay(timeZone, utc), get('hour'), get('minute'));
}

function readAvailability(raw: WixEvent): {
  availability: Availability;
  availabilityLabel?: string;
} {
  if (raw.status === STATUS_CANCELED) {
    return { availability: 'not_on_sale', availabilityLabel: 'Abgesagt' };
  }
  const registration = raw.registration;
  if (registration?.ticketing?.soldOut) {
    return { availability: 'soldout', availabilityLabel: 'Ausverkauft' };
  }
  if (registration?.status === 4) {
    return { availability: 'soldout', availabilityLabel: 'Warteliste' };
  }
  if (registration?.status !== undefined && OPEN_REGISTRATION.has(registration.status)) {
    return { availability: 'available' };
  }
  if (registration?.status === 1 || registration?.status === 2 || registration?.status === 7) {
    return { availability: 'not_on_sale', availabilityLabel: 'Anmeldung geschlossen' };
  }
  return { availability: 'unknown' };
}

function readDescription(raw: WixEvent): string | undefined {
  const text = [raw.description, raw.about]
    .map((part) => (part ?? '').replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

function readNotes(raw: WixEvent): string[] {
  const ticketing = raw.registration?.ticketing;
  const low = ticketing?.lowestTicketPriceFormatted;
  const high = ticketing?.highestTicketPriceFormatted;
  if (!low) return [];
  if (high && high !== low) return [`Preise: ${low} – ${high}`];
  return [`Preis: ${low}`];
}
