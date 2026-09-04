import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { monthsInRange } from '../../time.ts';
import { enrichEventDescriptions } from '../detail.ts';
import {
  BASE,
  SOURCE_ID,
  monthUrl,
  parseDetailDescription,
  parseMonth,
  showKey,
} from './parse.ts';

/**
 * The Stand Comedy Club, Glasgow.
 *
 * Kellerclub an der Great Western Road: Tourneeprogramme, gemischte
 * Wochenendshows, Improvisiertes und „Red Raw", der wöchentliche Abend für
 * neues Material. Ein Saal, ein Abend je Karte.
 *
 *     GET https://www.thestand.co.uk/whats-on/glasgow/<monat>/<jahr>
 *     GET https://www.thestand.co.uk/performance/<id>/<stück>/<tag>/glasgow
 *
 * Die erste Adresse trägt den Spielplan vollständig – Beginn, Einlass,
 * Spieldauer, Auftretende und Ticketlage stehen schon in der Liste. Die
 * zweite steuert nur den langen Ankündigungstext bei und wird je **Stück**
 * geholt, nicht je Abend: „The Saturday Show" läuft wöchentlich mit demselben
 * Text.
 *
 * Der Club führt auch Häuser in Edinburgh und Newcastle; die Monatsseite
 * `/whats-on/glasgow/…` zeigt nur Glasgow.
 */

export const thestandGlasgow: EventSource = {
  definition: {
    id: SOURCE_ID,
    name: 'The Stand Glasgow',
    cityId: 'glasgow',
    group: 'Theater',
    // Die Karten führen keine eigene Gattung, und der Club braucht auch keine:
    // sein Programm ist Stand-up, gemischte Bills und Impro.
    defaultCategory: 'Comedy',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    const months = monthsInRange(range.from.slice(0, 7), range.to.slice(0, 7));

    const results = await Promise.allSettled(
      months.map(async (month) => {
        const html = await fetchText(monthUrl(month), {
          signal,
          timeoutMs: options?.requestTimeoutMs,
        });
        const parsed = parseMonth(html);
        // Ein leerer Monat ist eine Auskunft, keine kaputte Seite – die Quelle
        // schreibt sie selbst ins Markup. Fehlt dagegen das Monatsraster ganz,
        // ist der Aufbau geändert.
        if (!parsed.recognised) throw new Error(`${month}: kein Monatsraster (Layout geändert?)`);
        return parsed.events;
      }),
    );

    const events: CalendarEvent[] = [];
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failed++;
        console.warn(`[${SOURCE_ID}] ${months[index]}: ${message(result.reason)}`);
        return;
      }
      events.push(...result.value);
    });

    // Einzelne Lücken sind hinnehmbar; fällt jeder Monat aus, muss die Quelle
    // sich als kaputt melden, damit die Aggregation den Cache ausliefert.
    if (failed === months.length) {
      throw new Error(`Keine der ${months.length} Monatsseiten lesbar`);
    }

    const inRange = events.filter((event) => {
      const day = event.start.slice(0, 10);
      return day >= range.from && day <= range.to;
    });

    return enrichEventDescriptions({
      sourceId: SOURCE_ID,
      events: inRange,
      signal,
      fetchOptions: options,
      parseDescription: parseDetailDescription,
      // Der Text hängt am Stück: ein Abruf je Slug, nicht je Abend.
      cacheKey: (event) => showKey(event.url),
    });
  },
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default thestandGlasgow;
