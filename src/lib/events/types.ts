/**
 * Normalisiertes Datenmodell.
 *
 * Alles, was aus einer Quelle kommt, wird auf `CalendarEvent` abgebildet.
 * Kalender und UI kennen ausschliesslich diesen Typ – niemals das Format
 * einer konkreten Website.
 */

/** Ticketlage, so grob wie sie sich quellenübergreifend verlässlich abbilden lässt. */
export type Availability =
  | 'available' // regulär buchbar
  | 'limited' // nur noch Restkarten
  | 'soldout' // ausverkauft
  | 'not_on_sale' // Vorverkauf noch nicht gestartet / kein Verkauf über die Quelle
  | 'unknown'; // Quelle macht keine Angabe

export interface EventVenue {
  /** Anzeigename, z. B. "Nationaltheater". */
  name: string;
  /** Optionaler Ort, falls die Quelle mehrere Städte bedient. */
  city?: string;
}

export interface CalendarEvent {
  /** Global eindeutig: `${sourceId}:${sourceEventId}`. */
  id: string;
  sourceId: string;

  title: string;
  /** Untertitel/Komponist/Ensemble – was die Quelle als zweite Zeile führt. */
  subtitle?: string;
  /** Gattung der Quelle, unverändert übernommen ("Oper", "Konzert", "Schauspiel", …). */
  category?: string;

  /** Beginn als ISO-8601 mit Offset, z. B. "2026-07-02T19:00:00+02:00". */
  start: string;
  /** Ende, falls die Quelle es liefert. */
  end?: string;
  /** true, wenn die Quelle keine Uhrzeit kennt. */
  allDay: boolean;

  venue: EventVenue;

  availability: Availability;
  /** Originalformulierung der Quelle ("Letzte Tickets"), rein informativ. */
  availabilityLabel?: string;
  /** Direkter Link in den Ticketshop, falls vorhanden. */
  ticketUrl?: string;

  /** Link auf die Veranstaltung bei der Quelle. */
  url: string;
  /** Optionaler .ics-Link der Quelle. */
  icsUrl?: string;

  /** Freie Zusatzinfos (Preise, Festival, Hinweise). */
  notes?: string[];
}

/** Eine Quelle beschreibt sich selbst – daraus baut die UI die Sidebar. */
export interface SourceDefinition {
  id: string;
  /** Anzeigename in der Sidebar. */
  name: string;
  /** Stadt, zu der die Quelle gehört (siehe `src/lib/cities.ts`). */
  cityId: string;
  /** Gruppe/Ordner in der Sidebar, z. B. "Oper & Ballett". */
  group: string;
  /** Farbe als CSS-Farbwert; identifiziert die Quelle im Kalender. */
  color: string;
  /** Startseite der Quelle. */
  homepage: string;
  /**
   * Fester Link auf das Favicon. Nur nötig, wenn die automatische Erkennung
   * über die Startseite nicht greift – sie hat Vorrang, damit ein Wechsel des
   * Icons nicht händisch nachgepflegt werden muss.
   */
  iconUrl?: string;
  /** Quelle standardmässig aktiv? */
  enabledByDefault?: boolean;
}

export interface FetchRange {
  /** Erster relevanter Tag, ISO "YYYY-MM-DD". */
  from: string;
  /** Letzter relevanter Tag (inklusive), ISO "YYYY-MM-DD". */
  to: string;
}

/**
 * Ein Adapter ist die einzige Stelle, die eine konkrete Website kennt.
 *
 * Neue Quelle hinzufügen = eine Datei anlegen, die `EventSource` erfüllt,
 * und sie in `registry.ts` eintragen. Sonst nichts.
 */
export interface EventSource {
  definition: SourceDefinition;
  /**
   * Liefert alle Events im Zeitraum. Darf werfen – die Aggregation isoliert
   * Fehler pro Quelle und fällt auf den Cache zurück.
   */
  fetchEvents(range: FetchRange, signal?: AbortSignal): Promise<CalendarEvent[]>;
  /**
   * Wie lange Ergebnisse als frisch gelten (Sekunden). Ticketverfügbarkeit
   * veraltet schneller als der Spielplan selbst.
   */
  ttlSeconds?: number;
}

export type SourceStatus = 'ok' | 'stale' | 'error';

export interface SourceResult {
  sourceId: string;
  status: SourceStatus;
  /** Zeitpunkt der zugrundeliegenden erfolgreichen Abfrage. */
  fetchedAt: string;
  eventCount: number;
  error?: string;
}

export interface AggregateResult {
  events: CalendarEvent[];
  sources: SourceResult[];
  /** Definitionen aller registrierten Quellen – auch der fehlgeschlagenen. */
  definitions: SourceDefinition[];
}
