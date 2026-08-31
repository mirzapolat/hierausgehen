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
  return text
    .split(/(\s+)/)
    .map((word) => (isShouted(word) ? soften(word) : word))
    .join('');
}

function isShouted(word: string): boolean {
  const letters = word.replace(/\P{L}/gu, '');
  return letters.length >= 3 && word === word.toLocaleUpperCase('de-DE');
}

function soften(word: string): string {
  return word
    .toLocaleLowerCase('de-DE')
    .replace(
      /(^|[\s(«"'„–-])(\p{L})/gu,
      (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('de-DE'),
    );
}
