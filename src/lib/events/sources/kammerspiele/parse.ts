import * as cheerio from 'cheerio';
import type { Availability, CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für die Spielplanseite der Münchner Kammerspiele (`/de/programm/`).
 *
 * Aufbau: je Spieltag ein `div.events-group[data-date]` – das ISO-Datum steht
 * im Attribut, also kein Rätselraten ums Jahr –, darin je Termin ein
 * `li.preview-event`. Die Seite liefert die **gesamte Spielzeit** in einer
 * Antwort; einen Monatsparameter gibt es nicht und braucht es nicht.
 *
 * Beginn und Spielstätte stehen im letzten Absatz von `.preview-event__text`
 * ("20:00 – 21:10 Schauspielhaus"). Weiter oben können Absätze mit eigener
 * Uhrzeit stehen ("19:45 Eröffnung der Jubiläumsspielzeit …") – das sind
 * Hinweise, keine Anfangszeit. Die aria-Beschriftung des iCal-Knopfs ("… am
 * 23.9.2026 um 20:00") bestätigt in der Fixture durchgehend den letzten
 * Absatz und dient als Kontrollsignal.
 *
 * Termine der kommenden Spielzeit tragen häufig nur die Spielstätte und noch
 * keine Uhrzeit. Dann bleibt es bei `allDay`, statt eine zu erfinden.
 */

/** "20:00" oder "20:00 – 21:10" am Anfang eines Absatzes. */
const TIME = /^(\d{1,2}):(\d{2})(?:\s*[\u2013\u2014-]\s*(\d{1,2}):(\d{2}))?\s*/;

const SOURCE_ID = 'kammerspiele';
const BASE = 'https://www.muenchner-kammerspiele.de';

export interface ParseResult {
  events: CalendarEvent[];
  /** Blöcke ohne Titel oder Vorstellungs-ID – für Monitoring/Logs. */
  skipped: number;
}

export function parseProgrammePage(html: string): ParseResult {
  const $ = cheerio.load(html);

  const events: CalendarEvent[] = [];
  let skipped = 0;

  $('div.events-group').each((_, group) => {
    const date = $(group).attr('data-date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    $(group)
      .find('li.preview-event')
      .each((_, element) => {
        const item = $(element);

        const link = item.find('.preview-event__title').first();
        const title = clean(link.text());
        // Die iCal-Adresse trägt die Vorstellungs-ID: …/51507-danton/52293.ics
        const icsHref = item.find('.event-button--ical').first().attr('href');
        const performanceId = icsHref?.match(/\/(\d+)\.ics$/)?.[1];

        if (!title || !performanceId) {
          skipped++;
          return;
        }

        const text = readText($, item);
        const ticket = readTicket(item);
        if (ticket.note) text.hints.push(ticket.note);

        events.push({
          id: `${SOURCE_ID}:${performanceId}`,
          sourceId: SOURCE_ID,
          title: softenShouted(title),
          subtitle: text.subtitle,
          // Die Liste führt keinen Programmtext; der kommt von der
          // Produktionsseite (siehe `parseDetailDescription`).
          // Ebenso keine Gattung – der Fallback steht in der Definition.
          start: berlinIso(date, text.start?.hour ?? 0, text.start?.minute ?? 0),
          end: text.start && text.end ? berlinIso(date, text.end.hour, text.end.minute) : undefined,
          allDay: !text.start,
          // Keine feste Stadt: die Kammerspiele führen auch Gastspiele.
          venue: { name: text.venue || 'Münchner Kammerspiele' },
          availability: ticket.availability,
          availabilityLabel: ticket.label,
          ticketUrl: ticket.url,
          url: absolute(link.attr('href') ?? item.attr('data-href')) ?? `${BASE}/de/programm/`,
          icsUrl: absolute(icsHref),
          notes: collectNotes($, item, text.hints),
        });
      });
  });

  return { events, skipped };
}

/**
 * Langtext der Produktionsseite. Der Fliesstext steht in `div.text--format`;
 * die Besetzungsliste trägt dieselbe Klasse und wird ausgenommen.
 */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html);

  const paragraphs: string[] = [];
  const seen = new Set<string>();
  $('div.text--format')
    .not('.artists')
    .find('p')
    .each((_, element) => {
      const text = clean($(element).text());
      if (text.length < 80 || seen.has(text)) return;
      seen.add(text);
      paragraphs.push(text);
    });

  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

/* ------------------------------------------------------------------ */

type Root = cheerio.CheerioAPI;
type Item = ReturnType<Root>;

interface Ticket {
  availability: Availability;
  label?: string;
  url?: string;
  /** Zweite Zeile des Knopfs – gehört zu den Hinweisen, nicht zur Lage. */
  note?: string;
}

interface Clock {
  hour: number;
  minute: number;
}

interface TextParts {
  start?: Clock;
  end?: Clock;
  venue?: string;
  /** Zweite Zeile der Produktion (Autor, Ensemble, Gattung). */
  subtitle?: string;
  /** Weitere Absätze – Vorprogramm, Publikumsgespräch, Sprachfassung. */
  hints: string[];
}

function readText($: Root, item: Item): TextParts {
  const paragraphs: { text: string; schedule: boolean }[] = [];
  item.find('.preview-event__text p').each((_, element) => {
    // <br> trennt Inhalte, nicht nur Zeilen.
    const node = $(element).clone();
    node.find('br').replaceWith(' ');
    const raw = node.text();
    const text = clean(raw);
    // Der Absatz mit Beginn und Spielstätte wird als "{Uhrzeit} {Ort}"
    // gesetzt. Fehlt die Uhrzeit noch, bleibt ihr Leerzeichen stehen – daran
    // ist er auch dann von der zweiten Zeile der Produktion zu unterscheiden.
    if (text) paragraphs.push({ text, schedule: TIME.test(text) || /^[\s\u00a0]/.test(raw) });
  });

  if (paragraphs.length === 0) return { hints: [] };

  // Massgeblich ist der letzte Terminabsatz: davor stehen Hinweise mit
  // eigener Uhrzeit ("Einführung ab 19:30"), danach Anschlussprogramm
  // ("Anschl. Publikumsgespräch") – beides sind Notizen.
  const chosen = paragraphs.reduce((last, p, index) => (p.schedule ? index : last), -1);
  if (chosen < 0) return { subtitle: paragraphs[0].text, hints: paragraphs.slice(1).map(toText) };

  const time = paragraphs[chosen].text.match(TIME);
  const parts: TextParts = {
    venue: clean(paragraphs[chosen].text.slice(time ? time[0].length : 0)) || undefined,
    hints: [],
  };
  if (time) {
    parts.start = { hour: Number(time[1]), minute: Number(time[2]) };
    if (time[3]) parts.end = { hour: Number(time[3]), minute: Number(time[4]) };
  }

  const rest = paragraphs.filter((_, index) => index !== chosen).map(toText);
  // Die zweite Zeile der Produktion steht immer zuoberst.
  if (chosen > 0) parts.subtitle = rest.shift();
  parts.hints = rest;

  return parts;
}

/**
 * Ticketlage aus zwei unabhängigen Signalen: dem Elementtyp und dem Text.
 *
 * Ein `<span>` ohne Adresse ist kein Kaufknopf – "Im VVK ab 1.10." steht als
 * `span.event-button--notyetonsale` und wird zum `<a>`, sobald der Vorverkauf
 * läuft. Der Knopf gewinnt damit über den Text.
 */
function readTicket(item: Item): Ticket {
  const button = item
    .find('.event-buttons--overview > .event-button')
    .not('.event-button--ical, .event-button--details')
    .first();

  if (button.length === 0) return { availability: 'unknown' };

  // Zweizeilige Knöpfe trennen Beschriftung und Zusatz: "Ausverkauft" +
  // "mit Warteliste", "Hier kostenlos anmelden" + Anmeldeadresse.
  const wrapped = clean(button.find('.event-button__wrap__label').first().text());
  const note = clean(button.find('.event-button__wrap__note').first().text()) || undefined;
  const label = wrapped || clean(button.text());
  const lower = label.toLocaleLowerCase('de-DE');
  const href = button.attr('href');
  const url = href?.startsWith('http') ? href : undefined;

  // Ausverkauft steht mal als <a> mit Warteliste, mal als <button disabled>.
  if (
    lower.includes('ausverkauft') ||
    button.is('[disabled]') ||
    button.hasClass('event-button--inactive') ||
    button.hasClass('event-button--inactive-wait')
  ) {
    return { availability: 'soldout', label: label || undefined, note };
  }

  // Kein anklickbarer Knopf: "Im VVK ab …", "Bald im VVK", "Kostenfrei".
  if (!button.is('a[href]')) return { availability: 'not_on_sale', label: label || undefined, note };

  if (/wenige|letzte|restkarten/.test(lower)) return { availability: 'limited', label, url, note };

  return { availability: 'available', label, url, note };
}

function collectNotes($: Root, item: Item, hints: string[]): string[] | undefined {
  const notes: string[] = [];

  item.find('.event-label').each((_, element) => {
    const label = clean($(element).text());
    if (label) notes.push(label);
  });
  notes.push(...hints);

  return notes.length ? [...new Set(notes)] : undefined;
}

function toText(paragraph: { text: string }): string {
  return paragraph.text;
}

function absolute(href?: string): string | undefined {
  if (!href) return undefined;
  return href.startsWith('http') ? href : `${BASE}${href}`;
}
