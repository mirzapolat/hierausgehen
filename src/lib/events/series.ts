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

/** Was über eine Reihe bekannt ist: wie viele Termine noch kommen und bis wann. */
export interface SeriesRun {
  /** Kommende Termine der Reihe, der gefragte eingeschlossen. */
  count: number;
  /** Beginn des letzten bekannten Termins, ISO-8601. */
  last: string;
}

type RunSource = Pick<CalendarEvent, 'id' | 'start' | 'end' | 'sourceId' | 'title' | 'subtitle' | 'venue'> &
  Partial<Pick<CalendarEvent, 'relatedPerformances'>>;

/**
 * Die Reihen im geladenen Bestand, nach `seriesKey`.
 *
 * Gezählt wird, was die Quelle als weitere Aufführungen nennt, und was mit
 * gleichem Schlüssel geladen ist – beides zusammen, weil der Bestand nur
 * wenige Monate umfasst und nicht jede Quelle ihre Aufführungen aufzählt.
 * Vergangenes zählt nicht: „noch 3 Termine“ meint die, zu denen man noch
 * gehen kann.
 */
export function seriesRuns(events: RunSource[], now: Date = new Date()): Map<string, SeriesRun> {
  const starts = new Map<string, Map<string, string>>();
  const upcoming = (performance: { start: string; end?: string }) =>
    Date.parse(performance.end ?? performance.start) >= now.getTime();

  for (const event of events) {
    const key = seriesKey(event);
    const members = starts.get(key) ?? new Map<string, string>();
    starts.set(key, members);
    for (const performance of [event, ...(event.relatedPerformances ?? [])]) {
      if (upcoming(performance)) members.set(performance.id, performance.start);
    }
  }

  const runs = new Map<string, SeriesRun>();
  for (const [key, members] of starts) {
    if (members.size === 0) continue;
    const last = [...members.values()].reduce((a, b) => (a > b ? a : b));
    runs.set(key, { count: members.size, last });
  }
  return runs;
}

/**
 * Termine derselben Reihe zusammengefasst – in der Reihenfolge, in der die
 * erste Aufführung jeder Reihe steht. Für Listen eines Tages: zwei
 * Vorstellungen am selben Tag sind eine Zeile mit zwei Uhrzeiten.
 */
export function groupBySeries<T extends Parameters<typeof seriesKey>[0]>(events: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const key = seriesKey(event);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }
  return [...groups.values()];
}

/**
 * Was in eine Zelle des Monats passt, wenn nicht alles hineinpasst.
 *
 * Vorrang hat, was ausdrücklich gezeigt werden soll (gewählt, verwandt),
 * dann das Seltene: ein Abend, den es nur einmal gibt, vor der vierzehnten
 * Vorstellung desselben Stücks. Gezeigt wird die Auswahl wieder in ihrer
 * zeitlichen Reihenfolge.
 */
export function pickForCell<T extends RunSource>(
  groups: T[][],
  max: number,
  runs: ReadonlyMap<string, SeriesRun>,
  preferred: (event: T) => boolean = () => false,
): { shown: T[][]; hidden: number } {
  if (groups.length <= max) return { shown: groups, hidden: 0 };
  const rank = (group: T[]) =>
    group.some(preferred) ? -1 : (runs.get(seriesKey(group[0]))?.count ?? 1);
  const chosen = groups
    .map((group, index) => ({ group, index, rank: rank(group) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.group);
  return { shown: chosen, hidden: groups.length - chosen.length };
}
