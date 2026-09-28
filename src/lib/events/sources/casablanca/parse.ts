import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Programm des Casablanca Kinos Oldenburg (Startseite).
 *
 * Die Seite führt das veröffentlichte Programm zweimal: als Tabelle
 * (`.programme-table-main-movie-item`, je Film und Tag ein Block mit
 * `data-date`) und als Raster für die Filter. Gelesen wird nur die Tabelle –
 * sie enthält jede Vorstellung genau einmal. Jede Uhrzeit ist ein Link in den
 * Ticketshop mit eigener Vorstellungsnummer (`data-showid`), der Saal steht im
 * `title`.
 *
 * Beim Schreiben dieses Adapters: die laufende Spielwoche bis Mittwoch
 * vollständig, dazu Sondervorstellungen bis in den nächsten Sommer.
 */

const SOURCE_ID = 'casablanca';
const BASE = 'https://www.casablanca-kino.de';

export function parseProgramme(html: string): PageResult {
  const $ = cheerio.load(html);
  const items = $('.programme-table-main-movie-item');
  // Das Programm ist ohne Termin nie leer – ohne Block hat sich der Aufbau geändert.
  if (items.length === 0) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  items.each((_, element) => {
    const item = $(element);
    const date = item.attr('data-date') ?? '';
    const title = clean(item.find('.movie-item-caption').first().text());
    const href = item.find('a[href^="/filme/"]').first().attr('href');
    const series = clean(item.find('.movie-item-label').first().text());

    item.find('a[data-showid]').each((_, link) => {
      const show = $(link);
      const id = show.attr('data-showid');
      const time = clean(show.find('.movie-itemshowtime-linktext').text()).match(/^(\d{1,2})[.:](\d{2})/);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || !href || !id || !time) {
        skipped++;
        return;
      }

      const classes = show.attr('class') ?? '';
      const language = classes.match(/movie-item-showing-lang-(\S+)/)?.[1];
      const group = clean(show.closest('label').find('.movie-itemshowtime-grouphint').text());
      // Ein ausgegrauter Knopf heisst hier: Vorstellung hat begonnen.
      const bookable = !show.closest('label').hasClass('disabled');

      events.push({
        id: `${SOURCE_ID}:${id}`,
        sourceId: SOURCE_ID,
        title,
        start: berlinIso(date, Number(time[1]), Number(time[2])),
        allDay: false,
        venue: { name: clean(show.attr('title') ?? '') || 'Casablanca' },
        availability: bookable ? 'available' : 'unknown',
        ticketUrl: show.attr('href'),
        url: `${BASE}${href}`,
        notes: unique([language, series, group && group !== series ? group : '']),
      });
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/** Programmtext der Filmseite. */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  const paragraphs = $('.programme-details-info-description-text-long p')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

function unique(values: (string | undefined)[]): string[] | undefined {
  const list = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return list.length ? list : undefined;
}
