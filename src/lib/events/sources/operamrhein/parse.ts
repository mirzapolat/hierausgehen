import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Monatskalender der Deutschen Oper am Rhein,
 * `https://www.operamrhein.de/spielplan/kalender/{YYYY-MM}/duesseldorf`.
 *
 * Jeder Termin ist ein `div.performance` mit der ID `{YYYY-MM-DD}-p{NNNN}`;
 * `NNNN` ist die Kalendereintrags-ID der Vorstellung (dieselbe steckt im
 * iCal-Link). Zeit und Spielstätte stehen je Breakpoint zweimal im Block –
 * gelesen wird jeweils die erste Fassung.
 *
 * Die Seite klemmt den angefragten Monat auf ihr Ladefenster
 * (`data-load-backward-until` … `data-load-forward-until`): wer August
 * anfragt, bekommt den letzten Spieltag im Juli. Welcher Zeitraum wirklich
 * geliefert wurde, steht in `data-dates-from`/`-to` und wird mit
 * zurückgegeben; das Adapter filtert ohnehin nach dem angefragten Zeitraum.
 */

const SOURCE_ID = 'operamrhein';
const BASE = 'https://www.operamrhein.de';

type Node = cheerio.Cheerio<never>;

export interface CalendarResult extends PageResult {
  /** Der Zeitraum, den die Seite tatsächlich zeigt. */
  window?: { from: string; to: string };
}

export function parseCalendar(html: string): CalendarResult {
  const $ = cheerio.load(html);
  const container = $('.js-schedule-content').first();
  const events: CalendarEvent[] = [];
  let skipped = 0;

  container.find('div.performance[id]').each((_, element) => {
    const block = $(element) as unknown as Node;
    const event = readPerformance($, block);
    if (event) events.push(event);
    else skipped++;
  });

  const from = container.attr('data-dates-from');
  const to = container.attr('data-dates-to');

  return {
    events,
    skipped,
    // Der Container ist da, aber leer: ein spielfreier Zeitraum. Fehlt der
    // Container, hat sich das Layout geändert.
    empty: container.length > 0 && events.length === 0 && skipped === 0,
    window: from && to ? { from, to } : undefined,
  };
}

function readPerformance($: cheerio.CheerioAPI, block: Node): CalendarEvent | undefined {
  const id = block.attr('id')?.match(/^(\d{4}-\d{2}-\d{2})-p(\d+)$/);
  // Zwei Bauarten: `h3.headline__headline` (mit Kicker und Untertitel) für
  // Produktionen, `.performance__smallheadline` für Tanzkurse und Projekte.
  // Ein `<br>` im Titel ist dort nur ein Zeilenfall.
  const heading = block.find('.performance__title').first();
  const titleNode = heading.find('.headline__headline').first();
  const title = line(textWithBreaks(titleNode.length ? titleNode : heading.find('.performance__smallheadline').first(), ' '));
  if (!id || !title) return undefined;
  const [, date, performanceId] = id;

  const timeNode = block.find('.performance__time').first();
  const startAttr = timeNode.find('meta[itemprop="startDate"]').attr('content') ?? '';
  const startTime = startAttr.match(/T(\d{2}):(\d{2})/);
  const endTime = clean(timeNode.text()).match(/[-–]\s*(\d{1,2}):(\d{2})/);

  const hour = startTime ? Number(startTime[1]) : 0;
  const minute = startTime ? Number(startTime[2]) : 0;
  const end = endTime ? endOnSameDay(date, hour, minute, Number(endTime[1]), Number(endTime[2])) : undefined;

  const author = line(block.find('.performance__author').first().text());
  // „--" ist ein Platzhalter der Redaktion, kein Untertitel.
  const headlineSubtitle = line(heading.find('.headline__subtitle').first().text().replace(/^\s*-+\s*$/, ''));
  const kicker = line(heading.find('.headline__kicker').first().text());

  const link = block.find('a.performance__link').attr('href');
  const ticket = readTicket(block);
  const ical = block.find('a.ticketbutton__ical').attr('href');

  return {
    id: `${SOURCE_ID}:${performanceId}`,
    sourceId: SOURCE_ID,
    title,
    subtitle: author ?? headlineSubtitle,
    description: joinLines([
      author ? headlineSubtitle : undefined,
      // Die Unterzeile der Produktion („Wahn, überall Wahn" – ein Meister-Werk).
      textWithBreaks(block.find('.performance__col--info .performance__productioninfo').first(), ' '),
    ]),
    // Wortlaut der Quelle, auch zusammengesetzt („Ballett, Tanz mit!").
    category: clean(block.find('.performance__category').first().text()) || undefined,
    start: berlinIso(date, hour, minute),
    end,
    allDay: !startTime,
    venue: { name: clean(block.find('.performance__location').first().text()) || 'Deutsche Oper am Rhein' },
    availability: ticket.availability,
    availabilityLabel: ticket.label,
    ticketUrl: ticket.url,
    url: link ? absolute(link) : `${BASE}/spielplan/kalender/`,
    icsUrl: ical ? absolute(ical) : undefined,
    notes: collectNotes($, block, kicker, ticket.label),
  };
}

