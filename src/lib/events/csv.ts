import type { CalendarEvent, SourceDefinition } from './types.ts';

/**
 * Der Datenstand als CSV (RFC 4180).
 *
 * Reine Funktion auf dem Datenmodell – wie `ics.ts` kennt sie keine Quelle und
 * kein Netz. Eine Zeile ist ein Termin, eine Spalte ein Feld aus
 * `CalendarEvent`; nichts wird zusammengefasst oder ausgelassen, damit die
 * Datei ausserhalb des Kalenders weiterverwendbar bleibt.
 *
 * Was die Quelle nicht hergibt, bleibt leer – auch hier werden keine Angaben
 * erfunden.
 */

const CRLF = '\r\n';
/** Mehrwertige Felder (Hinweise, weitere Termine) in einer Zelle. */
const LIST_SEPARATOR = ' | ';

const columns = [
  'id',
  'quelle_id',
  'quelle',
  'gruppe',
  'kalenderstadt',
  'titel',
  'untertitel',
  'veranstaltungsart',
  'veranstaltungsart_quelle',
  'beschreibung',
  'beginn',
  'ende',
  'datum',
  'uhrzeit',
  'ganztaegig',
  'ort',
  'stadt',
  'karten',
  'kartenhinweis',
  'ticket_url',
  'url',
  'ics_url',
  'hinweise',
  'weitere_termine',
] as const;

export function toCsv(
  events: CalendarEvent[],
  definitions: SourceDefinition[] = [],
): string {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  const rows = events.map((event) => {
    const definition = byId.get(event.sourceId);
    return [
      event.id,
      event.sourceId,
      definition?.name ?? '',
      definition?.group ?? '',
      // Nicht der Ort der Spielstätte, sondern die Stadt, unter der die Quelle
      // im Kalender steht – ohne die Spalte wäre ein Export über mehrere
      // Städte nicht mehr auseinanderzuhalten.
      definition?.cityId ?? '',
      event.title,
      event.subtitle ?? '',
      event.category ?? '',
      event.categoryLabel ?? '',
      event.description ?? '',
      event.start,
      event.end ?? '',
      // Tag und Uhrzeit noch einmal getrennt: in einer Tabelle lässt sich damit
      // sofort sortieren und filtern, ohne den ISO-Wert zu zerlegen.
      event.start.slice(0, 10),
      event.allDay ? '' : event.start.slice(11, 16),
      event.allDay ? 'ja' : 'nein',
      event.venue.name,
      event.venue.city ?? '',
      event.availability,
      event.availabilityLabel ?? '',
      event.ticketUrl ?? '',
      event.url,
      event.icsUrl ?? '',
      (event.notes ?? []).join(LIST_SEPARATOR),
      (event.relatedPerformances ?? []).map((p) => p.start).join(LIST_SEPARATOR),
    ];
  });

  return [columns, ...rows].map((row) => row.map(cell).join(',')).join(CRLF) + CRLF;
}

/** Dateiname für den Download – Städte und Datenstand. */
export function csvFileName(cityIds: string[], day: string): string {
  return `hierausgehen-${cityIds.join('-')}-${day}.csv`;
}

/**
 * Ein Feld wird nur dann in Anführungszeichen gesetzt, wenn es sein muss;
 * enthaltene Anführungszeichen werden verdoppelt (RFC 4180).
 */
function cell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
