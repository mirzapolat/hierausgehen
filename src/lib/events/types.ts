/**
 * Normalisiertes Datenmodell.
 *
 * Alles, was aus einer Quelle kommt, wird auf `CalendarEvent` abgebildet.
 * Kalender und UI kennen ausschliesslich diesen Typ – niemals das Format
 * einer konkreten Website.
 */

import type { EventGroup } from './groups.ts';

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

export interface EventPerformance {
  id: string;
  start: string;
  end?: string;
  allDay: boolean;
  venue: EventVenue;
  availability: Availability;
  availabilityLabel?: string;
  ticketUrl?: string;
  url: string;
  icsUrl?: string;
}

export interface CalendarEvent {
  /** Global eindeutig: `${sourceId}:${sourceEventId}`. */
  id: string;
  sourceId: string;

  title: string;
  /** Untertitel/Komponist/Ensemble – was die Quelle als zweite Zeile führt. */
  subtitle?: string;
  /** Programm-/Kurzinfo-Text der Quelle. */
  description?: string;
  /**
   * Veranstaltungsart, vereinheitlicht über `categories.ts` – der Wert, nach
   * dem gefiltert und gruppiert wird.
   */
  category?: string;
  /**
   * Wortlaut der Quelle, falls er von `category` abweicht ("Live Music",
   * "Kinder & Familie / Show & Revue"). Rein informativ; nichts filtert
   * danach, aber die Genauigkeit der Quelle geht so nicht verloren.
   */
  categoryLabel?: string;

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
  /** Weitere Aufführungstermine derselben Veranstaltung. */
  relatedPerformances?: EventPerformance[];
}

/** Eine Quelle beschreibt sich selbst – daraus baut die UI die Sidebar. */
export interface SourceDefinition {
  id: string;
  /** Anzeigename in der Sidebar. */
  name: string;
  /** Stadt, zu der die Quelle gehört (siehe `src/lib/cities.ts`). */
  cityId: string;
  /** Ordner in der Sidebar; er bestimmt zugleich die Farbe (siehe `groups.ts`). */
  group: EventGroup;
  /**
   * Veranstaltungsart, falls einzelne Termine keine eigene Gattung liefern.
   * Adapter dürfen das Feld am Termin leer lassen; die Aggregation ergänzt es.
   * Wird wie jede Angabe der Quelle über `categories.ts` vereinheitlicht.
   */
  defaultCategory?: string;
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

export interface EventFetchOptions {
  /** Frist fuer den gesamten Quellenabruf. */
  deadlineMs?: number;
  /** Frist fuer einzelne HTTP-Anfragen innerhalb eines Adapters. */
  requestTimeoutMs?: number;
  /** Zeitbudget fuer optionale Detailseiten-Texte. */
  descriptionBudgetMs?: number;
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
  fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]>;
  /**
   * Wie lange Ergebnisse als frisch gelten (Sekunden). Ticketverfügbarkeit
   * veraltet schneller als der Spielplan selbst.
   */
  ttlSeconds?: number;
}

/**
 * - `ok`            frische Daten
 * - `revalidating`  aus dem Cache geliefert, Auffrischung läuft im Hintergrund
 * - `stale`         aus dem Cache geliefert, die letzte Auffrischung schlug fehl
 * - `error`         keine Daten vorhanden
 */
export type SourceStatus = 'ok' | 'revalidating' | 'stale' | 'error';

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
