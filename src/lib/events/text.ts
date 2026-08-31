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
