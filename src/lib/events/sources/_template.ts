/**
 * VORLAGE FÜR EINE NEUE QUELLE
 * ----------------------------
 * Kopieren nach `src/lib/events/sources/<quelle>/index.ts` (+ `parse.ts`,
 * `parse.test.ts`, `__fixtures__/`), ausfüllen und in `registry.ts` eintragen.
 * Mehr ist nicht nötig: Datenmodell, Kalender und UI bleiben unverändert.
 *
 * Reihenfolge, die sich bewährt hat:
 *  1. Im Browser die Netzwerk-Requests des Spielplans ansehen. Fast jede
 *     Theaterseite lädt ihre Termine über einen eigenen Endpunkt (JSON oder
 *     HTML-Fragment) – der ist stabiler als die gerenderte Seite.
 *  2. Eine echte Antwort als Fixture unter `__fixtures__/` ablegen.
 *  3. Parser als reine Funktion (HTML/JSON -> CalendarEvent[]) schreiben und
 *     gegen die Fixture testen. Nur der Parser kennt das Fremdformat.
 *  4. Hier drumherum das Laden, den Zeitraum und die Fehlerfälle regeln.
 */

import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../types.ts';
import { fetchText } from '../http.ts';
import { berlinIso } from '../time.ts';
import { enrichEventDescriptions } from './detail.ts';

const BASE = 'https://example.com';

export const templateSource: EventSource = {
  definition: {
    id: 'template', // eindeutig, kleingeschrieben; Teil der Event-ID
    name: 'Beispielhaus',
    cityId: 'muenchen', // muss in `src/lib/cities.ts` existieren
    group: 'Theater', // Ordner in der Sidebar; er bestimmt auch die Farbe
    defaultCategory: 'Theater', // Fallback, wenn ein Termin keine eigene Gattung liefert
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const html = await fetchText(`${BASE}/spielplan?from=${range.from}&to=${range.to}`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const events = parse(html);

    // Antwort ohne erkennbare Termine heisst in der Regel: Layout geändert.
    // Werfen ist hier richtig – die Aggregation liefert dann den Cache aus
    // und meldet die Quelle als veraltet, statt still nichts anzuzeigen.
    if (events.length === 0 && html.length > 2000) {
      throw new Error('Kein Termin erkannt (Layout geändert?)');
    }

    const filtered = events.filter(
      (e) => e.start.slice(0, 10) >= range.from && e.start.slice(0, 10) <= range.to,
    );
    return enrichEventDescriptions({
      sourceId: 'template',
      events: filtered,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      // Falls Termin-URLs eine Vorstellungs-ID enthalten, hier auf die
      // Produktionsseite normalisieren, damit dieselbe Seite nur einmal lädt.
      cacheKey: (event) => event.url,
    });
  },
};

function parse(html: string): CalendarEvent[] {
  void html; // In der echten Quelle wird hier geparst.
  // Beispielhafte Abbildung – in der echten Quelle nach `parse.ts` auslagern.
  const example: CalendarEvent = {
    id: 'template:12345', // `${sourceId}:${stabile ID der Quelle}`
    sourceId: 'template',
    title: 'Titel',
    subtitle: 'Autor oder Ensemble',
    description: 'Kurzinfo oder Programmtext aus der Quelle.',
    // Wortlaut der Quelle, nicht übersetzt – `categories.ts` vereinheitlicht
    // das anschliessend („Schauspiel" wird zu „Theater").
    category: 'Schauspiel',
    start: berlinIso('2026-09-01', 19, 30),
    allDay: false,
    venue: { name: 'Grosses Haus', city: 'München' },
    availability: 'available', // available | limited | soldout | not_on_sale | unknown
    availabilityLabel: 'Karten verfügbar',
    ticketUrl: `${BASE}/tickets/12345`,
    url: `${BASE}/stuecke/12345`,
    notes: ['Preise: 15–65 €'],
  };
  return [example];
}

function parseDetailDescription(html: string): string | undefined {
  void html;
  return undefined;
}
