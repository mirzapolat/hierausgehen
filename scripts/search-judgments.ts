import type { CalendarEvent } from '../src/lib/events/types.ts';
import { priceOf, isKidFriendly } from '../src/lib/search/document.ts';

/**
 * Bewertete Anfragen für `npm run search:eval`.
 *
 * Statt fester Termin-IDs steht je Anfrage eine Regel, wie gut ein Termin
 * passt (0 = nicht, 1 = verwandt, 2 = gut, 3 = genau das). So bleibt die
 * Liste gültig, wenn der Demo-Abzug erneuert wird – die Regeln beschreiben,
 * was gesucht war, nicht, was am Tag des Abzugs im Programm stand.
 *
 * Die Gruppen (`kind`) trennen, was die Bedeutungssuche verbessern soll
 * (`vague`) von dem, was sie nicht verschlechtern darf (alles andere).
 */

export interface Context {
  /** Tag in der Zeitzone der Stadt. */
  day: (event: CalendarEvent) => string;
  /** Minuten seit Mitternacht in der Zeitzone der Stadt. */
  minutes: (event: CalendarEvent) => number;
  today: string;
  addDays: (day: string, amount: number) => string;
  /** Wochentag, 1 = Montag … 7 = Sonntag. */
  weekday: (day: string) => number;
}

export interface Judgment {
  query: string;
  kind: 'name' | 'typo' | 'browse' | 'facet' | 'english' | 'vague';
  grade: (event: CalendarEvent, context: Context) => number;
}

const head = (e: CalendarEvent) => [e.title, e.subtitle].filter(Boolean).join(' ');
const all = (e: CalendarEvent) => [e.title, e.subtitle, e.categoryLabel, e.description, ...(e.notes ?? [])].join(' ');
const named = (pattern: RegExp) => (e: CalendarEvent) => (pattern.test(head(e)) ? 3 : pattern.test(all(e)) ? 2 : 0);
const evening = (e: CalendarEvent, c: Context) => !e.allDay && c.minutes(e) >= 17 * 60;
const free = (e: CalendarEvent) => priceOf(e).free;
const unknownPrice = (e: CalendarEvent) => !priceOf(e).free && priceOf(e).min === undefined;

/** Kommendes Wochenende relativ zu „heute" (Sa/So; am Wochenende der Rest). */
function weekendDays(c: Context): string[] {
  const day = c.weekday(c.today);
  if (day >= 6) return day === 6 ? [c.today, c.addDays(c.today, 1)] : [c.today];
  return [c.addDays(c.today, 6 - day), c.addDays(c.today, 7 - day)];
}

function nextWeek(c: Context): [string, string] {
  const monday = c.addDays(c.today, 8 - c.weekday(c.today));
  return [monday, c.addDays(monday, 6)];
}

function nextWeekday(c: Context, target: number): string {
  return c.addDays(c.today, (target - c.weekday(c.today) + 7) % 7);
}

