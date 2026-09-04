import * as cheerio from 'cheerio';
import type { Availability } from '../../types.ts';
import type { Schedule } from '../spektrix.ts';
import { clean } from '../../text.ts';

/**
 * Parser für das Tron Theatre (`https://www.tron.co.uk/whats-on/`).
 *
 * Der Spielplan kommt aus Spektrix (siehe `../spektrix.ts`); von der Website
 * kommt nur die Adresse der Produktionsseite. Der Slug lässt sich aus dem
 * Namen nicht ableiten – „The Big Comedy Roadshow" liegt unter
 * `/shows/the-big-comedy-roadshow-3/`, mit angehängter Nummer aus der
 * WordPress-Historie.
 *
 * Dazu kommt aus dem Reiter „Performances" die Ticketlage, die Spektrix nicht
 * herausgibt, und die Anmerkung zur einzelnen Vorstellung („Preview",
 * „Press Night", „with British Sign Language", „Relaxed Performance").
 */

export const TIME_ZONE = 'Europe/London';
export const BASE = 'https://www.tron.co.uk';
export const LIST_URL = `${BASE}/whats-on/`;

export interface ParsedList {
  /** Vergleichsform des Titels auf die Adresse der Produktionsseite. */
  links: Record<string, string>;
  /** Ist das überhaupt die Übersicht? Sonst: Aufbau geändert. */
  recognised: boolean;
}

export function parseEventList(html: string): ParsedList {
  const $ = cheerio.load(html);
  const cards = $('.post_grid_item');
  const links: Record<string, string> = {};

  cards.find('.event_title a[href]').each((_index, element) => {
    const anchor = $(element);
    const url = anchor.attr('href');
    const title = clean(anchor.text());
    if (!url || !title) return;
    const key = titleKey(title);
    if (!links[key]) links[key] = url;
  });

  return { links, recognised: cards.length > 0 };
}

/**
 * Vergleichsform eines Titels – alles ausser Buchstaben und Ziffern fällt weg.
 *
 * Nötig, weil dieselbe Produktion in Spektrix und in WordPress verschieden
 * getippt ist: „Community Ensemble 18+ | Recruitment Workshop" trägt einen
 * senkrechten Strich, den die Karte anders umbricht.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Der Reiter „Performances" einer Produktionsseite.
 *
 * Eine Zeile ist ein `<tr>` mit Datum, Uhrzeit, Anmerkung und Knopf. Der Knopf
 * sagt die Ticketlage im Klartext und mit einer zweiten, unabhängigen Marke:
 *
 *     <a href="…/book-online/<ID>" class="button btn is-primary">Book Tickets</a>
 *     <a href="…/book-online/<ID>" class="button btn is-primary">Last Few</a>
 *     <a class="button btn is-danger">SOLD OUT</a>          ohne href
 *     (leere Zelle)                                          Pressevorstellung
 *
 * Zugeordnet wird über Tag und Uhrzeit, nicht über die Vorstellungs-ID aus dem
 * Link: ausgerechnet die ausverkauften Zeilen haben keinen Link, und genau die
 * sind der Grund, überhaupt hier nachzusehen.
 *
 * Die Datumszelle steht zweimal in der Zeile – einmal ausgeschrieben für breite
 * Bildschirme, einmal als „18/09 - 7:30pm" fürs Telefon, beide unter derselben
 * Klasse. Genommen wird die ausgeschriebene, weil nur sie das Jahr trägt.
 */
export function parseSchedule(html: string): Schedule {
  const $ = cheerio.load(html);
  const schedule: Schedule = {};

  $('tr').each((_index, element) => {
    const row = $(element);
    let day: string | undefined;
    row.find('td.cell_date').each((_i, cell) => {
      day ??= parseDay(clean($(cell).text()));
    });
    const time = parseTime(clean(row.find('td.cell_time').first().text()));
    if (!day || !time) return;

    const link = row.find('td.cell_button a').first();
    const button = clean(link.text());
    const ticketUrl = link.attr('href');

    let availability: Availability = 'unknown';
    let availabilityLabel: string | undefined;
    if (/sold\s*out/i.test(button)) {
      availability = 'soldout';
      availabilityLabel = button;
    } else if (/\b(last few|limited)\b/i.test(button)) {
      availability = 'limited';
      availabilityLabel = button;
    } else if (ticketUrl && /\b(book|buy)\b/i.test(button)) {
      availability = 'available';
    }

    const notes: string[] = [];
    row.find('td.cell_details .instance_message').each((_i, note) => {
      const text = clean($(note).text());
      if (text && !notes.includes(text)) notes.push(text);
    });

    schedule[`${day}T${time}`] = { availability, availabilityLabel, ticketUrl, notes };
  });

  return schedule;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Fri 18 September 2026" -> "2026-09-18"; alles andere -> undefined. */
function parseDay(value: string): string | undefined {
  const match = /^[A-Za-z]{3,9}\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(value);
  if (!match) return undefined;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/** "7:30pm" -> "19:30". */
function parseTime(value: string): string | undefined {
  const match = /^(\d{1,2})[:.](\d{2})\s*(am|pm)$/i.exec(value);
  if (!match) return undefined;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === 'pm') hour += 12;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}
