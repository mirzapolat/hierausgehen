import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Programm des Import Export (`https://import-export.cc/programm/`).
 *
 * Die Seite `/programm/` ist die vollständige Liste: erst die angekündigten
 * Termine aufsteigend, dann ein Trenner `div.archive-stick` ("Archiv") und
 * danach das gesamte Archiv absteigend. Einen Parameter für den Zeitraum gibt
 * es nicht, eine Schnittstelle auch nicht – der Custom-Post-Type `event` ist
 * nicht über die WordPress-REST-API veröffentlicht. Also ein Abruf, danach
 * lokal schneiden.
 *
 * **Ein Jahr steht in der Liste nirgends.** Je Termin nur "Fr" und "04.09.".
 * Weil beide Hälften sortiert sind, ergibt sich das Jahr aus dem Bezugstag
 * plus einem Übertrag bei jedem Rücksprung im Datum – vorwärts für den
 * Vorschauteil, rückwärts für das Archiv. Die Detailseite nennt das Jahr
 * ("Fr. 04.09.26"), sie wird für die Liste aber nicht abgerufen.
 *
 * **Die Uhrzeit der Liste ist der Einlass.** Nur die Detailseite unterscheidet
 * Einlass und Beginn; die weichen selten und höchstens um eine halbe Stunde
 * voneinander ab. `start` ist deshalb der Einlass – die Angabe, die die Quelle
 * in der Übersicht selbst führt.
 *
 * Ticketlage kennt die Liste nicht: Vorverkaufslink und Preise stehen
 * ausschliesslich auf der Detailseite. `availability` bleibt `unknown`.
 */

const SOURCE_ID = 'import-export';
const BASE = 'https://import-export.cc';
const VENUE = 'Import Export';

/** "04.09." */
const DATE = /^(\d{1,2})\.(\d{1,2})\.?$/;
/** "Einlass: 19:00" */
const TIME = /(\d{1,2})[.:](\d{2})/;

/** Termine, übersprungene Blöcke und ob die Liste leer ist (siehe `page.ts`). */
export type ParseResult = PageResult;

/**
 * @param today Bezugstag "YYYY-MM-DD" für das fehlende Jahr.
 */
export function parseProgrammePage(html: string, today: string): ParseResult {
  const $ = cheerio.load(html);

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  // Vor dem Trenner läuft die Liste vorwärts, danach rückwärts.
  let nextDate = yearWalker(today, 'forward');

  const list = $('#content .events.list').first();

  list.children().each((_, element) => {
    const node = $(element);

    if (node.is('.archive-stick') || node.find('.archive-stick').length > 0) {
      nextDate = yearWalker(today, 'backward');
      return;
    }

    const item = node.is('.event') ? node : node.find('.event').first();
    if (item.length === 0) return;

    const url = absolute(node.attr('href') ?? item.find('a').first().attr('href'));
    const title = clean(item.find('h2.io-title').first().text());
    const day = parseDay(clean(item.find('.date .io-big').first().text()));
    const infos = item.find('.event-infos p');
    const time = clean(infos.first().text()).match(TIME);

    if (!url || !title || !day || !time) {
      skipped++;
      return;
    }

    const id = `${SOURCE_ID}:${slug(url)}`;
    const date = nextDate(day);
    // Derselbe Abend kann nicht zweimal vorkommen; die Termin-URL ist der
    // einzige stabile Schlüssel (der Vorschauteil trägt keine `data-postid`).
    if (seen.has(id)) return;
    seen.add(id);

    // Zweite Zeile: die Gattung im Wortlaut der Quelle ("Konzert, Clubnight",
    // "Auflegen, Tischtennis"). 26 von 1052 Blöcken führen keine.
    const category = clean(infos.eq(1).text()) || undefined;

    events.push({
      id,
      sourceId: SOURCE_ID,
      title: softenShouted(title),
      // Untertitel und Programmtext führt die Liste nicht; der Text kommt
      // über `parseDetailDescription` von der Detailseite.
      category,
      start: berlinIso(date, Number(time[1]), Number(time[2])),
      allDay: false,
      venue: { name: VENUE },
      // Vorverkauf und Preis stehen nur auf der Detailseite.
      availability: 'unknown',
      url,
    });
  });

  return { events, skipped, empty: list.length > 0 && events.length === 0 };
}

/**
 * Programmtext der Detailseite.
 *
 * Der Text steht zwischen Bildergalerie und Ticketkasten: `h1` als
 * Zwischenüberschrift (Bandname), `h2` als Absatz – das Theme benutzt die
 * Überschriften als Fliesstext. `hr` trennt die Abschnitte, `p` trägt mal
 * Text, mal nur ein eingebettetes Video.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  const event = $('#content .event').first();
  if (event.length === 0) return undefined;

  const parts: string[] = [];
  let started = false;

  event.children().each((_, element) => {
    const node = $(element);

    if (node.is('.post-media')) {
      started = true;
      return;
    }
    // Ab dem Ticketkasten kommt kein Programmtext mehr.
    if (node.is('.tickets')) return false;
    if (!started || !node.is('h1, h2, h3, p')) return;

    const text = clean(node.text());
    if (text) parts.push(text);
  });

  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ */

interface Day {
  month: number;
  day: number;
}

/**
 * Vergibt die Jahre über eine sortierte Liste von Tagen ohne Jahresangabe.
 *
 * `forward` für den Vorschauteil (aufsteigend, beginnt am Bezugstag), backward
 * für das Archiv (absteigend, beginnt kurz vor dem Bezugstag). Jeder Sprung
 * entgegen der Laufrichtung ist ein Jahreswechsel.
 */
function yearWalker(today: string, direction: 'forward' | 'backward'): (day: Day) => string {
  const step = direction === 'forward' ? 1 : -1;
  let year = Number(today.slice(0, 4));
  let previous: Day | undefined;

  return (day) => {
    if (previous === undefined) {
      // Ein erstes Datum, das deutlich in der falschen Richtung liegt, gehört
      // ins Nachbarjahr: die Liste beginnt am Bezugstag, nicht irgendwo.
      const start = iso(year, day);
      if (step === 1 ? start < shift(today, -30) : start > shift(today, 30)) year += step;
    } else if (step === 1 ? before(day, previous) : before(previous, day)) {
      year += step;
    }

    previous = day;
    return iso(year, day);
  };
}

function before(a: Day, b: Day): boolean {
  return a.month < b.month || (a.month === b.month && a.day < b.day);
}

function iso(year: number, day: Day): string {
  return `${year}-${pad(day.month)}-${pad(day.day)}`;
}

/** "YYYY-MM-DD" um `days` Tage verschieben. */
function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function parseDay(text: string): Day | undefined {
  const match = text.match(DATE);
  const day = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!month || !day || month > 12 || day > 31) return undefined;
  return { month, day };
}

function absolute(href: string | undefined): string | undefined {
  const value = href?.trim();
  if (!value) return undefined;
  return value.startsWith('http') ? value : `${BASE}${value.startsWith('/') ? '' : '/'}${value}`;
}

/** Letztes Pfadstück der Detailadresse – je Termin eindeutig. */
function slug(url: string): string {
  return url.replace(BASE, '').replace(/^\/+|\/+$/g, '').replace(/^event\//, '') || url;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
