import type { Availability, CalendarEvent } from '../types.ts';
import { zonedIso } from '../time.ts';
import { clean, decodeEntities } from '../text.ts';

/**
 * Spektrix – das Ticketsystem hinter mehreren Glasgower Häusern.
 *
 * Citizens Theatre und Tron Theatre verkaufen beide über Spektrix, und beide
 * lassen dessen öffentliche „Website Integration"-Schnittstelle offen:
 *
 *     GET <shop>/api/v3/events                          alle Produktionen
 *     GET <shop>/api/v3/instances?startFrom=…&startTo=…  die Vorstellungen
 *
 * Ohne Anmeldung, ohne Schlüssel – es ist genau die Auskunft, aus der die
 * Häuser ihre eigenen Spielplanseiten bauen. Die beiden Listen hängen über
 * `instance.event.id` zusammen.
 *
 * Was Spektrix **überall gleich** führt, steht hier; was ein Haus in seinen
 * eigenen `attribute_…`-Feldern führt (Gattung, Saal, Preise, welche Reihen
 * überhaupt auf die Spielplanseite gehören), bleibt Sache des Adapters. Diese
 * Felder sind vom Haus konfiguriert und heissen deshalb nirgends gleich.
 *
 * Drei Dinge, die beim Lesen der Antwort wichtig sind:
 *
 *  - **`start` ist Ortszeit ohne Zeichen dafür** („2026-10-01T19:30:00"),
 *    `startUtc` derselbe Zeitpunkt in UTC. Wir rechnen aus der Ortszeit über
 *    die Zeitzone – dann stimmt der Offset auch in der Umstellungsnacht.
 *  - **`isOnSale` heisst „der Verkauf läuft", nicht „es gibt noch Karten".**
 *    Nachgeprüft am ausverkauften „The Singer": alle sieben Vorstellungen
 *    melden `isOnSale: true`, während die Website daneben „Sold Out" schreibt.
 *    Eine Sitzplatzauskunft gibt die Schnittstelle nicht her (`/availability`
 *    antwortet mit 404) – wer sie braucht, holt sie von der Website.
 *  - **`/events` kennt keinen Zeitraum.** Der Parameter wird stillschweigend
 *    ignoriert; gefiltert wird über die Vorstellungen.
 */

/** Eine Produktion. Nur die Felder, die jedes Spektrix-Haus führt. */
export interface SpektrixEvent {
  id: string;
  name: string;
  /** Kurzzeile der Quelle – oft Altersfreigabe oder Inhaltshinweis. */
  description?: string;
  /** Langer Ankündigungstext mit Auszeichnungen. */
  htmlDescription?: string;
  /** Spieldauer in Minuten; 0 heisst „nicht angegeben". */
  duration?: number;
  /** Haus-eigene Felder, unverändert durchgereicht. */
  attributes: Record<string, unknown>;
}

/** Eine Vorstellung. */
export interface SpektrixInstance {
  id: string;
  eventId: string;
  /** Ortszeit ohne Zonenangabe, „2026-10-01T19:30:00". */
  start: string;
  cancelled: boolean;
  isOnSale: boolean;
  /** Beginn des Webverkaufs in Ortszeit, falls gesetzt. */
  startSellingAtWeb?: string;
  attributes: Record<string, unknown>;
}

/**
 * `/api/v3/events` lesen.
 *
 * Wirft, wenn die Antwort keine Liste ist – dann ist der Shop weg oder die
 * Schnittstelle umgebaut, und die Aggregation soll den Cache ausliefern. Eine
 * *leere* Liste ist dagegen eine gültige Auskunft.
 */
export function parseEvents(json: string): SpektrixEvent[] {
  return parseArray(json, 'events').flatMap((raw) => {
    const id = text(raw.id);
    const name = text(raw.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name: clean(decodeEntities(name)),
        description: text(raw.description),
        htmlDescription: typeof raw.htmlDescription === 'string' ? raw.htmlDescription : undefined,
        duration: typeof raw.duration === 'number' ? raw.duration : undefined,
        attributes: raw,
      },
    ];
  });
}

