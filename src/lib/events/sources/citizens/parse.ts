import * as cheerio from 'cheerio';
import type { Availability } from '../../types.ts';
import type { Schedule } from '../spektrix.ts';
import { clean } from '../../text.ts';

/**
 * Parser für das Citizens Theatre (`https://citz.co.uk/whats-on/`).
 *
 * Der Spielplan selbst kommt aus Spektrix (siehe `../spektrix.ts`) – dort
 * stehen Produktionen, Vorstellungen, Saal, Spieldauer und Programmtext
 * vollständig und mit echtem Zeitraumfilter. Von der Website kommen die zwei
 * Dinge, die Spektrix **nicht** herausgibt:
 *
 *  1. **Die Adresse der Produktionsseite.** Der Slug lässt sich aus dem Namen
 *     nicht ableiten – „1984" liegt unter `/whats-on/1984-play/`. Die
 *     Übersicht nennt zu jeder Karte Titel und Link; darüber wird zugeordnet.
 *  2. **Die Ticketlage je Vorstellung.** „Sold Out" und „Limited tickets"
 *     stehen im Spielplan der Produktionsseite. Spektrix weiss davon nichts:
 *     der ausverkaufte „The Singer" meldet dort für alle sieben Abende
 *     `isOnSale: true`.
 *
 * Beide Zuordnungen sind so gebaut, dass ihr Ausfall nichts kaputt macht:
 * ohne Link bleibt die Übersichtsseite als `url` stehen, ohne Spielplan die
 * Ticketlage `unknown`. Der Termin selbst hängt allein an Spektrix.
 */

export const TIME_ZONE = 'Europe/London';
export const BASE = 'https://citz.co.uk';
export const LIST_URL = `${BASE}/whats-on/`;

export interface ParsedList {
  /** Vergleichsform des Titels auf die Adresse der Produktionsseite. */
  links: Record<string, string>;
  /** Ist das überhaupt die Übersicht? Sonst: Aufbau geändert. */
  recognised: boolean;
}

/**
 * Die Übersicht: Titel und Adresse je Karte.
 *
 * Genommen wird der Titel aus dem Sprungziel (`c-event-card__permalink`), weil
 * er dort ohne Auszeichnungen steht. Dieselbe Produktion steht zweimal auf der
 * Seite – einmal als Aufmacher, einmal in der Liste; die Karte gewinnt, die
 * zuerst kommt, beide zeigen ohnehin auf dieselbe Adresse.
 */
export function parseEventList(html: string): ParsedList {
  const $ = cheerio.load(html);
  const recognised = $('.c-event-card').length > 0;
  const links: Record<string, string> = {};

  $('a.c-event-card__permalink').each((_index, element) => {
    const anchor = $(element);
    const url = anchor.attr('href');
    const title = clean(anchor.text());
    if (!url || !title) return;
    const key = titleKey(title);
    if (!links[key]) links[key] = url;
  });

  return { links, recognised };
}

/**
 * Der Kasten „Schedule" der Produktionsseite.
 *
 * Eine Zeile ist ein `li.c-event-instance` mit zwei `<time>`-Elementen – Tag
 * und Uhrzeit stehen maschinenlesbar im `datetime`-Attribut, nicht nur als
 * „Sat 19 September 2026 / 2:00 pm". Genau daraus wird der Schlüssel, mit dem
 * die Zeile zur Spektrix-Vorstellung findet.
 *
 * Zwei unabhängige Signale für die Ticketlage, wie sie die Seite selbst setzt:
 * der Knopf (`Buy Tickets` / `Book Tickets` gegen ein totes `Sold Out` ohne
 * `href`) und die Zeile darunter (`Limited tickets`). Ein Abend ganz ohne
 * Knopf ist nicht ausverkauft, sondern nicht öffentlich buchbar –
 * Schulvorstellungen etwa; er bleibt `unknown`.
 *
 * Der Knopf trägt zugleich den einzigen Ticketlink, den diese Quelle kennt:
 * Spektrix nennt keinen, und die Nummer darin (`…/1984/book/62602`) ist nicht
 * die Vorstellungs-ID der Schnittstelle.
 */
export function parseSchedule(html: string): Schedule {
  const $ = cheerio.load(html);
  const schedule: Schedule = {};

  $('li.c-event-instance').each((_index, element) => {
    const row = $(element);
    const day = row.find('time[datetime]').first().attr('datetime');
    const time = row.find('time[datetime]').eq(1).attr('datetime');
    if (!day || !time || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return;

    const link = row.find('.c-event-instance__booking .c-btn').first();
    const button = clean(link.text());
    const hint = clean(row.find('.c-event-instance__availability').first().text());
    const ticketUrl = link.attr('href');

    let availability: Availability = 'unknown';
    let availabilityLabel: string | undefined;
    if (/sold\s*out/i.test(button)) {
      availability = 'soldout';
      availabilityLabel = button;
    } else if (/limited/i.test(hint)) {
      availability = 'limited';
      availabilityLabel = hint;
    } else if (/\b(buy|book)\b/i.test(button)) {
      availability = 'available';
      availabilityLabel = hint || undefined;
    }

    const notes: string[] = [];
    const access = clean(row.find('.c-event-instance__access-list').first().text());
    if (access) notes.push(access);

    schedule[`${day}T${time}`] = { availability, availabilityLabel, ticketUrl, notes };
  });

  return schedule;
}

/**
 * Vergleichsform eines Titels.
 *
 * Zusammengeführt werden zwei Schreibweisen derselben Sache: Spektrix führt
 * „The Singer  " mit angehängten Leerzeichen, die Website „The Singer"; das
 * Apostroph in „Queer Folks' Tales" ist einmal gerade und einmal typografisch.
 * Alles, was kein Buchstabe oder keine Ziffer ist, fällt deshalb weg.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