/**
 * Ticketlage aus Knopf und Klasse:
 *
 * - `a.ticketbutton__tickets` „Karten" / „Restkarten" – buchbar
 * - `span…--style-soldout` „Ausverkauft" (dazu `ticketbutton--is-soldout`)
 * - `span…--style-info` „Info" – kein Verkauf, meist Eintritt frei mit Anmeldung
 * - gar kein Knopf (`ticketbutton--without-ticketbutton`) – vergangene oder
 *   nicht buchbare Termine; nur wenn die Seite das sagt, `not_on_sale`
 */
function readTicket(block: Node): { availability: Availability; label?: string; url?: string } {
  const wrapper = block.find('.ticketbutton').first();
  const button = wrapper.find('.ticketbutton__tickets').first();
  const label = clean(button.text()) || undefined;
  const lower = (label ?? '').toLowerCase();
  const classes = `${wrapper.attr('class') ?? ''} ${button.attr('class') ?? ''}`;
  const href = button.is('a') ? button.attr('href')?.trim() : undefined;

  if (classes.includes('is-soldout') || classes.includes('style-soldout') || lower.includes('ausverkauft')) {
    return { availability: 'soldout', label: label ?? 'Ausverkauft' };
  }
  if (href && /restkarten|letzte/.test(lower)) return { availability: 'limited', label, url: href };
  if (href) return { availability: 'available', label, url: href };

  const presale = clean(wrapper.find('.ticketbutton__infoitem--presaleinfotext').text());
  if (/nicht mehr buchbar|kein vorverkauf|vorverkauf ab/i.test(presale)) {
    return { availability: 'not_on_sale', label: presale };
  }
  return { availability: 'unknown' };
}

function collectNotes(
  $: cheerio.CheerioAPI,
  block: Node,
  kicker: string | undefined,
  availabilityLabel: string | undefined,
): string[] | undefined {
  const notes: string[] = [];
  // Der Kicker trägt bei der Jungen Oper die Altersempfehlung („Ab 8 Jahren").
  if (kicker) notes.push(/^ab \d+ jahr/i.test(kicker) ? `Alter: ${kicker}` : kicker);
  const info = block.find('.ticketbutton__info').first();

  const prices = info
    .find('.ticketbutton__price')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  if (prices.length) notes.push(`Preise: ${prices.join(' / ')} €`);

  for (const selector of [
    '.ticketbutton__infoitem--priceinfotext',
    '.ticketbutton__infoitem--presaleinfotext',
    '.ticketbutton__infoitem--soldout',
  ]) {
    const text = textWithBreaks(info.find(selector).first(), ' ');
    // Was schon als Ticketlage dasteht, nicht noch einmal als Hinweis.
    if (text && text !== availabilityLabel) notes.push(text);
  }

  const subscription = clean(info.find('.ticketbutton__infoitem--subscriptioninfo').first().text());
  if (subscription) notes.push(`Abo: ${subscription}`);

  // „Im Anschluss: Nachgefragt", „Filmvorführung: BILLY ELLIOT" – je
  // Breakpoint doppelt, deshalb nur aus der Info-Spalte.
  block.find('.performance__col--info .performance__infotext').each((_, el) => {
    const text = textWithBreaks($(el), ' ');
    if (text && !notes.includes(text)) notes.push(text);
  });

  return notes.length ? notes : undefined;
}

