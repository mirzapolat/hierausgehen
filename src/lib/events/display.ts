import type { Availability, CalendarEvent, SourceDefinition } from './types';
import type { MessageKey } from '../i18n';
import type { Formatter } from '../format';
import { GROUP_COLORS, groupColor, type EventGroup } from './groups.ts';
import { addDays, type DaySpan } from '../calendar.ts';
import { isFreeEntry } from './price.ts';

/**
 * Für die Anzeige kommen zwei Zustände dazu, die keine Quelle so liefert:
 *
 * - `past`: der Termin hat bereits stattgefunden. Was die Quelle zuletzt über
 *   Karten gemeldet hat, gilt dann nicht mehr – und darf auch nicht so aussehen.
 * - `free`: die Quelle nennt den Eintritt ausdrücklich frei (`price.ts`) und
 *   verkauft nichts. „Kein Verkauf“ wäre dort zwar richtig, läse sich aber wie
 *   „keine Karten zu haben“. Umgekehrt ist „Kein Verkauf“ allein nie frei.
 */
export type DisplayAvailability = Availability | 'past' | 'free';

/** Anzeigetexte für die Ticketlage – quellenunabhängig und übersetzbar. */
export const availabilityKeys: Record<DisplayAvailability, MessageKey> = {
  available: 'availAvailable',
  limited: 'availLimited',
  soldout: 'availSoldout',
  not_on_sale: 'availNotOnSale',
  unknown: 'availUnknown',
  past: 'availPast',
  free: 'availFree',
};

/**
 * Ein Termin gilt als vergangen, sobald sein angenommenes Ende zurückliegt.
 * Bewusst zur Anzeigezeit berechnet und nicht in den Daten gespeichert: ein
 * zwischengespeicherter Termin kann diese Grenze überschreiten, ohne dass
 * die Quelle erneut abgefragt wird.
 */
export function isPast(event: Pick<CalendarEvent, 'start' | 'end'>, now: Date = new Date()): boolean {
  const end = event.end
    ? Date.parse(event.end)
    : Date.parse(event.start) + DEFAULT_DURATION_MINUTES * 60_000;
  return end < now.getTime();
}

export function displayAvailability(
  event: Pick<CalendarEvent, 'start' | 'end' | 'availability'> &
    Partial<Pick<CalendarEvent, 'notes' | 'availabilityLabel'>>,
  now?: Date,
): DisplayAvailability {
  if (isPast(event, now)) return 'past';
  // Buchbare Freikarten bleiben buchbar – „frei“ ersetzt nur das Schweigen.
  if ((event.availability === 'not_on_sale' || event.availability === 'unknown') && isFreeEntry(event)) {
    return 'free';
  }
  return event.availability;
}

/**
 * Ohne Endzeit rechnen wir für die Darstellung im Zeitraster mit zwei Stunden.
 * Das wird nirgends als Tatsache ausgegeben.
 */
export const DEFAULT_DURATION_MINUTES = 120;

export function eventMinutes(event: CalendarEvent, format: Formatter): { start: number; end: number } {
  const start = format.minutesOfDay(event.start);
  const end = event.end
    ? format.minutesOfDay(event.end)
    : Math.min(start + DEFAULT_DURATION_MINUTES, 24 * 60);
  return { start, end: Math.max(end, start + 30) };
}

/** Die Farbe einer Quelle ist die ihres Ordners – siehe `events/groups.ts`. */
export function sourceColor(definitions: SourceDefinition[], sourceId: string): string {
  const group = definitions.find((d) => d.id === sourceId)?.group;
  return group ? groupColor(group) : 'var(--text-faint)';
}

export function sourceName(definitions: SourceDefinition[], sourceId: string): string {
  return definitions.find((d) => d.id === sourceId)?.name ?? sourceId;
}

type DayClock = Pick<Formatter, 'localDay' | 'minutesOfDay'>;

/** Ein mehrtägiger Termin samt der Tage, über die er läuft. */
export interface EventSpan extends DaySpan {
  event: CalendarEvent;
}

/**
 * Läuft ein Termin über mehrere Tage? Dann die Tage, über die er reicht.
 *
 * Eine Clubnacht von 22 bis 6 Uhr endet zwar am Folgetag, gehört aber zu
 * dem Abend, an dem sie beginnt – mehrtägig ist erst, was einen ganzen Tag
 * oder länger dauert, oder ein ganztägiger Termin mit späterem Endtag. Ein
 * Ende genau um Mitternacht zählt zum Vortag.
 */
