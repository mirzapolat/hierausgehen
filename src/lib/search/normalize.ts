/**
 * Textaufbereitung für die Suche – für Index und Anfrage dieselbe.
 *
 * Gefaltet wird so, dass „München", „Muenchen" und „MÜNCHEN" dasselbe Wort
 * sind: Umlaute werden zu ae/oe/ue (nicht zu a/o/u – sonst fielen „schon" und
 * „schön" zusammen), ß zu ss, übrige Akzente fallen weg. Gestemmt wird
 * absichtlich nur leicht: ein paar Endungen des Deutschen und Englischen.
 * Ein aggressiver Stemmer verschmilzt Namen, und Namen sind hier das
 * Wichtigste, wonach gesucht wird.
 */

export function fold(text: string): string {
  return text
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** Wörter eines Textes, gefaltet, ohne Satzzeichen – in ihrer Reihenfolge. */
export function words(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Wie `words`, dazu die zusammengeschriebene Form jedes Bindestrich-Worts:
 * „Jazz-Konzert" findet sich so unter „jazz", „konzert" und „jazzkonzert".
 * Für den Index; die Anfrage sucht über Präfix und Wortende ohnehin in
 * zusammengesetzte Wörter hinein.
 */
export function indexWords(text: string): string[] {
  const out = words(text);
  for (const match of fold(text).matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/g)) {
    out.push(match[0].replace(/-/g, ''));
  }
  return out;
}

const SUFFIXES = ['ungen', 'ung', 'ing', 'ern', 'em', 'en', 'er', 'es', 'e', 's'];
const MIN_STEM = 4;

/** Leichter Stamm: eine Endung ab, wenn danach noch genug Wort bleibt. */
export function stem(word: string): string {
  if (word.length <= MIN_STEM || /\d/.test(word)) return word;
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/** Gestemmte Begriffe eines Textes – so, wie der Index sie führt. */
export function terms(text: string): string[] {
  return indexWords(text).map(stem);
}

/**
 * Füllwörter einer Anfrage. Gilt nur für die Anfrage – im Index stören sie
 * nicht, weil BM25 sie über die Dokumenthäufigkeit ohnehin abwertet.
 *
 * Nicht dabei sind Wörter, die eine Art benennen („Show"): die gehören dem
 * Parser, nicht dem Papierkorb.
 */
export const STOPWORDS = new Set([
  // Deutsch
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'in', 'im', 'am', 'an', 'auf', 'mit', 'fuer', 'von', 'vom', 'zu', 'zum', 'zur',
  'bei', 'beim', 'nach', 'ueber', 'aus', 'ist', 'sind', 'es', 'wenn', 'was', 'wo', 'wie', 'gibt',
  'etwas', 'irgendwas', 'irgendwo', 'ich', 'mir', 'mich', 'wir', 'uns', 'du', 'man', 'fur',
  'suche', 'suchen', 'zeig', 'zeige', 'moechte', 'will', 'wollen', 'gerne', 'gern', 'bitte',
  'veranstaltung', 'veranstaltungen', 'termin', 'termine', 'events', 'event', 'sachen', 'sache',
  'ausgehen', 'hingehen', 'gehen', 'unternehmen', 'machen', 'so', 'ganz', 'sehr', 'mal', 'noch',
  'auch', 'nur', 'da', 'dort', 'hier', 'jetzt', 'kann', 'koennen', 'man', 'welche', 'welcher',
  'gut', 'gute', 'guter', 'gutes', 'guten', 'schoen', 'schoene', 'schoener', 'schoenes', 'schoenen',
  'nett', 'nette', 'netter', 'nettes', 'netten', 'toll', 'tolle', 'toller', 'tolles', 'tollen', 'cool',
  'coole', 'cooles', 'coolen', 'einen', 'irgendetwas', 'heute', 'good', 'great', 'nice', 'awesome',
  // Englisch
  'the', 'a', 'an', 'and', 'or', 'of', 'on', 'at', 'for', 'with', 'to', 'from', 'by', 'is', 'are',
  'it', 'when', 'what', 'where', 'how', 'any', 'me', 'my', 'i', 'we', 'us', 'you', 'this', 'that',
  'these', 'those', 'find', 'looking', 'want', 'something', 'anything', 'some', 'things', 'thing',
  'stuff', 'go', 'going', 'out', 'do', 'please', 'there', 'here', 'happening', 'its', 'be', 'can',
  'should', 'would', 'like', 'which', 'whats', 'on',
]);

/** Editierabstand mit Obergrenze – bricht ab, sobald sie überschritten ist. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}
