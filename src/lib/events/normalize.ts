import type { CalendarEvent, SourceDefinition } from './types.ts';
import { clean } from './text.ts';

/**
 * Gemeinsame Sicherung nach den Adaptern: Die Parser bleiben nah an der
 * Quelle, hier entsteht daraus die konsistente API-Form für Kalender und UI.
 */

export function normalizeSourceEvents(
  events: CalendarEvent[],
  definition: SourceDefinition,
): CalendarEvent[] {
  return events.map((event) => normalizeEvent(event, definition));
}

export function normalizeAndDedupeEvents(
  events: CalendarEvent[],
  definitions: SourceDefinition[],
): CalendarEvent[] {
  const bySource = new Map(definitions.map((definition) => [definition.id, definition]));
  const normalized = events.map((event) => normalizeEvent(event, bySource.get(event.sourceId)));
  return dedupeEvents(normalized);
}

function normalizeEvent(event: CalendarEvent, definition?: SourceDefinition): CalendarEvent {
  const notes = event.notes?.map(clean).filter(Boolean);

  return {
    ...event,
    title: clean(event.title),
    subtitle: event.subtitle ? clean(event.subtitle) : undefined,
    description: event.description ? clean(event.description) : undefined,
    category:
      clean(event.category ?? '') || definition?.defaultCategory || definition?.group || 'Sonstiges',
    venue: {
      name: clean(event.venue.name) || definition?.name || 'Unbekannter Ort',
      city: event.venue.city ? clean(event.venue.city) : undefined,
    },
    availabilityLabel: event.availabilityLabel ? clean(event.availabilityLabel) : undefined,
    ticketUrl: event.ticketUrl || undefined,
    url: event.url || definition?.homepage || '',
    icsUrl: event.icsUrl || undefined,
    notes: notes?.length ? [...new Set(notes)] : undefined,
  };
}

export function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    byId.set(event.id, existing ? betterEvent(existing, event) : event);
  }

  const buckets = new Map<string, CalendarEvent[]>();
  for (const event of byId.values()) {
    const key = `${event.start}|${eventTitleKey(event.title)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(event);
    else buckets.set(key, [event]);
  }

  const result: CalendarEvent[] = [];
  for (const bucket of buckets.values()) {
    const kept: CalendarEvent[] = [];
    for (const event of bucket) {
      const duplicate = kept.find((candidate) => isDuplicate(candidate, event));
      if (!duplicate) {
        kept.push(event);
        continue;
      }

      const better = betterEvent(duplicate, event);
      if (better !== duplicate) kept[kept.indexOf(duplicate)] = better;
    }
    result.push(...kept);
  }

  return result;
}

function isDuplicate(a: CalendarEvent, b: CalendarEvent): boolean {
  return venueCompatible(a.venue.name, b.venue.name);
}

function venueCompatible(a: string, b: string): boolean {
  const left = comparable(a);
  const right = comparable(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function betterEvent(a: CalendarEvent, b: CalendarEvent): CalendarEvent {
  return eventScore(b) > eventScore(a) ? b : a;
}

function eventScore(event: CalendarEvent): number {
  return [
    event.ticketUrl ? 8 : 0,
    event.availability === 'unknown' ? 0 : 6,
    event.end ? 3 : 0,
    event.description ? 3 : 0,
    event.subtitle ? 2 : 0,
    event.icsUrl ? 2 : 0,
    event.notes?.length ?? 0,
  ].reduce((sum, value) => sum + value, 0);
}

function eventTitleKey(title: string): string {
  return comparable(title);
}

function comparable(text: string): string {
  return clean(text)
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' und ')
    .replace(/\b(theater|buhne|saal|haus)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
