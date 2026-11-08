import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import type { EventDetail } from '../detail.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für das Programm des Muffatwerks, `https://www.muffatwerk.de/de/events`.
 *
 * Eine Seite mit allen kommenden Terminen (gut ein Jahr), ohne Paging. Je
 * Termin ein `div.entry.event` mit `id="event{ID}"` in `div#content`.
 * Jeder Block hat zwei Ansichten:
 *
 * - `.hover-out`: Datum (`Di<br>10.11<br>26`, `Heute`, `12.01.27 & 13.01.27`),
 *   Titel, ein kleiner Statushinweis (`ausverkauft`, `abgesagt`,
 *   `verlegt auf …`) und die grobe Sparte im Kreis (`Konzert`, `Party`, …).
 * - `.hover-in`: Ticketlink, Titel fett, darunter Zeilen (Status, Tourname,
 *   `Support: …`), die feine Sparte (`span.desktoponly`), `Ort: …` und
 *   `Wochentag TT.MM. HH:MM`.
 *
 * Hinweiskästen (`ab 02.11.26 – Bargeldlose Zahlung`) stehen als Block mit
 * Termin-ID dazwischen, tragen aber keinen Tag, nur ein „ab“: sie zählen nicht.
 */

const SOURCE_ID = 'muffatwerk';
const BASE = 'https://www.muffatwerk.de';

type Block = cheerio.Cheerio<never>;

/**
 * `referenceDay` (YYYY-MM-DD) wählt das Jahr für Termine, deren Kopf nur
 * „Heute“ oder „Morgen“ sagt – dann steht das Jahr nirgends am Termin.
 */
export function parseProgramme(html: string, referenceDay: string): PageResult {
  const $ = cheerio.load(html);
  const container = $('#content');
  const blocks = container.find('div.entry.event');

  const events: CalendarEvent[] = [];
  let skipped = 0;
  blocks.each((_, element) => {
    const parsed = parseBlock($, $(element) as Block, referenceDay);
    if (parsed === 'notice') return;
    if (!parsed) {
      skipped += 1;
      return;
    }
    events.push(...parsed);
  });

  // Leer: der Container steht mit seiner Überschrift da, aber ohne Termin.
  const empty = blocks.length === 0 && container.find('div.entry-big h1').length > 0;
  return { events, skipped, empty };
}

function parseBlock(
  $: cheerio.CheerioAPI,
  block: Block,
  referenceDay: string,
): CalendarEvent[] | 'notice' | undefined {
  const sourceKey = /^event(\d+)$/.exec(block.attr('id') ?? '')?.[1];
  if (!sourceKey) return undefined;

  const out = block.find('.hover-out').first();
  const inner = block.find('.hover-in').first();
  const dateParts = splitLines(out.find('.date').first().html() ?? '');
  if (dateParts[0]?.toLowerCase() === 'ab') return 'notice';

  const center = inner.find('.entry-data.center').first();
  const centerHtml = center.html() ?? '';
  const whenText = clean(centerHtml.split('—</span>').pop()?.replace(/<[^>]+>/g, ' ') ?? '');
  const days = readDays(dateParts, whenText, referenceDay);
  if (days.length === 0) return undefined;
  const time = /(\d{1,2}):(\d{2})/.exec(whenText);

  const titleSpan = center.children('span').first();
  const title = clean(splitLines(titleSpan.html() ?? '').join(' '));
  if (!title) return undefined;

  const href = block.find('.hover-in .entry-data.right a[href]').first().attr('href') ?? '';
  const url = href ? new URL(href, BASE).toString() : `${BASE}/de/events/view/${sourceKey}`;

  // Zeilen zwischen Titel und Sparte: Status, Tourname, Support.
  const beforeCategory = centerHtml.split(/<span class="desktoponly"/)[0] ?? '';
  const titleEnd = beforeCategory.indexOf('</span>');
  let lines = splitLines(titleEnd >= 0 ? beforeCategory.slice(titleEnd + '</span>'.length) : '');

  const status = clean(out.find('.entry-data.center span').first().text());
  const state = readState(status);
  if (state) lines = lines.filter((line) => line.toLowerCase() !== status.toLowerCase());

  const notes: string[] = [];
  const subtitleLines: string[] = [];
  for (const line of lines) {
    if (/^support:/i.test(line)) notes.push(line);
    else subtitleLines.push(line);
  }

  const place = /Ort:\s*([^<]*)</.exec(centerHtml)?.[1];
  const placeText = clean(place ? cheerio.load(place).text() : '');
  const moved = /^(.*?)\s*\((verlegt[^)]*)\)$/i.exec(placeText);
  const venueName = moved ? moved[1] : placeText;
  if (moved) notes.push(`Hinweis: ${moved[2]}`);
  if (!venueName) return undefined;

  const fineCategory = clean(center.find('span.desktoponly').first().text());
  const coarseCategory = clean(out.find('.circle').first().text());
  const category = isLabel(fineCategory) ? fineCategory : isLabel(coarseCategory) ? coarseCategory : undefined;

  const ticket = inner.find('.entry-data.left a[href]').first();
  const ticketUrl = ticket.attr('href') || undefined;
  const availability: Availability = state?.availability ?? (ticketUrl ? 'available' : 'unknown');

  return days.map((day) => ({
    id: days.length > 1 ? `${SOURCE_ID}:${sourceKey}:${day}` : `${SOURCE_ID}:${sourceKey}`,
    sourceId: SOURCE_ID,
    title,
    subtitle: subtitleLines.length ? subtitleLines.join(' · ') : undefined,
    category,
    start: time ? berlinIso(day, Number(time[1]), Number(time[2])) : berlinIso(day),
    allDay: !time,
    venue: { name: venueName },
    availability,
    availabilityLabel: state?.label,
    ticketUrl: state ? undefined : ticketUrl,
    url,
    notes: notes.length ? notes : undefined,
  }));
}