/** `/api/v3/instances` lesen. Abgesagte Vorstellungen fallen dabei weg. */
export function parseInstances(json: string): SpektrixInstance[] {
  return parseArray(json, 'instances').flatMap((raw) => {
    const id = text(raw.id);
    const start = text(raw.start);
    const eventId = text((raw.event as Record<string, unknown> | undefined)?.id);
    if (!id || !start || !eventId) return [];
    if (raw.cancelled === true) return [];
    return [
      {
        id,
        eventId,
        start,
        cancelled: false,
        isOnSale: raw.isOnSale === true,
        startSellingAtWeb: text(raw.startSellingAtWeb),
        attributes: raw,
      },
    ];
  });
}

/**
 * Ticketlage, so weit Spektrix sie kennt.
 *
 * Mehr als „der Verkauf hat noch nicht begonnen" gibt die Schnittstelle nicht
 * her. Ein laufender Verkauf bleibt deshalb `unknown` statt `available`: ob
 * noch Karten da sind, weiss sie nachweislich nicht, und ein ausverkaufter
 * Abend als „buchbar" wäre schlechter als ein ehrliches Achselzucken. Wo die
 * Website es besser weiss, ergänzt der Adapter es dort.
 */
export function availabilityOf(instance: SpektrixInstance, now: Date): {
  availability: Availability;
  availabilityLabel?: string;
} {
  if (instance.isOnSale) return { availability: 'unknown' };
  const opens = instance.startSellingAtWeb;
  if (opens && new Date(`${opens}Z`) > now) {
    return { availability: 'not_on_sale', availabilityLabel: 'Not yet on sale' };
  }
  return { availability: 'unknown' };
}

/**
 * Was die Website eines Hauses über eine einzelne Vorstellung weiss.
 *
 * Spektrix gibt keine Sitzplatzauskunft heraus – beide Häuser schreiben sie
 * aber in ihren Spielplan auf der eigenen Seite. Was von dort kommt, hat
 * dieselbe Form, auch wenn das Markup sich nicht ähnelt.
 */
export interface ScheduleRow {
  availability: Availability;
  availabilityLabel?: string;
  ticketUrl?: string;
  notes: string[];
}

/** Vorstellungen einer Produktionsseite, nach einem Schlüssel abgelegt. */
export type Schedule = Record<string, ScheduleRow>;

/**
 * Die Auskunft der Website an die Termine legen.
 *
 * Ergänzen statt überschreiben: die Ticketlage der Seite gilt, weil die
 * Schnittstelle dazu nichts sagt; Notizen und Ticketlink kommen dazu. Findet
 * sich zu einem Termin keine Zeile, bleibt er unverändert stehen – ein
 * fehlgeschlagener Seitenabruf darf nie einen Termin verschlucken.
 */
export function applySchedules(
  events: CalendarEvent[],
  rowFor: (event: CalendarEvent) => ScheduleRow | undefined,
): CalendarEvent[] {
  return events.map((event) => {
    const row = rowFor(event);
    if (!row) return event;
    return {
      ...event,
      availability: row.availability !== 'unknown' ? row.availability : event.availability,
      availabilityLabel: row.availabilityLabel ?? event.availabilityLabel,
      ticketUrl: event.ticketUrl ?? row.ticketUrl,
      notes: row.notes.length > 0 ? [...(event.notes ?? []), ...row.notes] : event.notes,
    };
  });
}

