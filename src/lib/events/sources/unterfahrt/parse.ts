import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für den Spielplan der Unterfahrt (`programm.php?month=MM&year=YYYY`).
 *
 * Aufbau: je Konzert ein `div.b-events__el.js-events-el`, gebündelt im
 * Container `div.js-events-group`. Der Container ist zugleich das Signal, dass
 * die Liste überhaupt gerendert wurde – ein Monat ohne Konzerte (April 2027)
 * liefert ihn leer, ohne eigene Leermeldung.
 *
 * Termin: `.b-events__el-date` schreibt ihn sichtbar aus
 * ("DI•01•09•2026, 20••30"). Das Attribut `data-ts` daneben sieht wie ein
 * Unix-Zeitstempel aus, ist aber die **lokale Wanduhrzeit mit UTC-Marke**
 * (1788294600000 = "2026-09-01T20:30:00Z" für ein Konzert um 20:30 Münchner
 * Zeit). Wer es als echten Zeitpunkt liest, verschiebt jeden Termin um den
 * Sommerzeit-Offset. Deshalb gewinnt der sichtbare Text; `data-ts` trägt nur,
 * wenn dessen Format bricht – und dann über seine UTC-Bestandteile.
 *
 * Ausverkauftes steht als zweite Zeile im selben Element, hinter einem `<br>`:
 * "FR•18•09•2026, 20••30<br>AUSVERKAUFT!". Ohne `<br>`-Behandlung klebt der
 * Hinweis an der Uhrzeit und beides ist verloren.
 */

const SOURCE_ID = 'unterfahrt';
const BASE = 'https://www.unterfahrt.de';

/** Der Club selbst. Die Reihe "Einstein Kultur" spielt nebenan in Halle 4. */
const VENUE = 'Unterfahrt';
const EINSTEIN = 'Einstein Kultur';

/** "DI•01•09•2026, 20••30" */
const VISIBLE = /^\p{L}{2}•(\d{1,2})•(\d{1,2})•(\d{4}),\s*(\d{1,2})••(\d{2})$/u;

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke ohne Termin oder ID – für Monitoring/Logs. */
  skipped: number;
  /** Die Liste wurde gerendert, enthält aber kein Konzert. */
  empty: boolean;
}

export function parseMonthPage(html: string): ParseResult {
  const $ = cheerio.load(html);

  const container = $('.js-events-group');
  if (container.length === 0) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('.b-events__el').each((_, element) => {
    const item = $(element);

    const detail = item.find('a.o-btn-hex__link').first().attr('href');
    const dateId = detail?.match(/dateID=(\d+)/)?.[1];
    const title = clean(item.find('.b-events__el-title').first().text());

    // <br> trennt Termin und Ausverkauft-Hinweis, nicht nur Zeilen.
    const dateNode = item.find('.b-events__el-date').first().clone();
    dateNode.find('br').replaceWith('\n');
    const [dateLine = '', ...statusLines] = dateNode
      .text()
      .split('\n')
      .map(clean)
      .filter(Boolean);

    const start = parseVisible(dateLine) ?? parseTimestamp(item.attr('data-ts'));

    if (!dateId || !title || !start) {
      skipped++;
      return;
    }

    const status = statusLines.join(' ');
    const soldout = /ausverkauft/i.test(status);
    const url = `${BASE}/${detail}`;
    const tags = readTags($, item);

    events.push({
      id: `${SOURCE_ID}:${dateId}`,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      // Die Quelle führt keinen Untertitel und keine Gattung je Konzert;
      // die Reihen stehen als Schlagworte in den Hinweisen.
      description: clean(item.find('.b-events__el-text').first().text()) || undefined,
      start: berlinIso(start.date, start.hour, start.minute),
      allDay: false,
      // Die Reihe "Einstein Kultur" spielt nicht im Club, sondern in Halle 4
      // des Einstein nebenan – die Quelle sagt das im Schlagwort und im Text.
      venue: { name: tags.includes(EINSTEIN) ? EINSTEIN : VENUE },
      availability: soldout ? 'soldout' : ('available' satisfies Availability),
      availabilityLabel: soldout ? softenShouted(status) : undefined,
      // Verkauft wird über das Reservierungsformular auf der Detailseite.
      ticketUrl: soldout ? undefined : `${url}#ticketform`,
      url,
      notes: collectNotes($, item, tags),
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/**
 * Die Monate, für die die Seite überhaupt Konzerte kennt. Sie stehen als
 * `window.rootData.filter.datepicker` im Markup – dieselbe Liste, mit der die
 * Seite Monate ohne Programm im Kalender ausgraut.
 *
 * @returns "YYYY-MM", aufsteigend; leer, wenn die Angabe fehlt.
 */
export function parseAvailableMonths(html: string): string[] {
  const start = html.indexOf('datepicker:');
  if (start < 0) return [];

  const literal = balancedArray(html, html.indexOf('[', start));
  if (!literal) return [];

  let entries: Record<string, string[]>[];
  try {
    entries = JSON.parse(literal);
  } catch {
    return [];
  }

  const months = new Set<string>();
  for (const entry of entries) {
    for (const [year, list] of Object.entries(entry ?? {})) {
      if (!/^\d{4}$/.test(year) || !Array.isArray(list)) continue;
      for (const month of list) {
        if (/^\d{2}$/.test(month)) months.add(`${year}-${month}`);
      }
    }
  }

  return [...months].sort();
}

/** Das Array ab `open` inklusive verschachtelter Klammern herausschneiden. */
function balancedArray(html: string, open: number): string | undefined {
  if (open < 0) return undefined;
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']' && --depth === 0) return html.slice(open, i + 1);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */

type Root = cheerio.CheerioAPI;
type Item = ReturnType<Root>;

interface Start {
  date: string;
  hour: number;
  minute: number;
}

function parseVisible(line: string): Start | undefined {
  const match = line.match(VISIBLE);
  if (!match) return undefined;
  return {
    date: `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`,
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

/**
 * Notnagel: `data-ts` als lokale Zeit lesen. Der Wert trägt eine UTC-Marke,
 * meint aber Münchner Wanduhrzeit – also genau die UTC-Bestandteile nehmen
 * und **nicht** in eine Zeitzone umrechnen.
 */
function parseTimestamp(value?: string): Start | undefined {
  const ts = Number(value);
  if (!value || !Number.isFinite(ts) || ts <= 0) return undefined;

  const iso = new Date(ts).toISOString();
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)), minute: Number(iso.slice(14, 16)) };
}

/** Reihen und Schlagworte: ein Element, mehrere Werte, getrennt durch "|". */
function readTags($: Root, item: Item): string[] {
  const tags: string[] = [];
  item.find('.b-events__el-tag').each((_, element) => {
    for (const tag of $(element).text().split('|')) {
      const value = clean(tag);
      if (value) tags.push(value);
    }
  });
  return tags;
}

function collectNotes($: Root, item: Item, tags: string[]): string[] | undefined {
  const notes = [...tags];

  // "eintritt 28€" / "mitglieder 14€" – Typ und Betrag stehen getrennt.
  item.find('.b-events__el-price').each((_, element) => {
    const price = $(element);
    const type = clean(price.find('.b-events__el-price-type').text());
    const amount = clean(price.find('.b-events__el-price-num').text()).replace(/(\d)€/, '$1 €');
    if (type && amount) notes.push(`${capitalise(type)}: ${amount}`);
  });

  return notes.length ? [...new Set(notes)] : undefined;
}

function capitalise(word: string): string {
  return word.charAt(0).toLocaleUpperCase('de-DE') + word.slice(1);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
