/**
 * Wohin „Zurück" auf Einstellungen, Merkliste und Impressum führt – zum
 * Kalender oder zur Suche, je nachdem, woher man kam.
 *
 * Der Kalender trägt Ansicht, Tag und offenen Termin in der Adresse. Wer die
 * Einstellungen öffnet, soll genau dorthin zurückkommen – nicht auf die
 * Startseite mit dem heutigen Monat. Die Adresse wird deshalb beim Öffnen
 * gemerkt (nur für diesen Tab) und beim Zurückgehen wieder gelesen.
 */

const KEY = 'hierausgehen.returnTo';

/** Vor dem Wechsel in die Einstellungen aufrufen. */
export function rememberReturn(): void {
  try {
    sessionStorage.setItem(KEY, `${window.location.pathname}${window.location.search}`);
  } catch {
    // Ohne Speicher führt der Weg zurück eben auf den Kalender der Stadt.
  }
}

export function returnPath(cityId: string): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(KEY);
  } catch {
    // siehe oben
  }
  return resolveReturnPath(stored, cityId);
}

/**
 * Nur Adressen von Kalender und Suche kommen in Frage. Wurde in den
 * Einstellungen die Stadt gewechselt, gilt eine alte Kalenderadresse nicht
 * mehr – sie würde die eben gewählte Stadt wieder überschreiben. Die Suche
 * gleicht die Stadt beim Öffnen selbst ab; ihre Adresse samt Anfrage bleibt.
 */
export function resolveReturnPath(stored: string | null, cityId: string): string {
  const fallback = `/calendar?city=${encodeURIComponent(cityId)}`;
  if (stored && isSearchPath(stored)) return stored;
  if (!stored?.startsWith('/calendar?')) return fallback;
  const params = new URLSearchParams(stored.slice('/calendar?'.length));
  return params.get('city') === cityId ? stored : fallback;
}

/** Führt der Weg zurück auf die Suche (statt in den Kalender)? */
export function isSearchPath(path: string): boolean {
  return path === '/search' || path.startsWith('/search?');
}