export function eventSpan(event: CalendarEvent, format: DayClock): EventSpan | undefined {
  if (!event.end) return undefined;
  const from = format.localDay(event.start);
  let to = format.localDay(event.end);
  if (to > from && format.minutesOfDay(event.end) === 0) to = addDays(to, -1);
  if (to <= from) return undefined;
  if (!event.allDay && Date.parse(event.end) - Date.parse(event.start) < 86_400_000) return undefined;
  return { id: event.id, from, to, event };
}

/** Einzelne Termine und mehrtägige getrennt – die einen in Zellen, die anderen als Balken. */
export function splitSpans(
  events: CalendarEvent[],
  format: DayClock,
): { single: CalendarEvent[]; spans: EventSpan[] } {
  const single: CalendarEvent[] = [];
  const spans: EventSpan[] = [];
  for (const event of events) {
    const span = eventSpan(event, format);
    if (span) spans.push(span);
    else single.push(event);
  }
  return { single, spans };
}

/**
 * Alles, was an einem Tag stattfindet: was an ihm beginnt, und danach, was
 * schon früher begonnen hat und an diesem Tag noch läuft.
 */
export function eventsOnDay(events: CalendarEvent[], day: string, format: DayClock): CalendarEvent[] {
  const starting: CalendarEvent[] = [];
  const running: CalendarEvent[] = [];
  for (const event of events) {
    if (format.localDay(event.start) === day) {
      starting.push(event);
      continue;
    }
    const span = eventSpan(event, format);
    if (span && span.from < day && span.to >= day) running.push(event);
  }
  return [...starting, ...running];
}

/**
 * Der letzte Tag eines Termins, der am angezeigten Tag schon läuft – sonst
 * nichts. Listen zeigen dann „bis …" statt einer Uhrzeit, die nicht mehr gilt.
 */
export function runningUntil(event: CalendarEvent, day: string, format: DayClock): string | undefined {
  const span = eventSpan(event, format);
  return span && span.from < day && span.to >= day ? span.to : undefined;
}

/** Die Art, unter der `categories.ts` Ausstellungen führt ("Exhibition", "Installation" …). */
const EXHIBITION = 'Ausstellung';

export function isExhibition(event: Pick<CalendarEvent, 'category'>): boolean {
  return event.category === EXHIBITION;
}

/**
 * Ausstellungen getrennt von allem anderen – eine Ausstellung besucht man
 * irgendwann während der Öffnungszeit, eine Veranstaltung zu ihrem Beginn.
 * Die Reihenfolge innerhalb beider Teile bleibt erhalten.
 */
export function splitExhibitions(events: CalendarEvent[]): {
  events: CalendarEvent[];
  exhibitions: CalendarEvent[];
} {
  const rest: CalendarEvent[] = [];
  const exhibitions: CalendarEvent[] = [];
  for (const event of events) (isExhibition(event) ? exhibitions : rest).push(event);
  return { events: rest, exhibitions };
}

/** Events nach lokalem Tag der eingestellten Zeitzone gruppieren. */
export function byDay(events: CalendarEvent[], format: Formatter): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = format.localDay(event.start);
    const list = map.get(day);
    if (list) list.push(event);
    else map.set(day, [event]);
  }
  return map;
}

/** Ein Anteil am Tag: wie viele Termine aus den Quellen eines Ordners. */
export interface GroupShare {
  group: EventGroup;
  count: number;
}

/**
 * Woraus ein Tag besteht, nach Ordnern – in der festen Reihenfolge der
 * Farben (`groups.ts`), damit die Töne in jeder Zelle gleich geschichtet
 * liegen und sich Tage auf einen Blick vergleichen lassen.
 */
export function groupMix(
  events: Pick<CalendarEvent, 'sourceId'>[],
  definitions: Pick<SourceDefinition, 'id' | 'group'>[],
): GroupShare[] {
  const groupOf = new Map(definitions.map((d) => [d.id, d.group]));
  const counts = new Map<EventGroup, number>();
  for (const event of events) {
    const group = groupOf.get(event.sourceId);
    if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return (Object.keys(GROUP_COLORS) as EventGroup[])
    .filter((group) => counts.has(group))
    .map((group) => ({ group, count: counts.get(group)! }));
}
