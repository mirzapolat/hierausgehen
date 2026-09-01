/**
 * Veranstaltungsarten – eine Sprache für alle Quellen.
 *
 * Jede Website benennt ihre Gattungen anders: "Musik", "Live Music" und
 * "Konzerte" meinen dasselbe, "Kinder &amp; Familie" schleppt eine Entity mit,
 * und das Deutsche Theater führt Doppelungen wie "Konzert / Weltmusik". Als
 * Filter in der Seitenleiste ist das unbrauchbar – 57 Werte für ein Dutzend
 * Sachen.
 *
 * Deshalb: `normalizeCategory` bildet die Formulierung der Quelle auf einen
 * Wert aus `CATEGORIES` ab. Was nicht in der Liste steht, geht **nicht**
 * verloren, sondern wird zu einer eigenen, sauber geschriebenen Art – die
 * Breite bleibt, nur die Schreibweisen fallen zusammen. Der Originalwortlaut
 * steht weiter am Termin (`categoryLabel`).
 *
 * Eine neue Quelle braucht hier normalerweise nichts. Fällt beim Hinzufügen
 * eine Art an, die die Liste noch nicht kennt (`npm run categories` zeigt
 * das), gibt es zwei Möglichkeiten: sie ist eine Schreibweise einer
 * bestehenden Art – dann kommt sie unten als Synonym dazu; oder sie ist
 * wirklich neu – dann wird sie in `CATEGORIES` aufgenommen.
 */

import { clean, decodeEntities } from './text.ts';

/**
 * Der kanonische Wortschatz. Reihenfolge = Reihenfolge in der Seitenleiste,
 * grob von Bühne über Musik zu Wort und Sonstigem.
 */
export const CATEGORIES = [
  'Oper',
  'Operette',
  'Musical',
  'Ballett',
  'Tanz',
  'Theater',
  'Performance',
  'Show',
  'Comedy',
  'Konzert',
  'Party',
  'Kino',
  'Literatur',
  'Vortrag',
  'Ausstellung',
  'Kinder & Familie',
  'Wettbewerb',
  'Sonstiges',
] as const;

export type EventCategory = (typeof CATEGORIES)[number];

/** Wenn weder Termin noch Quelle etwas sagen. */
export const FALLBACK_CATEGORY: EventCategory = 'Sonstiges';

/**
 * Synonyme, nach kanonischer Art gruppiert.
 *
 * Geschrieben wird hier die lesbare Form; verglichen wird über `categoryKey`,
 * also ohne Rücksicht auf Gross-/Kleinschreibung, Bindestriche, Umlaute,
 * "&"/"und" und den Plural. "Konzerte", "KONZERT" und "konzert" brauchen
 * deshalb keinen eigenen Eintrag.
 */
