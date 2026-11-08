import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Spielplan des Kom(m)ödchen, `https://www.kommoedchen.de/spielplan/`.
 *
 * Eine Seite mit allen kommenden Terminen, je Termin ein
 * `div.day-event-wrapper[data-date]`. Darin:
 *
 *   .date-time            „20:00 Uhr"
 *   .location             „Kom(m)ödchen", „Robert-Schumann-Saal, …" oder
 *                         „unterwegs in: Stuttgart" (Gastspiel auswärts)
 *   .subtitle / .title    Künstler bzw. Ensemble / Programmtitel
 *   .event--ticket        Ticket-Link oder `.event-text-button` mit Hinweis
 *                         („VVK am 1. Dez ab 10 Uhr", „eventuelle Restkarten an
 *                         der Abendkasse", „muss leider entfallen!")
 *
 * Gastspiele „unterwegs in: …" finden nicht in Düsseldorf statt und werden
 * nicht übernommen. Eine Gattung führt die Seite nicht; die Art kommt aus
 * `defaultCategory`.
 */

const SOURCE_ID = 'kommoedchen';
const BASE = 'https://www.kommoedchen.de';
const AWAY = /^unterwegs in:/i;

export function parseSpielplan(html: string): PageResult {
  const $ = cheerio.load(html);
  const blocks = $('div.day-event-wrapper[data-date]');
  const events: CalendarEvent[] = [];
  let skipped = 0;

  blocks.each((_, element) => {
    const block = $(element);
    const venue = clean(block.find('.location').first().text());
    if (AWAY.test(venue)) return;

    const date = block.attr('data-date') ?? '';
    const time = clean(block.find('.date-time').first().text()).match(/(\d{1,2})[:.](\d{2})/);
    const link = block.find('.description-titles a[href]').first().attr('href');
    const artist = clean(block.find('.subtitle').first().text());
    const programme = clean(block.find('.title').first().text());
    const title = artist || programme;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !link || !title) {
      skipped++;
      return;
    }

    const url = new URL(link, BASE).toString();
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'termin';
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    const ticket = block.find('.event--ticket');
    const ticketHref = ticket.find('a[href]').first().attr('href');
    const hint = clean(ticket.find('.event-text-button').first().text());
    const { availability, availabilityLabel } = ticketState(Boolean(ticketHref), hint);

    events.push({
      id: `${SOURCE_ID}:${slug}-${date}-${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`,
      sourceId: SOURCE_ID,
      title,
      subtitle: artist && programme ? programme : undefined,
      start: berlinIso(date, hour, minute),
      allDay: false,
      venue: { name: venue || 'Kom(m)ödchen' },
      availability,
      availabilityLabel,
      ticketUrl: ticketHref ? new URL(ticketHref, BASE).toString() : undefined,
      url,
    });
  });

  // Ohne Termine steht der Ortsfilter des Spielplans trotzdem auf der Seite.
  const empty = blocks.length === 0 && $('.day-filter').length > 0;
  return { events, skipped, empty };
}

function ticketState(
  hasLink: boolean,
  hint: string,
): { availability: Availability; availabilityLabel?: string } {
  if (hasLink) return { availability: 'available' };
  if (!hint) return { availability: 'unknown' };
  if (/entf[aä]llt|entfallen|abgesagt/i.test(hint)) {
    return { availability: 'not_on_sale', availabilityLabel: 'Abgesagt' };
  }
  if (/ausverkauft/i.test(hint)) return { availability: 'soldout', availabilityLabel: hint };
  if (/restkarten|letzte karten|wenige/i.test(hint)) {
    return { availability: 'limited', availabilityLabel: hint };
  }
  if (/vvk|vorverkauf/i.test(hint)) return { availability: 'not_on_sale', availabilityLabel: hint };
  return { availability: 'unknown', availabilityLabel: hint };
}

/** Programmtext der Detailseite: die Absätze in `.events--content`. */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);
  const paragraphs = $('.event-main .events--content p')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}