export interface BuildOptions {
  sourceId: string;
  timeZone: string;
  events: SpektrixEvent[];
  instances: SpektrixInstance[];
  /** Was diese Quelle überhaupt zeigt – siehe `attribute_…` des Hauses. */
  include: (event: SpektrixEvent) => boolean;
  /** Gattung im Wortlaut des Hauses; leer lassen heisst Quellen-Fallback. */
  category: (event: SpektrixEvent) => string | undefined;
  /** Anzeigename der Spielstätte. */
  venue: (event: SpektrixEvent) => string;
  /** Seite des Hauses zur Produktion. */
  url: (event: SpektrixEvent) => string;
  /** Direkter Link in den Verkauf, falls das Haus einen führt. */
  ticketUrl?: (event: SpektrixEvent, instance: SpektrixInstance) => string | undefined;
  /** Zusatzinfos: Preise, Hinweise, Barrierefreiheit. */
  notes?: (event: SpektrixEvent, instance: SpektrixInstance) => string[];
  now?: Date;
}

/** Aus Produktionen und Vorstellungen Termine bauen. */
export function buildEvents(options: BuildOptions): CalendarEvent[] {
  const { sourceId, timeZone } = options;
  const now = options.now ?? new Date();
  const byId = new Map(options.events.filter(options.include).map((event) => [event.id, event]));

  const seen = new Set<string>();
  const built: CalendarEvent[] = [];

  for (const instance of options.instances) {
    const event = byId.get(instance.eventId);
    // Eine Vorstellung ohne Produktion gehört zu einer Reihe, die diese Quelle
    // nicht zeigt – oder die Produktionsliste ist älter als die Vorstellung.
    if (!event || seen.has(instance.id)) continue;
    seen.add(instance.id);

    const start = localIso(timeZone, instance.start);
    if (!start) continue;

    const { availability, availabilityLabel } = availabilityOf(instance, now);
    const notes = options.notes?.(event, instance) ?? [];
    const description = htmlToText(event.htmlDescription) ?? text(event.description);

    built.push({
      id: `${sourceId}:${instance.id}`,
      sourceId,
      title: clean(event.name),
      description,
      category: options.category(event),
      start,
      end: endOf(timeZone, instance.start, event.duration),
      allDay: false,
      venue: { name: options.venue(event) },
      availability,
      availabilityLabel,
      ticketUrl: options.ticketUrl?.(event, instance),
      url: options.url(event),
      notes: notes.length > 0 ? notes : undefined,
    });
  }

  return built;
}

/** "2026-10-01T19:30:00" (Ortszeit) -> "2026-10-01T19:30:00+01:00". */
export function localIso(timeZone: string, local: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return undefined;
  return zonedIso(timeZone, match[1], Number(match[2]), Number(match[3]));
}

/** Ende aus Beginn und Spieldauer; `0` Minuten heisst „nicht angegeben". */
function endOf(timeZone: string, local: string, duration: number | undefined): string | undefined {
  if (!duration || duration <= 0) return undefined;
  const start = localIso(timeZone, local);
  if (!start) return undefined;
  const end = new Date(new Date(start).getTime() + duration * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(end);
  const at: Record<string, string> = {};
  for (const part of parts) at[part.type] = part.value;
  return zonedIso(timeZone, `${at.year}-${at.month}-${at.day}`, Number(at.hour), Number(at.minute));
}

/** Auszeichnungen entfernen, Blöcke als Absatz erhalten. */
export function htmlToText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const plain = clean(
    decodeEntities(
      value
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, ''),
    ),
  );
  return plain.length >= 40 ? plain : undefined;
}

/** Ein `attribute_…`-Feld des Hauses als Text, leer wenn es nichts sagt. */
export function attribute(event: SpektrixEvent, name: string): string | undefined {
  return text(event.attributes[`attribute_${name}`]);
}

function parseArray(json: string, what: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Spektrix ${what}: Antwort ist kein JSON (Shop erreichbar?)`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Spektrix ${what}: keine Liste (Schnittstelle geändert?)`);
  }
  return parsed as Record<string, unknown>[];
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = clean(value);
  return trimmed || undefined;
}
