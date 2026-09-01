import type { CalendarEvent, EventFetchOptions, EventSource, FetchRange } from '../../types.ts';
import { fetchText } from '../../http.ts';
import { TZ } from '../../time.ts';
import { parseProgrammePage } from './parse.ts';

/**
 * Werkstattkino – Programmkino im Keller der Fraunhoferstrasse 9.
 *
 * Hier gibt es nichts zu holen ausser der Startseite: Das Kino pflegt weder
 * Kalender noch Ticketsystem, die WordPress-Installation kennt genau eine
 * Seite "Programm" (die Startseite) mit dem Programm als Fliesstext. Frühere
 * Fassungen liegen als "Programm (alt)" daneben – die Seiten-ID wandert also,
 * die Startseite nicht. Deshalb wird sie und nicht die REST-Schnittstelle
 * gelesen.
 *
 * Damit fehlt auch ein Parameter für den Zeitraum: die Seite zeigt das
 * laufende und das angekündigte Programm, in der Fixture knapp zwei Wochen.
 * Ein Abruf, danach lokal auf den Zeitraum schneiden. Weiter zurück oder
 * weiter voraus gibt es schlicht nichts – wer den November anfragt, bekommt
 * eine leere Liste, sobald das Kino ihn noch nicht angekündigt hat.
 *
 * Karten gibt es nur an der Abendkasse (bar, ab 15 Minuten vor Beginn),
 * Reservierungen nimmt das Haus ausdrücklich nicht an. Jeder Termin steht
 * deshalb auf `not_on_sale` – das ist keine fehlende Angabe, sondern die
 * Auskunft der Quelle.
 */

const BASE = 'https://werkstattkino.de';

export const werkstattkino: EventSource = {
  definition: {
    id: 'werkstattkino',
    name: 'Werkstattkino',
    cityId: 'muenchen',
    group: 'Kino',
    defaultCategory: 'Kino',
    homepage: BASE,
    enabledByDefault: true,
  },

  ttlSeconds: 30 * 60,

  async fetchEvents(
    range: FetchRange,
    signal?: AbortSignal,
    options?: EventFetchOptions,
  ): Promise<CalendarEvent[]> {
    // Die Seite kennt nur Gegenwart und nahe Zukunft; ein rein vergangener
    // Zeitraum ist nichts, wofür sie abgerufen werden müsste.
    if (range.to < today()) return [];

    const html = await fetchText(`${BASE}/`, {
      signal,
      timeoutMs: options?.requestTimeoutMs,
    });

    const { events, skipped } = parseProgrammePage(html, today());

    // Das Kino spielt jeden Tag ("BEI UNS IST JEDER TAG KINOTAG!"). Eine
    // Seite ohne einen einzigen Termin ist deshalb keine Spielpause, sondern
    // ein geänderter Aufbau – werfen, damit der Cache weiterträgt.
    if (events.length === 0) throw new Error('Kein Termin erkannt (Layout geändert?)');
    if (skipped > 0) console.warn(`[werkstattkino] ${skipped} Terminangabe(n) übersprungen`);

    return events.filter(
      (event) => event.start.slice(0, 10) >= range.from && event.start.slice(0, 10) <= range.to,
    );
  },
};

/** Heutiger Tag in Münchner Zeit – Bezugspunkt für das fehlende Jahr. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default werkstattkino;
