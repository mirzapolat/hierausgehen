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
  'Festival',
  'Kino',
  'Literatur',
  'Vortrag',
  'Netzwerk',
  'Ausstellung',
  'Führung',
  'Kultur',
  'Kinder & Familie',
  'Kulinarik',
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
  // Deutsche Oper am Rhein: die Sparte für junges Publikum.
  Oper: ['Opern', 'Opernabend', 'Musiktheater', 'Opera', 'Opera And Vocal', 'Junge Oper'],
  Operette: ['Singspiel'],
  Musical: ['Musicalshow', 'Musical Gala', 'Musicalgala', 'Musical Theatre'],
  Ballett: ['Tanztheater'],
  // „Tanz mit!": Kurse und offene Klassen des Balletts am Rhein.
  Tanz: ['Dance', 'Tanzen', 'Tanzshow', 'Tanzabend', 'Tanz mit!'],
  Theater: [
    'Schauspiel',
    'Sprechtheater',
    'Commercial-Play',
    'Plays',
    'Drama',
    'JGPTheater',
    'Junges Theater',
    // Oldenburg: Sparten des Staatstheaters.
    'Junges Staatstheater',
    'Niederdeutsches Schauspiel',
    // D'haus: Sparten des Schauspielhauses (Stadt:Kollektiv ist die Bürgerbühne).
    'Junges Schauspiel',
    'Stadt:Kollektiv',
    // Benennt die Form, nicht die Gattung – an einem Theater meist Theater.
    'Gastspiel',
    // Theater Unikum: Komödie und Solostück sind dort Sprechtheater.
    'Komödie',
    'One-Woman-Show',
    'Spielzeiteröffnung',
  ],
  Performance: ['Performances'],
  Show: ['Show & Revue', 'Revue', 'Varieté', 'Varieteé', 'Zirkus', 'Bunter Abend', 'Lip Sync Battle'],
  Comedy: [
    'Kabarett',
    'Kabarett & Comedy',
    'Stand-up',
    'Stand-up-Comedy',
    'Improtheater',
    'Impro Theater',
    // Kulturetage: „Caveman“ und Horst Evers.
    'Theater-Comedy',
    'Comedy-Lesung',
  ],
  Konzert: [
    'Musik',
    'Live Music',
    'Livemusik',
    'Live-Musik',
    'Konzert-Show',
    'Mitsingkonzert',
    'Tribute-Konzert',
    'Sinfoniekonzert',
    'Kammerkonzert',
    'Liederabend',
    'Klassik',
    'Jazz',
    'Weltmusik',
    'Chor',
    'Concert',
    'Live-Konzert',
    'Benefizkonzert',
    'Familienkonzert',
    'Release Konzert',
    'Releasekonzert',
    'Open Stage',
    'Offenes Singen',
    // Wortlaut des Royal Conservatoire: es benennt die Sparte, nicht die Form.
    'Music',
    'Classical Music',
    'Contemporary Music',
    'Contemporary Music And Performance',
    'Traditional Music',
    'Junior Conservatoire',
  ],
  Party: [
    'Club',
    'Clubnacht',
    'Clubnight',
    'Club Night',
    'Clubday',
    'DJ',
    'DJ-Set',
    'Disco',
    'Auflegen',
    'Open Decks',
    'Live DJ',
    'Soundsystem',
    'Karaoke',
  ],
  Festival: ['PHRE Festival'],
  Kino: ['Film', 'Filmvorführung', 'Filmvorstellung', 'Open-Air-Kino', 'Kurzfilm'],
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
    'Poetry',
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
    'Werkstatt',
    'Talk',
    'Other Talks',
    'Podium',
    'Panel',
    'Infotainment',
    // Theaterpädagogik: Workshops, Jugendclubs, Gespräche.
    'Theatervermittlung',
    // zakk: Vorträge, Gespräche und Workshops der Rubrik.
    'Politik & Gesellschaft',
  ],
  Netzwerk: ['Networking', 'Vernetzung', 'Austausch'],
  Ausstellung: ['Ausstellungen', 'Installation', 'Exhibition'],
  // Haus- und Baudenkmalführungen: die Glasgower Häuser führen sie als eigene
  // Reihe, und im Kalender ist es eine eigene Art – kein Vortrag, kein Termin
  // "Sonstiges".
  Führung: ['Heritage Tours', 'Heritage Building Tours', 'Building Tours', 'Guided Tour', 'Tour', 'Rundgang', 'Hausführung'],
  // Sammelbegriff für Häuser, die zu ihren Terminen gar keine Gattung führen
  // und deren Programm quer über Konzert, Bühne und Ausstellung läuft.
  // „Sparte 7“ (Staatstheater Oldenburg) ist so ein Programm: Diskursabende,
  // Bingo, Experimente – quer durch alle Formen.
  // „Wort & Bühne" (zakk) ohne Genre-Schlagwort: Lesung, Kabarett und Slam in
  // einer Rubrik – trägt das Schlagwort mehr, gewinnt es vorher.
  Kultur: ['Arts, Music and Culture', 'Arts', 'Culture', 'Sparte 7', 'Wort & Bühne'],
  'Kinder & Familie': [
    'Kinder',
    'Familie',
    'Kind & Co',
    'Kinderprogramm',
    'Familienprogramm',
    'Family',
    // Die britische Weihnachtspantomime ist Familientheater mit Musik und
    // Mitmachen – nicht die stumme Kunst, die das deutsche Wort meint.
    'Pantomime',
  ],
  Kulinarik: ['Essen', 'Küche', 'Kochen'],
  Wettbewerb: ['Wettbewerbe', 'Preisverleihung'],
  // "Other" ist der Auffangkorb der Trafalgar-Plattform für alles, was in
  // keine ihrer Gattungen passt – dasselbe, was hier "Sonstiges" heisst.
  Sonstiges: ['Extra', 'Plus Event', 'Sonstige', 'Special', 'Spezial', 'Veranstaltung', 'Event', 'Other'],
};

const BY_KEY = new Map<string, EventCategory>();
for (const category of CATEGORIES) {
  BY_KEY.set(categoryKey(category), category);
  for (const synonym of SYNONYMS[category]) BY_KEY.set(categoryKey(synonym), category);
}

/**
 * Die Formulierung einer Quelle auf eine Veranstaltungsart bringen.
 *
 * Zusammengesetzte Angaben ("Konzert / Weltmusik", "Konzert, DJ, Kulinarik",
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

/**
 * Die Art, die ein einzelnes Wort oder eine kurze Wendung benennt – ohne
 * Aufteilen und ohne Rückfall auf den Wortlaut. Für die Suche: „Konzerte",
 * „Live Music" und „Kabarett" sind Arten, „Rattle" ist keine.
 */
export function lookupCategory(text: string): EventCategory | undefined {
  return BY_KEY.get(categoryKey(text));
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

/**
 * Zusammengesetzte Angaben zerlegen – "und" trennt nicht, "/", "|", "," und
 * "+" schon. Häuser, die den Abend mit mehreren Stichworten beschreiben
 * ("Konzert, DJ, Kulinarik", "Konzert + DJ"), meinen damit eine Aufzählung,
 * keinen eigenen Namen.
 */
function splitCategory(raw: string): string[] {
  return clean(decodeEntities(raw))
    .split(/\s*[/|·•;,]\s*|\s+\+\s+|\s+–\s+|\s+-\s+/)
    .map((part) => clean(part))
    .filter(Boolean);
}
