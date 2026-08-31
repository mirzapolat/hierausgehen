import type { Availability, CalendarEvent, SourceDefinition } from './types';
import type { MessageKey } from '../i18n';
import type { Formatter } from '../format';

/**
 * Für die Anzeige kommt ein Zustand dazu, den keine Quelle liefert: ein
 * Termin, der bereits stattgefunden hat. Was die Quelle zuletzt über Karten
 * gemeldet hat, gilt dann nicht mehr – und darf auch nicht so aussehen.
 */
export type DisplayAvailability = Availability | 'past';

/** Anzeigetexte für die Ticketlage – quellenunabhängig und übersetzbar. */
export const availabilityKeys: Record<DisplayAvailability, MessageKey> = {
  available: 'availAvailable',
  limited: 'availLimited',
  soldout: 'availSoldout',
  not_on_sale: 'availNotOnSale',
  unknown: 'availUnknown',
  past: 'availPast',
};

/**
 * Ein Termin gilt als vergangen, sobald sein angenommenes Ende zurückliegt.
 * Bewusst zur Anzeigezeit berechnet und nicht in den Daten gespeichert: ein
 * zwischengespeicherter Termin kann diese Grenze überschreiten, ohne dass
 * die Quelle erneut abgefragt wird.
 */
export function isPast(event: CalendarEvent, now: Date = new Date()): boolean {
  const end = event.end
    ? Date.parse(event.end)
    : Date.parse(event.start) + DEFAULT_DURATION_MINUTES * 60_000;
  return end < now.getTime();
}

export function displayAvailability(event: CalendarEvent, now?: Date): DisplayAvailability {
  return isPast(event, now) ? 'past' : event.availability;
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

export function sourceColor(definitions: SourceDefinition[], sourceId: string): string {
  return definitions.find((d) => d.id === sourceId)?.color ?? 'var(--text-faint)';
}

export function sourceName(definitions: SourceDefinition[], sourceId: string): string {
  return definitions.find((d) => d.id === sourceId)?.name ?? sourceId;
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