const SYNONYMS: Record<EventCategory, string[]> = {
  Oper: ['Opern', 'Opernabend', 'Musiktheater'],
  Operette: ['Singspiel'],
  Musical: ['Musicalshow', 'Musical Gala', 'Musicalgala'],
  Ballett: ['Tanztheater'],
  Tanz: ['Dance', 'Tanzen', 'Tanzshow', 'Tanzabend'],
  Theater: ['Schauspiel', 'Sprechtheater', 'Commercial-Play', 'JGPTheater', 'Junges Theater'],
  Performance: ['Performances'],
  Show: ['Show & Revue', 'Revue', 'Varieté', 'Varieteé', 'Zirkus'],
  Comedy: ['Kabarett', 'Kabarett & Comedy', 'Stand-up', 'Stand-up-Comedy', 'Improtheater'],
  Konzert: [
    'Musik',
    'Live Music',
    'Livemusik',
    'Live-Musik',
    'Konzert-Show',
    'Tribute-Konzert',
    'Sinfoniekonzert',
    'Kammerkonzert',
    'Liederabend',
    'Klassik',
    'Jazz',
    'Weltmusik',
    'Chor',
  ],
  Party: ['Club', 'Clubnacht', 'DJ', 'DJ-Set', 'Disco'],
  Kino: ['Film', 'Filmvorführung', 'Open-Air-Kino', 'Kurzfilm'],
  Literatur: [
    'Lesung',
    'Szenische Lesung',
    'Musikalische Lesung',
    'Buch',
    'Buchpräsentation',
    'Buchpräsentation mit Gespräch',
    'Poetry & Readings',
    'Poetry Slam',
    'Slam',
    'Live-Hörspiel',
    'Hörspiel',
  ],
  Vortrag: [
    'Vortrag & Konferenz',
    'Konferenz',
    'Tagung',
    'Diskussion',
    'Podiumsdiskussion',
    'Gespräch',
    'Podcast',
    'Live-Podcast',
    'Einführung',
    'Einführungsmatinee',
    'Matinee',
    'Symposium',
    'Workshop',
  ],
  Ausstellung: ['Ausstellungen', 'Installation'],
  'Kinder & Familie': ['Kinder', 'Familie', 'Kind & Co', 'Kinderprogramm', 'Familienprogramm'],
  Wettbewerb: ['Wettbewerbe', 'Preisverleihung'],
  Sonstiges: ['Extra', 'Plus Event', 'Sonstige', 'Special', 'Spezial', 'Veranstaltung', 'Event'],
};

const BY_KEY = new Map<string, EventCategory>();
for (const category of CATEGORIES) {
  BY_KEY.set(categoryKey(category), category);
  for (const synonym of SYNONYMS[category]) BY_KEY.set(categoryKey(synonym), category);
}

/**
 * Die Formulierung einer Quelle auf eine Veranstaltungsart bringen.
 *
 * Zusammengesetzte Angaben ("Konzert / Weltmusik", "Konzert | Musical Gala",
 * "Lesung & Podcast") werden aufgeteilt; es gewinnt der erste Teil, den der
 * Wortschatz kennt.
 * Kennt er keinen, bleibt der erste Teil in seiner Schreibweise stehen – eine
 * neue Art. Leere Angaben ergeben `undefined`, nicht "Sonstiges": ob daraus
 * der Quellen-Fallback wird, entscheidet die Normalisierung.
 */
export function normalizeCategory(raw: string | undefined): string | undefined {
  const parts = splitCategory(raw ?? '');
  if (parts.length === 0) return undefined;

  for (const part of parts) {
    const known = BY_KEY.get(categoryKey(part));
    if (known) return known;
  }

  // Erst jetzt "&"/"und" auftrennen: "Kinder & Familie" und "Show & Revue"
  // sind eigene Arten und dürfen nicht vorher zerfallen. Was danach noch
  // übrig ist ("Lesung & Podcast", "Oper & Ballett"), führt sein erstes
  // bekanntes Glied.
  for (const part of parts) {
    for (const half of part.split(/\s*(?:&|\bund\b)\s*/)) {
      const known = BY_KEY.get(categoryKey(half));
      if (known) return known;
    }
  }

  return parts[0];
}

/** Ist der Wert Teil des kanonischen Wortschatzes? */
export function isKnownCategory(value: string): value is EventCategory {
  return BY_KEY.get(categoryKey(value)) === value;
}

/**
 * Vergleichsform: Kleinschreibung, ohne Akzente, "&" als "und", ohne
 * Trennzeichen – und ohne Plural-Endung, damit "Konzerte" auf "Konzert"
 * fällt.
 */
export function categoryKey(text: string): string {
  const folded = decodeEntities(text)
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return folded.replace(/\b(\w{4,}?)(en|er|e|n|s)\b/g, '$1');
}

/** Zusammengesetzte Angaben zerlegen – "und" trennt nicht, "/" und "|" schon. */
function splitCategory(raw: string): string[] {
  return clean(decodeEntities(raw))
    .split(/\s*[/|·•;]\s*|\s+–\s+|\s+-\s+/)
    .map((part) => clean(part))
    .filter(Boolean);
}