/** Tage des Termins als YYYY-MM-DD. */
function readDays(dateParts: string[], whenText: string, referenceDay: string): string[] {
  const joined = dateParts.join(' ');
  // „12.01.27 & 13.01.27“: mehrere Tage, je ein Termin.
  const full = [...joined.matchAll(/(\d{2})\.(\d{2})\.(\d{2})\b/g)];
  if (full.length > 0) return full.map((m) => `20${m[3]}-${m[2]}-${m[1]}`);
  // „Di / 10.11 / 26“
  const dayMonth = /(\d{2})\.(\d{2})/.exec(joined);
  const year = dateParts.find((part) => /^\d{2}$/.test(part));
  if (dayMonth && year) return [`20${year}-${dayMonth[2]}-${dayMonth[1]}`];
  // „Heute“ / „Morgen“: Tag und Monat aus der Zeile im Hover, Jahr am nächsten.
  const fromWhen = /(\d{2})\.(\d{2})\./.exec(whenText);
  if (fromWhen) return [nearestYear(fromWhen[1], fromWhen[2], referenceDay)];
  return [];
}

function nearestYear(day: string, month: string, referenceDay: string): string {
  const reference = Date.parse(`${referenceDay}T00:00:00Z`);
  const baseYear = Number(referenceDay.slice(0, 4));
  let best = '';
  let bestDistance = Infinity;
  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const candidate = `${year}-${month}-${day}`;
    const distance = Math.abs(Date.parse(`${candidate}T00:00:00Z`) - reference);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function readState(status: string): { availability: Availability; label?: string } | undefined {
  if (/ausverkauft/i.test(status)) return { availability: 'soldout' };
  if (/abgesagt/i.test(status)) return { availability: 'not_on_sale', label: 'Abgesagt' };
  if (/verlegt/i.test(status)) return { availability: 'not_on_sale', label: capitalise(status) };
  return undefined;
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase('de-DE') + text.slice(1);
}

function isLabel(text: string): boolean {
  return /\p{L}/u.test(text);
}

/** HTML an `<br>` in bereinigte, nicht leere Textzeilen teilen. */
function splitLines(html: string): string[] {
  return html
    .split(/<br\s*\/?>|<\/br>/i)
    .map((part) => clean(cheerio.load(`<div>${part}</div>`)('div').text()))
    .filter(Boolean);
}

/**
 * Detailseite `/de/events/view/{ID}/{slug}`: Programmtext, Einlass, Beginn
 * und Preise aus `p.entry-info`.
 *
 *   Di 10.11.<br> Konzert<br> Einlass: 19<sup>Uhr</sup> Beginn: 20<sup>Uhr</sup><br>
 *   Ort: Muffathalle<sup>München</sup><br> VVK ab € 46,95 inkl. Gebühren<br>
 *   <span>präsentiert von …</span>
 */
export function parseEventDetail(html: string): EventDetail | undefined {
  const $ = cheerio.load(html);
  const opened = $('div.entry.entry-normal.opened .entry-content').first();
  if (opened.length === 0) return undefined;

  const detail: EventDetail = {};
  const text = opened.children('div').first();
  const description = splitLines(text.html() ?? '').join('\n');
  if (description) detail.description = description;

  const info = opened.children('p.entry-info').first();
  info.children('span').remove();
  info.find('sup').each((_, sup) => {
    const value = $(sup).text().trim();
    // „19<sup>Uhr</sup>“ bzw. „19<sup>30</sup>“; „Muffathalle<sup>München</sup>“ fällt weg.
    $(sup).replaceWith(/^uhr$/i.test(value) ? ' Uhr' : /^\d{2}$/.test(value) ? `:${value} Uhr` : '');
  });
  const lines = splitLines(info.html() ?? '');

  const notes: string[] = [];
  const doors = lines.map((line) => /Einlass:\s*(\d{1,2})(?:[:.](\d{2}))?/.exec(line)).find(Boolean);
  if (doors) notes.push(`Einlass: ${formatTime(doors[1], doors[2])}`);
  const begins = lines.map((line) => /Beginn:\s*(\d{1,2})(?:[:.](\d{2}))?/.exec(line)).find(Boolean);
  if (begins) detail.startTime = formatTime(begins[1], begins[2]);

  // Preise: was nach der Ortszeile steht.
  const placeIndex = lines.findIndex((line) => /^Ort:/.test(line));
  const prices = placeIndex >= 0 ? lines.slice(placeIndex + 1).join(' ') : '';
  if (prices) notes.push(`Preise: ${prices}`);

  if (notes.length) detail.notes = notes;
  return Object.keys(detail).length ? detail : undefined;
}

function formatTime(hour: string, minute = '00'): string {
  return `${hour.padStart(2, '0')}:${minute}`;
}
