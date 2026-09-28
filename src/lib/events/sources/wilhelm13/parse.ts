import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für die Startseite von Wilhelm13 (Oldenburg).
 *
 * Die Seite führt alle kommenden Veranstaltungen auf einmal: jede als
 * `article.event-card` in `.events-grid`, und jede Karte trägt ihre Daten
 * zusätzlich als JSON (`script.event-card__payload`) – daraus baut die Seite
 * ihr Detail-Popover. Gelesen wird dieses JSON; das Markup liefert nur den
 * Buchungsknopf, den das JSON nicht kennt.
 *
 * Eine Veranstaltungsart nennt die Quelle nicht, wohl aber den Veranstalter
 * im Haus (`partnerName`): die Jazzmusiker-Initiative, Singers & Players, das
 * Literaturhaus Oldenburg und weitere. Nur das Literaturhaus bestimmt die Art
 * eindeutig – seine Abende sind Lesungen. Alles Übrige ist Musik und fällt
 * auf `defaultCategory` der Quelle.
 */

const SOURCE_ID = 'wilhelm13';
const BASE = 'https://wilhelm13.de';
const VENUE = 'Wilhelm13';

/** Veranstalter, deren Name die Art eindeutig macht. */
const PARTNER_CATEGORY: Record<string, string> = {
  LIT: 'Literatur',
};

interface Payload {
  id?: number | string;
  name?: string;
  datetime?: string;
  beschreibungHtml?: string;
  textHtml?: string;
  preis1?: string;
  preis2?: string;
  abendkassePreis1?: string;
  abendkassePreis2?: string;
  partnerName?: string | null;
  externalBookingUrl?: string | null;
}

export function parseEvents(html: string): PageResult {
  const $ = cheerio.load(html);

  // Die Liste ist gerendert, sobald das Raster da ist – auch ohne Karte.
  const grid = $('.events-grid');
  if (grid.length === 0) return { events: [], skipped: 0, empty: false };

  const events: CalendarEvent[] = [];
  let skipped = 0;

  grid.find('article.event-card').each((_, element) => {
    const card = $(element);
    const payload = readPayload(card.find('script.event-card__payload').first().text());

    const id = String(payload?.id ?? card.attr('data-event-id') ?? '').trim();
    const title = clean(payload?.name ?? card.find('.event-title').first().text());
    const when = parseDateTime(payload?.datetime ?? card.find('.event-meta-line').first().text());

    if (!/^\d+$/.test(id) || !title || !when) {
      skipped++;
      return;
    }

    const button = card.find('.card-actions a[href]').first();
    const ticket = readTicket(clean(button.text()), button.attr('href'));
    const partner = clean(payload?.partnerName ?? '');

    events.push({
      id: `${SOURCE_ID}:${id}`,
      sourceId: SOURCE_ID,
      title,
      description: joinTexts([payload?.beschreibungHtml, payload?.textHtml]),
      category: PARTNER_CATEGORY[partner],
      start: berlinIso(when.date, when.time?.hour ?? 0, when.time?.minute ?? 0),
      allDay: !when.time,
      venue: { name: VENUE },
      availability: ticket.availability,
      availabilityLabel: ticket.label,
      ticketUrl: ticket.url,
      // Die Seite öffnet mit `?preview_event=` das Popover dieser Karte.
      url: `${BASE}/?preview_event=${id}`,
      notes: priceNotes(payload),
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/* ------------------------------------------------------------------ */

function readPayload(text: string): Payload | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as Payload;
  } catch {
    return undefined;
  }
}

/** "01.10.2026 - 20:00 Uhr" */
function parseDateTime(
  label: string,
): { date: string; time?: { hour: number; minute: number } } | undefined {
  const match = label.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*-\s*(\d{1,2})[:.](\d{2}))?/);
  if (!match) return undefined;

  const [, d, m, y, hh, mm] = match;
  const day = Number(d);
  const month = Number(m);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;

  const date = `${y}-${pad(month)}-${pad(day)}`;
  if (hh === undefined) return { date };
  const hour = Number(hh);
  const minute = Number(mm);
  if (hour > 23 || minute > 59) return { date };
  return { date, time: { hour, minute } };
}

/**
 * Jede Karte hat genau einen Knopf: „Reservieren“ für die hauseigene
 * Reservierung, „Buchen“ für einen fremden Vorverkauf (Literaturhaus
 * Oldenburg, ticket2go). Beides heisst: es gibt Karten. Wie viele, sagt erst
 * das Reservierungsformular – das wird nicht abgefragt.
 */
function readTicket(
  label: string,
  href: string | undefined,
): { availability: Availability; label?: string; url?: string } {
  if (!label && !href) return { availability: 'unknown' };
  if (/ausverkauft/i.test(label)) return { availability: 'soldout', label };

  // Der Knopftext ist eine Handlung, kein Zustand – als Etikett taugt er nicht.
  const url = href ? absolute(href) : undefined;
  return { availability: url ? 'available' : 'unknown', url };
}

function priceNotes(payload: Payload | undefined): string[] | undefined {
  if (!payload) return undefined;
  const regular = clean(payload.preis1 ?? '');
  const reduced = clean(payload.preis2 ?? '');
  const doorRegular = clean(payload.abendkassePreis1 ?? '');
  const doorReduced = clean(payload.abendkassePreis2 ?? '');

  if (/eintritt frei/i.test(regular)) return ['Eintritt frei'];

  const notes: string[] = [];
  if (regular) notes.push(reduced ? `Vorverkauf ${regular}, ermäßigt ${reduced}` : `Vorverkauf ${regular}`);
  if (doorRegular) {
    notes.push(doorReduced ? `Abendkasse ${doorRegular}, ermäßigt ${doorReduced}` : `Abendkasse ${doorRegular}`);
  }
  return notes.length ? notes : undefined;
}

/** Kurztext und Langtext der Karte, als Absätze, ohne Wiederholung. */
function joinTexts(fragments: (string | undefined)[]): string | undefined {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const fragment of fragments) {
    for (const paragraph of htmlParagraphs(fragment ?? '')) {
      if (seen.has(paragraph)) continue;
      seen.add(paragraph);
      paragraphs.push(paragraph);
    }
  }
  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

function htmlParagraphs(fragment: string): string[] {
  if (!fragment.trim()) return [];
  const withBreaks = fragment
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n');
  const text = cheerio.load(`<div>${withBreaks}</div>`)('div').first().text();
  return text
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map(clean).filter(Boolean).join('\n'))
    .filter(Boolean);
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}/${href.replace(/^\//, '')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
