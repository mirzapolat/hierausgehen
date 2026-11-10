/**
 * Klassik oder nicht? – das Konzert genauer bestimmen.
 *
 * Die meisten Häuser schreiben an jeden Abend nur „Konzert“; ob dort ein
 * Sinfonieorchester spielt oder eine Indieband, sagt die Gattung nicht. Für
 * den Kalender ist das aber der Unterschied, nach dem gefiltert wird. Deshalb
 * wird ein Termin, der auf „Konzert“ fällt, hier noch einmal angesehen – in
 * dieser Reihenfolge:
 *
 * 1. **Das Haus.** `SourceDefinition.concerts` sagt, was ein Haus in der
 *    Regel spielt. Ein Jazzclub nennt in seinen Texten gern Bach oder
 *    „klassisch ausgebildet“, ein Opernhaus spielt Klassik, auch wenn der
 *    Titel nur „Porträtkonzert“ heisst. Clubs bleiben deshalb ungeprüft beim
 *    Konzert; Häuser der Klassik bleiben bei Klassik, solange der Titel nicht
 *    ausdrücklich etwas anderes sagt („HSO meets Jazz“).
 * 2. **Der Titel.** Für Häuser mit gemischtem Programm (Gasteig,
 *    MünchenMusik) zählt, was im Titel oder Untertitel steht: Gattung,
 *    Klangkörper, Besetzung, Komponist. Popzeichen im Titel gewinnen, damit
 *    Filmmusik „in Concert“ nicht zur Klassik wird, nur weil ein Orchester
 *    spielt.
 * 3. **Der Text.** Erst wenn der Titel schweigt, entscheidet die
 *    Beschreibung – und nur, wenn darin kein Popzeichen steht.
 *
 * Bleibt kein Zeichen, bleibt es beim Konzert. Lieber ein klassischer Abend
 * unter „Konzert“ als ein Popkonzert unter „Klassik“.
 */

import type { CalendarEvent, SourceDefinition } from './types.ts';

/** Gattung, Klangkörper, Besetzung und Namen, die es fast nur in der Klassik gibt. */
const CLASSICAL = words([
  // Gattungen und Formen
  // Auch mitten im Wort: „Hochschulsymphonieorchester“.
  '\\w*sinfoni\\w*',
  '\\w*symphoni\\w*',
  'philharmoni\\w*',
  'filharmoni\\w*',
  'kammermusik\\w*',
  'kammerkonzert\\w*',
  'kammeroper',
  'streichquartett\\w*',
  'klavierquartett\\w*',
  'klaviertrio\\w*',
  'klavierabend\\w*',
  'klavierrecital',
  'klavierrezital',
  'klavierduo',
  'klavierkonzert\\w*',
  'violinkonzert\\w*',
  'recital',
  'rezital',
  'neue musik',
  'liederabend\\w*',
  'arienabend\\w*',
  'oratori\\w*',
  'requiem',
  'kantate\\w*',
  'passion\\w*',
  'orgel\\w*',
  'cembalo',
  'barock\\w*',
  'klassik',
  'akademiekonzert\\w*',
  'themenkonzert\\w*',
  'musica viva',
  'operngala',
  'carmina burana',
  'urauffuhrung\\w*',
  // Klangkörper
  'chamber orchestra',
  'festival orchestra',
  'symphony orchestra',
  'philharmonic',
  'orkester',
  'kammerorchester',
  'kammerchor',
  'rundfunkorchester',
  'rundfunkchor',
  'jugendorchester',
  'orchesterkonzert\\w*',
  'opernstudio\\w*',
  // Besetzungsangaben, wie Programme sie schreiben: „(Klavier)“, „Leitung“
  'leitung',
  'dirigent\\w*',
  'violine',
  'violoncello',
  'sopran',
  'mezzosopran',
  'bariton',
  // Komponisten, die ein Titel allein trägt
  'bach',
  'mozart',
  'beethoven',
  'brahms',
  'schubert',
  'schumann',
  'haydn',
  'handel',
  'vivaldi',
  'bruckner',
  'mahler',
  'tschaikowsk\\w*',
  'tchaikovsk\\w*',
  'chopin',
  'liszt',
  'dvorak',
  'debussy',
  'ravel',
  'rachmaninow\\w*',
  'schostakowitsch',
  'prokofjew',
  'sibelius',
  'mendelssohn',
  'telemann',
  'monteverdi',
  'purcell',
  'arvo-?\\s?part',
]);

/**
 * Zeichen für alles andere: Genres, Mitsing- und Filmformate, Tribute-Shows.
 * Steht eines im Titel, ist es kein Abend für den Klassikfilter – auch wenn
 * ein Orchester mitspielt.
 */
const POPULAR = words([
  'jazz\\w*',
  'rock',
  'pop',
  'punk',
  'metal',
  'hip ?hop',
  'rap',
  'indie',
  'soul',
  'funk',
  'blues',
  'techno',
  'electro\\w*',
  'tribute',
  'dj',
  'singer-songwriter',
  'swing',
  'bigband',
  'big band',
  'reggae',
  'ska',
  'schlager',
  'gospel',
  'musical',
  'filmmusik',
  'in concert',
  'live to film',
  'originalfilm',
  'movie',
  'anime',
  'videospiel\\w*',
  'game\\w*',
  'meets',
  'crossover',
  'tour',
  'live 20\\d\\d',
  'abba',
  'queen',
  'beatles',
  'candlelight',
  'rudelsingen',
  'mitsing\\w*',
  'wirtshausmusik',
  'volksmusik',
]);

/**
 * `Klassik`, wenn das Konzert erkennbar eines ist, sonst `Konzert`.
 * Aufgerufen nur für Termine, deren Art schon „Konzert“ ist.
 */
export function concertKind(
  event: Pick<CalendarEvent, 'title' | 'subtitle' | 'description'>,
  label: string | undefined,
  definition?: Pick<SourceDefinition, 'concerts'>,
): 'Klassik' | 'Konzert' {
  const prior = definition?.concerts;
  if (prior === 'Konzert') return 'Konzert';

  // Auch der Wortlaut der Quelle zählt mit: „Jazz“ fällt auf Konzert und
  // soll dort bleiben.
  const head = fold(`${event.title} ${event.subtitle ?? ''} ${label ?? ''}`);
  if (POPULAR.test(head)) return 'Konzert';
  if (prior === 'Klassik' || CLASSICAL.test(head)) return 'Klassik';

  const body = fold(event.description ?? '');
  return CLASSICAL.test(body) && !POPULAR.test(body) ? 'Klassik' : 'Konzert';
}

function words(list: string[]): RegExp {
  return new RegExp(`\\b(?:${list.join('|')})\\b`);
}

/** Kleinschreibung ohne Akzente – „Dvořák“ wie „Dvorak“, „Pärt“ wie „Part“. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase('de-DE')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}
