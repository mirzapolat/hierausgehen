/** Kleine Textwerkzeuge, die mehrere Adapter brauchen. */

/** Mehrfache Leerzeichen und Zeilenumbrüche auf ein Leerzeichen bringen. */
export function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Versalien glätten – wortweise, nicht nur wenn der ganze Titel schreit.
 *
 * Viele Spielpläne setzen Titel oder einzelne Wörter in Grossbuchstaben
 * ("ILLUSIONEN - WIE SCHWANENSEE (Gastspiel in Baden-Baden)"). Kurze Kürzel
 * wie BR oder TV bleiben stehen.
 */
export function softenShouted(text: string): string {
  const parts = text.split(/(\s+)/);
  const shouted = parts.map(isShouted);
  return parts
    .map((word, index) =>
      shouted[index] || (isUpper(word) && (shouted[index - 2] || shouted[index + 2]))
        ? soften(word)
        : word,
    )
    .join('');
}

function isShouted(word: string): boolean {
  return letterCount(word) >= 3 && isUpper(word);
}

/**
 * Kurze Grossschreibungen bleiben für sich stehen (BR, TV) – innerhalb einer
 * schreienden Zeile gehören sie aber dazu ("FACK JU GÖHTE").
 */
function isUpper(word: string): boolean {
  return letterCount(word) > 0 && word === word.toLocaleUpperCase('de-DE');
}

function letterCount(word: string): number {
  return word.replace(/\P{L}/gu, '').length;
}

function soften(word: string): string {
  return word
    .toLocaleLowerCase('de-DE')
    .replace(
      /(^|[\s(«"'„–-])(\p{L})/gu,
      (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('de-DE'),
    );
}

/**
 * HTML-Entities auflösen.
 *
 * Nötig überall dort, wo ein Adapter Markup selbst aufräumt (Tags per Regex
 * entfernen) statt den Text über cheerio zu holen – sonst steht am Ende
 * "Kabarett &amp; Comedy" im Datenmodell.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X'))
      return codePoint(parseInt(entity.slice(2), 16), match);
    if (entity.startsWith('#')) return codePoint(parseInt(entity.slice(1), 10), match);
    return NAMED_ENTITIES[entity] ?? match;
  });
}

// Namen werden buchstabengetreu nachgeschlagen: &Auml; ist nicht &auml;.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  lsquo: '‘',
  rsquo: '’',
  euro: '€',
  copy: '©',
  reg: '®',
  deg: '°',
  szlig: 'ß',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
};

function codePoint(value: number, fallback: string): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}
