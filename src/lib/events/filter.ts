import type { CalendarEvent } from './types.ts';
import { isFreeEntry } from './price.ts';
import { translateTerm } from '../i18n.ts';

/**
 * Was Oberfläche und Kalender-Abo gleich filtern.
 *
 * Reine Funktionen ohne Registry – die Datei landet auch im Browser. So
 * enthält ein abonnierter Kalender genau das, was die Seite mit denselben
 * Filtern zeigt, und nicht eine zweite, leicht abweichende Auswahl.
 */

/** Freitext über Titel, Untertitel, Programmtext, Ort und Art. */
export function matchesText(
  event: CalendarEvent,
  query: string,
  locale: string,
  /** Veranstaltungsart in der eingestellten Sprache, falls bekannt. */
  term?: (value: string) => string,
): boolean {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return true;
  // Auch der Wortlaut der Quelle ist durchsuchbar: wer "Live Music" tippt,
  // soll das Konzert finden, das im Kalender "Konzert" heisst.
  return [
    event.title,
    event.subtitle,
    event.description,
    event.venue.name,
    event.category,
    // Auch in der eingestellten Sprache: wer "Concert" tippt, sucht nicht
    // nach dem deutschen Schlüssel, der am Termin steht.
    event.category && term ? term(event.category) : undefined,
    event.categoryLabel,
  ]
    .filter(Boolean)
    .some((field) => field!.toLocaleLowerCase(locale).includes(needle));
}

/**
 * Tageszeit nach dem Beginn, in der Zeitzone der Stadt. Die Grenzen folgen
 * dem Ausgehen, nicht der Uhr: wer „Nachts“ wählt, meint auch den Club, der
 * um 1 Uhr öffnet.
 */
export const TIMES_OF_DAY = ['day', 'evening', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Beginn jeder Tageszeit in vollen Stunden – zugleich das Ende der vorigen. */
export const TIME_OF_DAY_START: Record<TimeOfDay, number> = { day: 5, evening: 17, night: 22 };

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return TIMES_OF_DAY.includes(value as TimeOfDay);
}

export function timeOfDay(minutes: number): TimeOfDay {
  const hour = minutes / 60;
  if (hour >= TIME_OF_DAY_START.night || hour < TIME_OF_DAY_START.day) return 'night';
  if (hour >= TIME_OF_DAY_START.evening) return 'evening';
  return 'day';
}

/**
 * Liegt der Beginn in einer der Tageszeiten? Ohne Auswahl immer. Ganztägiges
 * hat keinen Beginn und fällt bei einer Auswahl heraus – eine Uhrzeit dafür
 * wäre erfunden.
 */
export function matchesTimeOfDay(
  event: Pick<CalendarEvent, 'start' | 'allDay'>,
  times: readonly TimeOfDay[],
  minutesOfDay: (iso: string) => number,
): boolean {
  if (times.length === 0 || times.length === TIMES_OF_DAY.length) return true;
  if (event.allDay) return false;
  return times.includes(timeOfDay(minutesOfDay(event.start)));
}

/** Karten sind buchbar – regulär oder als Restkarten. */
export function hasTickets(event: Pick<CalendarEvent, 'availability'>): boolean {
  return event.availability === 'available' || event.availability === 'limited';
}

/**
 * Die Filter eines Kalender-Abos. Jede leere Angabe heisst „keine
 * Einschränkung“ – ein Abo ohne Parameter enthält die ganze Stadt.
 */
export interface FeedFilter {
  /** Nur diese Quellen. */
  sources?: string[];
  /** Nur diese Veranstaltungsarten (kanonischer Wert, "" = ohne Angabe). */
  categories?: string[];
  /** Diese Arten nicht. Greift nur, wenn `categories` leer ist. */
  skipCategories?: string[];
  ticketsOnly?: boolean;
  freeOnly?: boolean;
  /** Nur mit Beginn in diesen Tageszeiten. */
  timesOfDay?: TimeOfDay[];
  query?: string;
}

/**
 * `minutesOfDay` rechnet in der Zeitzone der Stadt (`Formatter.minutesOfDay`);
 * ohne sie bleibt die Tageszeit unberücksichtigt.
 */
export function applyFeedFilter(
  events: CalendarEvent[],
  filter: FeedFilter,
  minutesOfDay?: (iso: string) => number,
): CalendarEvent[] {
  const sources = filter.sources?.length ? new Set(filter.sources) : undefined;
  const only = filter.categories?.length ? new Set(filter.categories) : undefined;
  const skip = new Set(filter.skipCategories ?? []);
  return events.filter((event) => {
    if (sources && !sources.has(event.sourceId)) return false;
    const category = event.category ?? '';
    if (only ? !only.has(category) : skip.has(category)) return false;
    if (filter.ticketsOnly && !hasTickets(event)) return false;
    if (filter.freeOnly && !isFreeEntry(event)) return false;
    if (minutesOfDay && !matchesTimeOfDay(event, filter.timesOfDay ?? [], minutesOfDay)) return false;
    // Das Abo kennt keine Sprache; die englischen Namen der Arten zählen mit.
    if (filter.query && !matchesText(event, filter.query, 'de', englishTerm)) return false;
    return true;
  });
}

const englishTerm = (value: string) => translateTerm('en', value);

/*
 * Die Adresse eines Abos. Listen stehen kommagetrennt in einem Parameter;
 * Quellen-IDs und die kanonischen Arten enthalten kein Komma.
 */

export function feedSearchParams(cityId: string, filter: FeedFilter): URLSearchParams {
  const params = new URLSearchParams({ city: cityId });
  const list = (key: string, values?: string[]) => {
    if (values?.length) params.set(key, [...values].sort().join(','));
  };
  list('source', filter.sources);
  list('category', filter.categories);
  if (!filter.categories?.length) list('skip', filter.skipCategories);
  if (filter.ticketsOnly) params.set('tickets', '1');
  if (filter.freeOnly) params.set('free', '1');
  // Alle drei Tageszeiten heissen dasselbe wie keine.
  if (filter.timesOfDay && filter.timesOfDay.length < TIMES_OF_DAY.length) {
    list('time', filter.timesOfDay);
  }
  const query = filter.query?.trim();
  if (query) params.set('q', query);
  return params;
}

export function parseFeedFilter(params: URLSearchParams): FeedFilter {
  const list = (key: string) => {
    const raw = params.get(key);
    // Eine leere Art ("Ohne Angabe") bleibt als "" erhalten.
    return raw === null ? undefined : raw.split(',').map((value) => value.trim());
  };
  return {
    sources: list('source')?.filter(Boolean),
    categories: list('category'),
    skipCategories: list('skip'),
    ticketsOnly: params.get('tickets') === '1',
    freeOnly: params.get('free') === '1',
    timesOfDay: list('time')?.filter(isTimeOfDay),
    query: params.get('q')?.trim() || undefined,
  };
}