export const judgments: Judgment[] = [
  // Namen
  { query: 'simon rattle', kind: 'name', grade: named(/Rattle/) },
  { query: 'mahler', kind: 'name', grade: named(/Mahler/) },
  { query: 'beethoven', kind: 'name', grade: named(/Beethoven/) },
  { query: 'zauberflöte', kind: 'name', grade: named(/Zauberfl/i) },
  { query: 'theater mit simon rattle', kind: 'name', grade: named(/Rattle/) },
  { query: 'unterfahrt', kind: 'name', grade: (e) => (e.sourceId === 'unterfahrt' ? 3 : 0) },

  // Tippfehler
  { query: 'ratle', kind: 'typo', grade: named(/Rattle/) },
  { query: 'beethofen', kind: 'typo', grade: named(/Beethoven/) },
  { query: 'zauberflote', kind: 'typo', grade: named(/Zauberfl/i) },

  // Stöbern nach Art und Zeit
  {
    query: 'konzerte nächste woche',
    kind: 'browse',
    grade: (e, c) => {
      const [from, to] = nextWeek(c);
      if (c.day(e) < from || c.day(e) > to) return 0;
      return e.category === 'Konzert' ? 3 : /konzert/i.test(e.category ?? '') ? 1 : 0;
    },
  },
  {
    query: 'oper im dezember',
    kind: 'browse',
    grade: (e, c) => {
      if (c.day(e).slice(0, 7) !== `${c.today.slice(0, 4)}-12`) return 0;
      return e.category === 'Oper' ? 3 : e.category === 'Operette' ? 2 : 0;
    },
  },
  { query: 'musical', kind: 'browse', grade: (e) => (e.category === 'Musical' ? 3 : 0) },
  { query: 'lesung', kind: 'browse', grade: (e) => (e.category === 'Literatur' ? 3 : 0) },
  { query: 'für kinder', kind: 'browse', grade: (e) => (isKidFriendly(e) ? 3 : 0) },
  {
    query: 'kindertheater',
    kind: 'browse',
    grade: (e) => (e.category === 'Kindertheater' ? 3 : isKidFriendly(e) ? 2 : 0),
  },
  {
    query: 'party freitag nacht',
    kind: 'browse',
    grade: (e, c) => {
      const friday = nextWeekday(c, 5);
      const night = c.day(e) === friday && c.minutes(e) >= 21 * 60;
      const early = c.day(e) === c.addDays(friday, 1) && c.minutes(e) < 5 * 60;
      return (night || early) && e.category === 'Party' ? 3 : 0;
    },
  },
  { query: 'tanzen gehen', kind: 'browse', grade: (e) => (e.category === 'Tanz' ? 3 : e.category === 'Party' ? 2 : 0) },

  // Angaben zu Preis, Zeit, Karten
  {
    query: 'kostenlos heute abend',
    kind: 'facet',
    grade: (e, c) => (c.day(e) !== c.today || !evening(e, c) ? 0 : free(e) ? 3 : unknownPrice(e) ? 1 : 0),
  },
  {
    query: 'jazz unter 20 euro',
    kind: 'facet',
    grade: (e) => {
      if (!/jazz/i.test(all(e))) return 0;
      const price = priceOf(e);
      return price.free || (price.min !== undefined && price.min <= 20) ? 3 : price.min === undefined ? 2 : 0;
    },
  },
  {
    query: 'konzert unter 15 €',
    kind: 'facet',
    grade: (e) => {
      if (e.category !== 'Konzert') return 0;
      const price = priceOf(e);
      return price.free || (price.min !== undefined && price.min <= 15) ? 3 : price.min === undefined ? 1 : 0;
    },
  },
  {
    query: 'noch karten oper',
    kind: 'facet',
    grade: (e) => {
      if (e.category !== 'Oper') return 0;
      if (e.availability === 'available' || e.availability === 'limited') return 3;
      return e.availability === 'unknown' ? 1 : 0;
    },
  },

  // Englisch
  {
    query: 'opera tomorrow',
    kind: 'english',
    grade: (e, c) => (c.day(e) === c.addDays(c.today, 1) && e.category === 'Oper' ? 3 : 0),
  },
  {
    query: 'concerts this weekend',
    kind: 'english',
    grade: (e, c) => (weekendDays(c).includes(c.day(e)) && e.category === 'Konzert' ? 3 : 0),
  },
  {
    query: 'free exhibitions',
    kind: 'english',
    grade: (e) => (e.category !== 'Ausstellung' ? 0 : free(e) ? 3 : unknownPrice(e) ? 1 : 0),
  },
  {
    query: 'stand-up comedy in english',
    kind: 'english',
    grade: (e) => (e.category !== 'Comedy' ? 0 : /english|englisch/i.test(all(e)) ? 3 : 2),
  },

  // Vage – hier soll die Bedeutungssuche helfen
  { query: 'für die kinder wenn es regnet', kind: 'vague', grade: (e) => (isKidFriendly(e) ? 3 : 0) },
  {
    query: 'gemütlicher jazz abend',
    kind: 'vague',
    grade: (e, c) => (!/jazz/i.test(all(e)) ? 0 : evening(e, c) ? 3 : 2),
  },
  {
    query: 'something romantic for a date',
    kind: 'vague',
    grade: (e, c) => {
      if (!evening(e, c)) return 0;
      if (/romant|liebe|love|candle|kerzen/i.test(all(e))) return 3;
      return ['Oper', 'Ballett', 'Tanz', 'Musical'].includes(e.category ?? '') ? 2 : 0;
    },
  },
  {
    query: 'was lustiges am freitag',
    kind: 'vague',
    grade: (e, c) => {
      if (c.day(e) !== nextWeekday(c, 5)) return 0;
      if (e.category === 'Comedy' || /komödie|comedy|lustig|humor|witzig|kabarett/i.test(all(e))) return 3;
      return e.category === 'Show' ? 2 : 0;
    },
  },
  {
    query: 'entspannter abend mit guter musik',
    kind: 'vague',
    grade: (e, c) => {
      if (!evening(e, c) || e.category !== 'Konzert') return 0;
      return /jazz|akustik|acoustic|kammer|singer|songwriter|klassik|lieder/i.test(all(e)) ? 3 : 2;
    },
  },
  {
    query: 'klassik mit klavier',
    kind: 'vague',
    grade: (e) => {
      if (e.category !== 'Konzert') return 0;
      if (/klavier|piano|pianist/i.test(all(e))) {
        return /klassik|sinfon|symphon|orchester|beethoven|mozart|brahms|schumann|chopin/i.test(all(e)) ? 3 : 2;
      }
      return /klassik|sinfon|symphon|orchester/i.test(all(e)) ? 1 : 0;
    },
  },
];
