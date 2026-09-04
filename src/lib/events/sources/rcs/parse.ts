import * as cheerio from 'cheerio';
import type { EventDetail } from '../detail.ts';
import { clean } from '../../text.ts';

/**
 * Parser für das Royal Conservatoire of Scotland
 * (`https://www.rcs.ac.uk/whats-on-search/`).
 *
 * Der Spielplan kommt aus Spektrix (siehe `../spektrix.ts`) – dasselbe
 * Ticketsystem wie beim Citizens und beim Tron, hier unter dem Kundennamen
 * `royalconservatoirescotland`. Von der Website kommen die drei Dinge, die die
 * Schnittstelle nicht hergibt: die Adresse der Veranstaltungsseite, die
 * Gattung im Wortlaut des Hauses und die Auskunft „ausverkauft".
 *
 * **Die Zuordnung läuft über die Buchungsnummer, nicht über den Titel.** Jede
 * Karte verlinkt auf `/whats-on/<stück>/book/<n>`, und dieses `<n>` ist die
 * Zifferngruppe, mit der die Vorstellungs-ID der Schnittstelle beginnt
 * (`652210` ⇒ `652210ABCD…`). Der Titel taugt dafür nicht: die Website führt
 * ihn redaktionell, die Kasse betrieblich, und bei 26 von 93 Veranstaltungen
 * gehen die beiden auseinander („Haver Quartet" gegen „Westbourne Music
 * presents: Haver Quartet"). Über die Buchungsnummer findet die Karte zur
 * Vorstellung, von dort zur Produktion – und damit zu allen ihren Abenden.
 *
 * Eine Buchungsnummer trägt nur, wer an genau einem Abend spielt. Ein Lauf
 * über mehrere Tage zeigt statt des Ticketknopfs einen Verweis auf die
 * Terminliste; für diese Karten greift der Titel als zweiter Versuch.
 *
 * **Der Knopf „Tickets" sagt nichts über Karten.** Er steht auch dort, wo der
 * Verkauf laut Kasse erst in drei Tagen beginnt – die Seite rendert ihn
 * unbesehen. Gewertet wird deshalb nur sein Gegenteil: ein totes
 * `c-btn--disabled` mit „Sold Out". Das gilt dann für den ganzen Lauf, denn
 * solange ein einziger Abend noch zu haben ist, zeigt die Karte den Knopf.
 */

export const TIME_ZONE = 'Europe/London';
export const BASE = 'https://www.rcs.ac.uk';
export const LIST_URL = `${BASE}/whats-on-search/`;

/** Eine Karte der Übersicht. */
export interface EventCard {
  title: string;
  /** Seite der Veranstaltung. */
  url: string;
  /** Gattung im Wortlaut des Hauses („Classical Music", „Opera And Vocal"). */
  genre?: string;
  /** Zifferngruppe aus `/book/<n>`; nur bei Terminen an genau einem Abend. */
  bookingId?: string;
  /** Toter Knopf „Sold Out" – der ganze Lauf ist weg. */
  soldOut: boolean;
}

export interface ParsedList {
  cards: EventCard[];
  /** Höchste Seitenzahl der Blätterleiste; 1, wenn es keine gibt. */
  pageCount: number;
  /** Ist das überhaupt die Übersicht? Sonst: Aufbau geändert. */
  recognised: boolean;
}

export function parseEventList(html: string): ParsedList {
  const $ = cheerio.load(html);
  // Die Blätterleiste steht auch auf einer Seite jenseits der letzten – daran
  // hängt die Unterscheidung zwischen „leer" und „kaputt".
  const pagination = $('.c-pagination');
  const recognised = pagination.length > 0 || $('.c-event-card').length > 0;

  let pageCount = 1;
  pagination.find('a.page-numbers[href]').each((_index, element) => {
    const match = /\/page\/(\d+)\//.exec($(element).attr('href') ?? '');
    if (match) pageCount = Math.max(pageCount, Number(match[1]));
  });

  const cards: EventCard[] = [];
  $('.c-event-card').each((_index, element) => {
    const card = $(element);
    const title = clean(card.find('.c-event-card__title').first().text());
    const url = card.find('a.c-event-card__permalink').first().attr('href');
    if (!title || !url) return;

    const booking = card.find('a.c-btn-book[href]').first().attr('href');
    cards.push({
      title,
      url,
      genre: clean(card.find('.c-event-card__genre').first().text()) || undefined,
      bookingId: /\/book\/(\d+)/.exec(booking ?? '')?.[1],
      soldOut: card.find('.c-btn--disabled').length > 0,
    });
  });

  return { cards, pageCount, recognised };
}

/**
 * Vergleichsform eines Titels – nur als zweiter Versuch, wenn die
 * Buchungsnummer fehlt. Alles ausser Buchstaben und Ziffern fällt weg.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Die Zifferngruppe, mit der eine Spektrix-ID beginnt.
 *
 * `652210ANBHBQCDMGTDLRVMTDGMRKCKCJPGH` ⇒ `652210`. Genau die steht in der
 * Buchungsadresse der Website, und genau damit findet eine Karte zu ihrer
 * Vorstellung.
 */
export function idPrefix(spektrixId: string): string | undefined {
  return /^(\d+)/.exec(spektrixId)?.[1];
}

/**
 * Programmtext und Preisspanne von der Veranstaltungsseite.
 *
 * Die Kasse führt zu keiner der 93 Produktionen einen Text – das Feld ist da,
 * aber leer. Er steht allein im WordPress, im ersten `c-wysiwyg` der Seite
 * (`event__important-information`). Was danach kommt, sind Besetzung und
 * Kurzbiografien in eigenen Blöcken; die bleiben draussen.
 *
 * Aus dem Kasten daneben kommt die Preisspanne. Die Spielstätte steht dort
 * auch – aber wieder nur als „Royal Conservatoire of Scotland", also nichts,
 * was der Termin nicht schon wüsste.
 */
export function parseDetail(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);

  const article = $('.event__important-information').first();
  let description: string | undefined;
  if (article.length > 0) {
    const copy = article.clone();
    copy.find('script, style').remove();
    copy.find('br').replaceWith('\n');
    copy.find('p, div, li, h1, h2, h3, h4').append('\n');
    const text = clean(copy.text());
    if (text.length >= 40) description = text;
  }

  const notes: string[] = [];
  const price = clean($('.c-event__details-pricesprices-from').first().text());
  if (price) notes.push(`Tickets: ${price}`);

  if (!description && notes.length === 0) return undefined;
  return { description, notes: notes.length > 0 ? notes : undefined };
}
