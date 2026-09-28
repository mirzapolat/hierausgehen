import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';

/**
 * Parser für das Cine k Oldenburg (Kulturetage, Bahnhofstraße 11).
 *
 * Das Programm lädt die Seite als HTML-Fragment (`programListAjax.html`) nach.
 * Dessen Parameter sind mit einem TYPO3-`cHash` gesichert – andere Daten als
 * die verlinkten lehnt der Server ab. Brauchbar sind deshalb nur die Links,
 * die `/programm/` selbst ausliefert:
 *
 * - **Woche**: jede Vorstellung dieser Woche mit Uhrzeit, Saal, Ticketlink.
 * - **Vorschau**: die Filme, die später anlaufen – aber ohne Uhrzeit.
 *
 * Alle Vorstellungen eines Films stehen auf seiner Filmseite; die liest
 * `parseFilmPage`. Vorstellungen erkennt dieselbe Funktion in Fragment und
 * Filmseite: die Reiter der schmalen Ansicht (`.d-md-none`) tragen das Datum
 * als ISO-Tag in der ID (`tab-1348-2026-09-29`).
 */

const SOURCE_ID = 'cine-k';
export const BASE = 'https://www.cine-k.de';

/** Die Fragment-Links der Programmseite, samt gültigem `cHash`. */
export function parseProgrammeLinks(html: string): { week?: string; preview?: string } {
  const $ = cheerio.load(html);
  // Die Filterknöpfe tragen den Link in `data-url`, nicht in `href`.
  const links = $('[data-url*="programListAjax.html"]')
    .map((_, element) => $(element).attr('data-url') ?? '')
    .get();
  // Die Links mit Datumsgrenzen sind die, die die Seite selbst ansteuert.
  const find = (range: string) =>
    links.find((link) => link.includes(`%5BdateRange%5D=${range}`) && link.includes('dateRangeStart'));
  const absolute = (link?: string) => (link ? `${BASE}${link.replace(/&amp;/g, '&')}` : undefined);
  return { week: absolute(find('week')), preview: absolute(find('preview')) };
}

export interface Screening {
  /** Buchungsnummer des Ticketshops, sonst Film, Tag und Uhrzeit. */
  id: string;
  date: string;
  hour: number;
  minute: number;
  room?: string;
  /** Weitere Etiketten neben dem Saal, etwa „OmU“. */
  labels: string[];
  message?: string;
  ticketUrl?: string;
}

export interface FilmList {
  /** Die Liste ist gerendert (Container gefunden). */
  recognised: boolean;
  films: { url: string; title: string; description?: string; screenings: Screening[] }[];
}

/** Woche oder Vorschau: je Film ein `.partial-program-item`. */
export function parseFragment(html: string): FilmList {
  const $ = cheerio.load(html);
  const list = $('.tx-cinekmanager-program-list');
  if (list.length === 0) return { recognised: false, films: [] };

  const films: FilmList['films'] = [];
  list.find('.partial-program-item').each((_, element) => {
    const item = $(element);
    const link = item.find('.partial-movie-render-title h3 a[href]').first();
    const href = link.attr('href');
    const title = clean(link.text());
    if (!href || !title) return;
    films.push({
      url: absolute(href),
      title,
      description: clean(item.find('.partial-movie-render-shortdescription').first().text()) || undefined,
      screenings: readScreenings($, item),
    });
  });
  return { recognised: true, films };
}

export interface FilmPage {
  title: string;
  description?: string;
  /** Hinweis des Kinos zum Film („Ausverkauft – nächster Termin am …“). */
  message?: string;
  screenings: Screening[];
}

export function parseFilmPage(html: string): FilmPage | undefined {
  const $ = cheerio.load(html);
  const title = clean($('.show-hero h1').first().text());
  if (!title) return undefined;

  const paragraphs = $('.show-description .description-text p')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);

  return {
    title,
    description: paragraphs.length ? paragraphs.join('\n\n') : undefined,
    message: clean($('.show-specialmessage .alert p').first().text()) || undefined,
    screenings: readScreenings($, $('.show-screenings').first()),
  };
}

/** Eine Vorstellung als Termin. */
export function toEvent(
  film: { url: string; title: string; description?: string; message?: string; screenings?: Screening[] },
  screening: Screening,
): CalendarEvent {
  const soldOut = isSoldOutFor(film, screening);
  const availability: Availability = soldOut ? 'soldout' : screening.ticketUrl ? 'available' : 'unknown';
  const notes = [...screening.labels, screening.message, soldOut ? undefined : film.message].filter(
    (note): note is string => Boolean(note),
  );

  return {
    id: `${SOURCE_ID}:${screening.id}`,
    sourceId: SOURCE_ID,
    title: film.title,
    description: film.description,
    start: berlinIso(screening.date, screening.hour, screening.minute),
    allDay: false,
    venue: { name: screening.room ?? 'Cine k' },
    availability,
    availabilityLabel: soldOut ? film.message : undefined,
    ticketUrl: screening.ticketUrl,
    url: film.url,
    notes: notes.length ? [...new Set(notes)] : undefined,
  };
}

/* ------------------------------------------------------------------ */

/**
 * „Ausverkauft“ steht nur als Hinweis am Film, nicht an der Vorstellung. Er
 * lässt sich nur dann einer Vorstellung zuordnen, wenn der Film genau eine hat.
 */
function isSoldOutFor(film: { message?: string; screenings?: Screening[] }, screening: Screening): boolean {
  if (!film.message || !/^ausverkauft/i.test(film.message)) return false;
  return film.screenings?.length === 1 && film.screenings[0].id === screening.id;
}

function readScreenings($: cheerio.CheerioAPI, scope: cheerio.Cheerio<Element>): Screening[] {
  const screenings: Screening[] = [];
  const seen = new Set<string>();

  // Die schmale Ansicht trägt das ISO-Datum in der Reiter-ID; die breite ist
  // dieselbe Liste noch einmal.
  scope.find('.partial-screening-dates.d-md-none .tab-pane[id]').each((_, pane) => {
    const match = ($(pane).attr('id') ?? '').match(/^tab-(\d+)-(\d{4}-\d{2}-\d{2})$/);
    if (!match) return;
    const [, movieId, date] = match;

    $(pane)
      .find('.partial-screening-render-ticket')
      .each((_, element) => {
        const ticket = $(element);
        const time = clean(ticket.children().first().text()).match(/(\d{1,2})[:.](\d{2})/);
        if (!time) return;

        const href = ticket.find('a.ticket-button[href]').attr('href');
        const booking = href?.match(/\/booking\/(\d+)/)?.[1];
        const id = booking ?? `${movieId}-${date}-${time[1].padStart(2, '0')}${time[2]}`;
        if (seen.has(id)) return;
        seen.add(id);

        const labels = ticket
          .find('.ticket-meta .meta-label')
          .map((_, label) => clean($(label).text()))
          .get()
          .filter(Boolean);

        screenings.push({
          id,
          date,
          hour: Number(time[1]),
          minute: Number(time[2]),
          room: labels[0],
          labels: labels.slice(1),
          message: clean(ticket.find('.ticket-special-message p').text()) || undefined,
          ticketUrl: href,
        });
      });
  });

  return screenings;
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}
