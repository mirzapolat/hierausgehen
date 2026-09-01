import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für den Webshop des Staatstheaters am Gärtnerplatz
 * (EVENTIM.Inhouse unter `tickets.staatstheater.bayern`).
 *
 * Die Terminliste wird seitenweise nachgeladen; eine Antwort ist ein
 * `<li>`-Fragment je Termin. Jeder Block trägt seine Termin-ID gleich dreimal
 * — als `id="eventKey:<id>"` am Block und in den IDs von Titel, Datum, Zeit
 * und Ort. Gelesen wird die des Blocks; sie ist der Anker.
 *
 * Zwei Antworten sind keine Termine und werden ausdrücklich erkannt:
 * `<li id="listend">` heisst „hinter dieser Seite kommt nichts mehr", und die
 * Fehlerseite des Shops heisst „ohne gültige Sitzung gibt es keine Auskunft".
 * Beides von einem stillen „keine Veranstaltungen" zu unterscheiden ist der
 * Grund, warum `ParseResult` mehr als nur Termine zurückgibt.
 */

const SOURCE_ID = 'gaertnerplatz';
const BASE = 'https://tickets.staatstheater.bayern';
const SHOP = `${BASE}/gpt.webshop/webticket/eventlist`;

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke, die wie ein Termin aussahen, aber nicht verwertbar waren. */
  skipped: number;
  /** Erkannte Terminblöcke, unabhängig davon, ob sie verwertbar waren. */
  blocks: number;
  /** `<li id="listend">` – hinter dieser Seite kommt nichts mehr. */
  end: boolean;
  /** Die Fehlerseite des Shops: die Sitzung fehlt oder ist abgelaufen. */
  sessionLost: boolean;
}

/**
 * Eine Seite der Terminliste.
 *
 * @param category Gattung, unter der die Seite abgefragt wurde. Der Block
 *                 selbst führt keine – sie kommt aus dem Filter, mit dem die
 *                 Seite geholt wurde (siehe `parseSparten`). Ohne Angabe
 *                 bleibt die Gattung leer, statt geraten zu werden.
 */
export function parseEventList(html: string, category?: string): ParseResult {
  if (isSessionError(html)) {
    return { events: [], skipped: 0, blocks: 0, end: false, sessionLost: true };
  }

  const $ = cheerio.load(html);
  const end = $('#listend').length > 0;
  const blocks = $('div[id^="eventKey:"]');

  const events: CalendarEvent[] = [];
  let skipped = 0;

  blocks.each((_, element) => {
    const block = $(element) as unknown as Block;
    const id = block.attr('id')?.slice('eventKey:'.length);
    const date = parseDate(clean(block.find('[id^="event-date-"]').first().text()));
    const title = clean(block.find('h2').first().text());

    if (!id || !date || !title) {
      skipped++;
      return;
    }

    const time = parseTime(clean(block.find('.evt-event-detail__time').first().text()));
    const ticket = readTicket(block);
    const subtitle = clean(block.find('.eventSubtitle1').first().text());
    const venue = clean(block.find('[id^="event-location-"]').first().text());

    events.push({
      id: `${SOURCE_ID}:${id}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      subtitle: subtitle ? softenShouted(subtitle) : undefined,
      category,
      start: berlinIso(date, time?.hour ?? 0, time?.minute ?? 0),
      // Der Shop nennt nur den Beginn; eine Endzeit gibt es hier nicht.
      allDay: !time,
      venue: { name: venue || 'Staatstheater am Gärtnerplatz' },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      // Ausverkauftes hat im Shop keinen eigenen Link mehr. Dann bleibt die
      // Liste selbst der ehrlichste Verweis – lieber die als ein Link, den
      // die Quelle so nicht anbietet.
      url: ticket.url ?? SHOP,
    });
  });

  return { events, skipped, blocks: blocks.length, end, sessionLost: false };
}

/**
 * Die Sparten aus dem Filter der Shop-Seite: `<option value="4">Musical</option>`.
 *
 * Der Block eines Termins nennt seine Gattung nicht — sie ergibt sich daraus,
 * mit welchem Filter die Liste geholt wurde. Deshalb wird die Tabelle einmal je
 * Erhebung aus der Seite gelesen, statt im Code zu veralten. „alle Sparten"
 * (leerer Wert) ist keine Gattung und fällt weg.
 */
export function parseSparten(html: string): { id: string; name: string }[] {
  const $ = cheerio.load(html);
  const sparten: { id: string; name: string }[] = [];

  $('#selectGenre option, select[name="map[\'genre\']"] option').each((_, element) => {
    const option = $(element);
    const id = clean(option.attr('value') ?? '');
    const name = clean(option.text());
    if (!id || id === '0' || !name) return;
    if (sparten.some((entry) => entry.id === id)) return;
    sparten.push({ id, name });
  });

  return sparten;
}

/* ------------------------------------------------------------------ */

type Block = cheerio.Cheerio<never>;

/**
 * Der Shop antwortet auf jede Anfrage ohne gültige Sitzung mit einer
 * vollständigen HTML-Seite statt mit dem Fragment. Erkennbar an `actPage`,
 * nicht an der Überschrift: die steht in der Sprache der Sitzung.
 */
function isSessionError(html: string): boolean {
  return /content="webshopexception"/.test(html) || /actPage["']?\s*[:=]\s*["']webshopexception/.test(html);
}

/** „Fr. 25.09.2026" → "2026-09-25". */
function parseDate(text: string): string | undefined {
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return undefined;

  const [, day, month, year] = match;
  if (Number(day) > 31 || Number(month) > 12) return undefined;
  return `${year}-${month}-${day}`;
}

/** „19:30" – der Shop führt nur den Beginn. */
function parseTime(text: string): { hour: number; minute: number } | undefined {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

/**
 * Ticketlage aus zwei unabhängigen Signalen: dem Element und seinem Text.
 *
 * Buchbares steht in einem `<a href=…selectseat…>`, Ausverkauftes in einem
 * `span[id^="soldtext:"]` — dessen `<a>` hat kein `href`. Wer nur auf `a`
 * selektiert, hielte Ausverkauftes für buchbar. Die Beschriftung folgt der
 * Sprache der Sitzung, deshalb sind beide Fassungen abgedeckt.
 */
function readTicket(block: Block): { availability: Availability; label?: string; url?: string } {
  const sold = block.find('span[id^="soldtext:"]').first();
  if (sold.length > 0) return { availability: 'soldout', label: clean(sold.text()) || undefined };

  const cta = block.find('a[href*="selectseat"]').first();
  const href = cta.attr('href');
  if (cta.length === 0 || !href) return { availability: 'unknown' };

  const label = clean(cta.text());
  const url = new URL(href, BASE).toString();
  const lower = label.toLocaleLowerCase('de-DE');

  if (/restkarten|remaining|letzte|wenige/.test(lower)) return { availability: 'limited', label, url };
  return { availability: 'available', label: label || undefined, url };
}
