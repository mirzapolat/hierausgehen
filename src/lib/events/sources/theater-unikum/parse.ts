import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { EventDetail } from '../detail.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Spielplan des Theater Unikum Oldenburg (`/spielplan/`).
 *
 * WordPress mit Events Manager: zehn Termine je Seite als `.em-item` in
 * `.em-events-list`, weiter über `?pno=N`. Hinter der letzten Seite steht die
 * Liste leer da – das ist das Endesignal, zusammen mit dem fehlenden
 * „weiter“-Link.
 *
 * Der ICS-Feed des Plugins (`/events.ics`) wäre bequemer, bricht aber hart
 * nach fünfzig Terminen ab und ignoriert `scope` und `limit`; beim Schreiben
 * dieses Adapters fehlten ihm dadurch sieben Monate.
 *
 * Stücke mit mehreren Terminen teilen sich eine Adresse. Die ID ist deshalb
 * Adresse plus Beginn.
 */

const SOURCE_ID = 'theater-unikum';

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

export interface ListPage extends PageResult {
  /** Es gibt eine weitere Seite. */
  hasNext: boolean;
}

export function parseListPage(html: string): ListPage {
  const $ = cheerio.load(html);

  const list = $('.em-events-list');
  if (list.length === 0) return { events: [], skipped: 0, empty: false, hasNext: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  list.find('.em-item').each((_, element) => {
    const item = $(element);
    const link = item.find('.em-item-title a[href]').first();
    const title = clean(link.text());
    const url = link.attr('href')?.trim();
    const date = parseDate(clean(item.find('.em-event-date').first().text()));
    const times = parseTimes(clean(item.find('.em-event-time').first().text()));

    if (!title || !url || !date) {
      skipped++;
      return;
    }

    const start = berlinIso(date, times?.start.hour ?? 0, times?.start.minute ?? 0);
    const end = times?.end ? berlinIso(date, times.end.hour, times.end.minute) : undefined;

    events.push({
      id: `${SOURCE_ID}:${slug(url)}-${date}${times ? `-${pad(times.start.hour)}${pad(times.start.minute)}` : ''}`,
      sourceId: SOURCE_ID,
      title,
      // Der Listentext bricht mitten im Satz ab – der ganze kommt von der Stückseite.
      category: clean(item.find('.event-categories li').first().text()) || undefined,
      start,
      // Ein Ende vor dem Beginn hiesse: über Mitternacht. Das sagt die Liste
      // nicht sicher – dann lieber keins.
      end: end && end > start ? end : undefined,
      allDay: !times,
      venue: { name: clean(item.find('.em-event-location').first().text()) || 'Theater Unikum' },
      // Karten gibt es nur über die allgemeine Ticketseite; eine Ticketlage
      // je Termin nennt die Seite nicht.
      availability: 'unknown',
      url,
    });
  });

  return {
    events,
    skipped,
    empty: events.length === 0,
    hasNext: $('.em-pagination a.next[href]').length > 0,
  };
}

/** Programmtext und Eintritt der Stückseite. */
export function parseDetailPage(html: string): EventDetail | undefined {
  const $ = cheerio.load(html.replace(/<\s*br\s*\/?\s*>/gi, '\n'));

  const paragraphs: string[] = [];
  $('.em-event-content')
    .first()
    .find('p')
    .each((_, element) => {
      const text = $(element)
        .text()
        .split('\n')
        .map(clean)
        .filter(Boolean)
        .join('\n');
      if (text) paragraphs.push(text);
    });

  const price = $('.elementor-post-info__item--type-custom')
    .map((_, element) => clean($(element).text()))
    .get()
    .find((text) => /^Eintritt\b/i.test(text));

  const note = priceNote(price);
  if (!paragraphs.length && !note) return undefined;
  return {
    description: paragraphs.length ? paragraphs.join('\n\n') : undefined,
    notes: note ? [note] : undefined,
  };
}

/* ------------------------------------------------------------------ */

/**
 * „Eintritt: 6/11“ → „Eintritt 6/11“. Das Feld ist eine Vorlage des CMS: steht
 * noch „Preis eintragen“ darin, ist nichts eingetragen; „Eintritt: Eintritt
 * frei“ wird zu „Eintritt frei“.
 */
function priceNote(label: string | undefined): string | undefined {
  const value = clean(label ?? '').replace(/^Eintritt:?\s*/i, '');
  if (!value || /preis eintragen/i.test(value)) return undefined;
  return /^eintritt\b/i.test(value) ? value : `Eintritt ${value}`;
}

/** "16 Oktober, 2026" */
function parseDate(label: string): string | undefined {
  const match = label.toLowerCase().match(/(\d{1,2})\.?\s+([a-zä]+),?\s+(\d{4})/);
  if (!match) return undefined;
  const month = MONTHS[match[2]];
  const day = Number(match[1]);
  if (!month || day < 1 || day > 31) return undefined;
  return `${match[3]}-${pad(month)}-${pad(day)}`;
}

type Clock = { hour: number; minute: number };

/** "20:00 - 22:00" */
function parseTimes(label: string): { start: Clock; end?: Clock } | undefined {
  const [start, end] = [...label.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => ({
    hour: Number(m[1]),
    minute: Number(m[2]),
  }));
  if (!start || start.hour > 23 || start.minute > 59) return undefined;
  return { start, end: end && end.hour <= 23 && end.minute <= 59 ? end : undefined };
}

function slug(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() ?? url;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
