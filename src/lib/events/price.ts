import type { CalendarEvent } from './types.ts';

/**
 * Freier Eintritt – erkannt nur an den kurzen Angaben der Quelle.
 *
 * Ein Preisfeld gibt es im Datenmodell nicht; die Quellen schreiben ihn in
 * `notes` („Eintritt frei“, „Preise: Kostenlos“, „Tickets: Free – ticket
 * required“) oder als Ticketlage („Kostenfrei“). Diese Zeilen sagen genau
 * eine Sache und taugen deshalb als Signal.
 *
 * Der Programmtext zählt bewusst nicht: dort steht „feel free to bring a
 * mat“, „free improvisation“ oder „frei für Ticketinhaber des Konzerts“. Ein
 * Termin, der nur im Fliesstext kostenlos ist, fehlt im Filter – besser als
 * ein bezahlter Abend darin.
 *
 * Nennt dieselbe Zeile auch einen Preis („Eintritt frei mit Bändchen, 10 €
 * Vorverkauf“), ist der Eintritt nicht frei.
 */

/** Einleitungen vor der eigentlichen Angabe: „Preise:“, „Tickets:“, „Eintritt“. */
const LEAD = /^(?:(?:preise?|tickets?|eintritt|admission|entry)\s*:?\s*)+/i;
// Danach nur Satzzeichen oder das Zeilenende – „Frei.Wild“ ist eine Band.
const FREE = /^(?:frei|freier eintritt|kostenlos|kostenfrei|gratis|umsonst|free|teilnahme kostenlos)(?=$|[\s,;:!()–-]|\.$)/iu;
const FREE_ANYWHERE = /(?:^|\s)kostenlos anmelden(?![\p{L}])/iu;
/** Ein Betrag mit Währung – „15 €“, „30 EUR“, „£27.08“. */
export const PRICE = /\d+(?:[.,]\d{1,2})?\s*(?:€|eur\b|£|chf\b)|[€£]\s*\d/i;

export function isFreeEntry(event: Pick<CalendarEvent, 'notes' | 'availabilityLabel'>): boolean {
  const lines = [...(event.notes ?? []), event.availabilityLabel ?? ''];
  return lines.some(isFreeLine);
}

export function isFreeLine(line: string): boolean {
  const text = line.trim();
  if (!text || PRICE.test(text)) return false;
  return FREE.test(text.replace(LEAD, '')) || FREE_ANYWHERE.test(text);
}
