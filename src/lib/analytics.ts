/**
 * Umami – die selbst gehostete Zählung der Zugriffe.
 *
 * Bewusst eine eigene Datei ohne weitere Abhängigkeiten: die Werte werden auch
 * im Browser gebraucht, und `site.ts` zieht die Quellen-Registry nach.
 *
 * `ANALYTICS_DOMAINS` ist eine Erlaubnisliste im Browser: das Skript meldet
 * nur, wenn der Hostname darin steht. So bleiben lokale Läufe aus der
 * Statistik heraus.
 */
export const ANALYTICS_SCRIPT = 'https://umami.mirzapolat.com/script.js';
export const ANALYTICS_WEBSITE_ID = 'be5506d3-65af-439f-b2df-c4ac9d4ca158';
export const ANALYTICS_DOMAINS = 'hierausgehen.de,www.hierausgehen.de';

/**
 * Der Rekorder für Heatmaps (Klicks und Scrolltiefe je Seite) und
 * Sitzungsaufzeichnungen. Ob und wie dicht er aufzeichnet, entscheidet Umami:
 * das Skript fragt beim Start `/api/websites/<id>/recorder` und bleibt still,
 * solange die Aufzeichnung im Dashboard unter „Replays & Heatmaps" aus ist.
 *
 * Anders als `script.js` kennt der Rekorder keine `data-domains`, deshalb
 * prüft `AnalyticsRecorder` die Erlaubnisliste selbst.
 */
export const ANALYTICS_RECORDER_SCRIPT =
  'https://umami.mirzapolat.com/recorder.js';

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, unknown>) => void };
  }
}

/**
 * Ein Ereignis melden, das kein Klick auf einen Link ist – für Links genügt
 * `data-umami-event` am Element selbst.
 *
 * Bewusst stumm, wenn das Skript nicht geladen ist: lokal, bei blockierten
 * Skripten und im Server-Rendern soll die Oberfläche davon nichts merken.
 */
export function track(name: string, data?: Record<string, string | number | undefined>) {
  if (typeof window === 'undefined') return;

  // Fehlende Angaben werden nicht mitgeschickt – eine leere Eigenschaft wäre
  // in der Auswertung eine eigene Ausprägung und damit eine Behauptung.
  const known = data && Object.entries(data).filter(([, value]) => value !== undefined);
  window.umami?.track(name, known?.length ? Object.fromEntries(known) : undefined);
}
