import type { CalendarEvent } from './types.ts';
import { isFreeLine, PRICE } from './price.ts';

/**
 * Preis und Dauer aus den Zusatzinfos eines Termins.
 *
 * Felder dafür gibt es im Datenmodell nicht: die Quellen schreiben beides in
 * `notes` („Tickets from £27.08“, „Preise: ab 15,00 €“, „Duration: 90 mins“).
 * Erkannt werden nur Zeilen, die genau das sagen – ein Betrag mit Währung,
 * ein freier Eintritt oder eine ausdrückliche Dauer. Der Wortlaut der Quelle
 * bleibt stehen; entfernt wird nur eine vorangestellte Beschriftung, die die
 * Tabellenzeile ohnehin trägt („Preise:“, „Duration:“).
 */
export interface NoteFacts {
  /** Preisangaben, je Zeile der Quelle eine. */
  prices: string[];
  duration?: string;
  /**
   * Weitere beschriftete Angaben („Doors: 19:00“, „Einlass: 30 Minuten vor
   * Beginn“, „Sprache: Deutsch“) – Beschriftung und Wert wie in der Quelle.
   */
  attributes: { label: string; value: string }[];
  /** Alles Übrige, in der Reihenfolge der Quelle. */
  rest: string[];
}

/** „Preise:“, „Tickets:“, „Eintritt:“ – oder ohne Doppelpunkt vor „ab“, „from“ oder dem Betrag. */
const PRICE_LABEL = /^(?:preise?|tickets?|eintritt|admission|entry)(?:\s*:\s*|\s+(?=(?:ab|from)\b|\d|[€£$]))/i;
const DURATION_LABEL = /^(?:duration|dauer|spieldauer|laufzeit|running time)\s*:?\s+/i;
/**
 * „Beschriftung: Wert“ – eine kurze Beschriftung aus Buchstaben (keine
 * Ziffern, sonst wäre „19:30 Uhr“ eine), danach ein Wert, der in eine
 * Tabellenzeile passt. Längeres bleibt Fliesstext unter der Tabelle.
 */
const ATTRIBUTE = /^(\p{L}[\p{L} .&/-]{0,23}):\s+(.{1,120})$/u;

export function noteFacts(event: Pick<CalendarEvent, 'notes'>): NoteFacts {
  const prices: string[] = [];
  const attributes: NoteFacts['attributes'] = [];
  const rest: string[] = [];
  let duration: string | undefined;

  for (const note of event.notes ?? []) {
    const text = note.trim();
    if (!text) continue;
    const attribute = ATTRIBUTE.exec(text);
    if (!duration && DURATION_LABEL.test(text)) {
      duration = text.replace(DURATION_LABEL, '');
    } else if (PRICE.test(text) || isFreeLine(text)) {
      prices.push(text.replace(PRICE_LABEL, ''));
    } else if (attribute) {
      attributes.push({ label: attribute[1].trim(), value: attribute[2].trim() });
    } else {
      rest.push(note);
    }
  }

  return { prices, duration, attributes, rest };
}
