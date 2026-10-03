/**
 * Wohin „Zurück zum Kalender" führt.
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
 * Nur Adressen des Kalenders selbst kommen in Frage. Wurde in den
 * Einstellungen die Stadt gewechselt, gilt die alte Adresse nicht mehr – sie
 * würde die eben gewählte Stadt wieder überschreiben.
 */
export function resolveReturnPath(stored: string | null, cityId: string): string {
  const fallback = `/?city=${encodeURIComponent(cityId)}`;
  if (!stored?.startsWith('/?')) return fallback;
  const params = new URLSearchParams(stored.slice(2));
  return params.get('city') === cityId ? stored : fallback;
}
