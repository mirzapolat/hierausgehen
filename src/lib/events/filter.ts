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
export type TimeOfDayStarts = Record<TimeOfDay, number>;

/** Die Grenzen ab Werk; in den Einstellungen lassen sie sich verschieben. */
export const TIME_OF_DAY_START: TimeOfDayStarts = { day: 5, evening: 17, night: 22 };

/**
 * Eigene Grenzen gelten nur, wenn sie aufsteigend in einem Tag liegen
 * (tagsüber < abends < nachts, volle Stunden 0–23). Die Nacht reicht über
 * Mitternacht bis zum Beginn des Tages.
 */
export function normalizeTimeOfDayStarts(value: unknown): TimeOfDayStarts {
  if (!value || typeof value !== 'object') return TIME_OF_DAY_START;
  const { day, evening, night } = value as Partial<Record<TimeOfDay, unknown>>;
  const hours = [day, evening, night];
  const valid =
    hours.every((hour) => Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23) &&
    (day as number) < (evening as number) &&
    (evening as number) < (night as number);
  return valid ? { day: day as number, evening: evening as number, night: night as number } : TIME_OF_DAY_START;
}

export function isDefaultTimeOfDayStarts(starts: TimeOfDayStarts): boolean {
  return TIMES_OF_DAY.every((time) => starts[time] === TIME_OF_DAY_START[time]);
}

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return TIMES_OF_DAY.includes(value as TimeOfDay);
}

export function timeOfDay(minutes: number, starts: TimeOfDayStarts = TIME_OF_DAY_START): TimeOfDay {
  const hour = minutes / 60;
  if (hour >= starts.night || hour < starts.day) return 'night';
  if (hour >= starts.evening) return 'evening';
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
  starts: TimeOfDayStarts = TIME_OF_DAY_START,
): boolean {
  if (times.length === 0 || times.length === TIMES_OF_DAY.length) return true;
  if (event.allDay) return false;
  return times.includes(timeOfDay(minutesOfDay(event.start), starts));
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
  /** Eigene Grenzen der Tageszeiten, falls in den Einstellungen verschoben. */
  timeOfDayStarts?: TimeOfDayStarts;
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
    if (minutesOfDay && !matchesTimeOfDay(event, filter.timesOfDay ?? [], minutesOfDay, filter.timeOfDayStarts))
      return false;
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
    // Die Grenzen nur, wenn sie zählen – sonst bliebe die Adresse dieselbe.
    if (filter.timeOfDayStarts && !isDefaultTimeOfDayStarts(filter.timeOfDayStarts)) {
      const { day, evening, night } = filter.timeOfDayStarts;
      params.set('hours', `${day},${evening},${night}`);
    }
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
    timeOfDayStarts: parseTimeOfDayStarts(params.get('hours')),
    query: params.get('q')?.trim() || undefined,
  };
}

function parseTimeOfDayStarts(raw: string | null): TimeOfDayStarts | undefined {
  if (!raw) return undefined;
  const [day, evening, night] = raw.split(',').map((value) => Number(value.trim()));
  return normalizeTimeOfDayStarts({ day, evening, night });
}