/* ------------------------------------------------------------------ */
/* Produktionsseite                                                    */

/**
 * Die Produktionsseite (`…/{produktion}/{NNNN}/`): im Akkordeon
 * „Beschreibung" stehen Sprache, Dauer und Altersempfehlung als eigene
 * Felder und danach der Programmtext. „Handlung" und die Stimmen zur
 * Premiere stehen in anderen Akkordeons und bleiben draussen.
 */
export function parseProductionDetail(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);
  const panel = $('.accordion__body')
    .filter((_, el) => $(el).find('.productioninfos').length > 0)
    .first();
  if (!panel.length) return undefined;

  const notes: string[] = [];
  const meta = (kind: string) => clean(panel.find(`.productioninfos__metainfo--${kind}`).first().text());
  const language = meta('language');
  const duration = meta('duration');
  const age = meta('agerecommendation');
  const hint = meta('hint');
  if (language) notes.push(`Sprache: ${language}`);
  if (duration) notes.push(`Dauer: ${duration}`);
  if (age) notes.push(`Alter: ${age}`);
  if (hint) notes.push(hint);

  const paragraphs = panel
    .find('.richtext')
    .map((_, el) => textWithBreaks($(el)))
    .get()
    .filter((text): text is string => Boolean(text));

  const description = paragraphs.length ? paragraphs.join('\n\n') : undefined;
  if (!description && notes.length === 0) return undefined;
  return { description, notes: notes.length ? notes : undefined };
}

/* ------------------------------------------------------------------ */

/**
 * Text eines Knotens; `<br>` trennt Inhalte und wird nicht verschluckt.
 * Umbrüche im Quelltext sind dagegen nur Leerraum.
 */
function textWithBreaks<T extends AnyNode>(node: cheerio.Cheerio<T>, joiner = '\n'): string | undefined {
  if (!node.length) return undefined;
  const copy = node.clone();
  copy.find('br').replaceWith(BREAK);
  const lines = copy
    .text()
    .split(BREAK)
    .map(clean)
    .filter(Boolean);
  return lines.length ? lines.join(joiner) : undefined;
}

// Ein Zeichen, das in Spielplänen nicht vorkommt; NUL überlebt das
// HTML-Parsen von `replaceWith` nicht.
const BREAK = '\u241E';

/**
 * Eine Zeile Text ohne `&shy;` – das steht in langen Titeln
 * („Mitter&shy;nachts&shy;tür") und gehört nicht ins Datenmodell.
 */
function line(text: string | undefined): string | undefined {
  return clean((text ?? '').replace(/\u00ad/g, '')) || undefined;
}

function joinLines(lines: (string | undefined)[]): string | undefined {
  const present = lines.filter((text): text is string => Boolean(text));
  return present.length ? present.join('\n') : undefined;
}

/** Endzeit am selben Abend; geht sie über Mitternacht, bleibt sie weg. */
function endOnSameDay(date: string, hour: number, minute: number, endHour: number, endMinute: number) {
  if (endHour * 60 + endMinute <= hour * 60 + minute) return undefined;
  return berlinIso(date, endHour, endMinute);
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}
