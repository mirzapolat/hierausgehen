import type { CalendarEvent } from './types.ts';
import { clean } from './text.ts';

/**
 * Eine Reihe: alle Termine derselben Veranstaltung bei derselben Quelle am
 * selben Ort – die Grundlage der „weiteren Termine“ und der gemerkten Reihen.
 *
 * Der Schlüssel hängt nur am Termin selbst, nicht am geladenen Bestand. So
 * erkennt ihn auch ein Termin, der erst später ins Programm kommt. Er beginnt
 * mit der Quellen-ID, daraus folgt die Stadt.
 */
export function seriesKey(event: Pick<CalendarEvent, 'sourceId' | 'title' | 'subtitle' | 'venue'>): string {
  return [
    event.sourceId,
    comparable(event.title),
    comparable(event.subtitle ?? ''),
    comparable(event.venue.name),
    comparable(event.venue.city ?? ''),
  ].join('|');
}

/** Text für Vergleiche: ohne Gross/klein, Akzente, Satzzeichen und Füllwörter. */
export function comparable(text: string): string {
  return clean(text)
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' und ')
    .replace(/\b(theater|buhne|saal|haus)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
