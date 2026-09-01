import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean, softenShouted } from '../../text.ts';

/**
 * Parser für das Programm des Werkstattkinos (`https://werkstattkino.de/`).
 *
 * Das Kino pflegt keinen Kalender und keine Datenbank: die Startseite ist eine
 * einzige WordPress-Seite mit Fliesstext. Zwei Darstellungen desselben
 * Programms stehen darin, und beide werden gelesen, weil keine die andere
 * enthält:
 *
 *  1. **PROGRAMMÜBERSICHT** – am Fuss der Seite, je Vorstellung eine Zeile
 *     `Di. 1.9. um 18.15 h: TITEL (OmU) | Letzte Vorstellung!`. Das ist die
 *     verlässliche Fassung: eine Zeile, ein Termin, mit Titel.
 *  2. **Filmblöcke** – je Film ein Absatz mit Land, Jahr, Regie und
 *     Inhaltsangabe, darin fett die Spieltermine
 *     (`Mittwoch, 2.9. und Donnerstag, 3.9. jeweils um 22.00 h`). Diese
 *     Blöcke reichen weiter in die Zukunft als die Übersicht und liefern den
 *     Programmtext.
 *
 * Das Werkstattkino hat einen Saal – Tag und Uhrzeit identifizieren eine
 * Vorstellung eindeutig und dienen als ID. Wo beide Fassungen denselben Termin
 * nennen, gewinnt die Übersicht beim Titel; der Filmblock steuert die
 * Beschreibung bei.
 *
 * Ein Jahr steht nirgends auf der Seite. Es wird aus dem Bezugstag abgeleitet:
 * gewählt wird das Jahr, mit dem der Termin am nächsten bei "heute" liegt,
 * Zukunft bevorzugt. Die Seite führt nur laufendes und kommendes Programm.
 */

const SOURCE_ID = 'werkstattkino';
const BASE = 'https://werkstattkino.de';
const VENUE = 'Werkstattkino';

/** "Di. 1.9. um 18.15 h: TITEL" – eine Zeile der Programmübersicht. */
const OVERVIEW = /^\p{L}{2,}\.?,?\s*(\d{1,2})\.(\d{1,2})\.\s*um\s*(\d{1,2})[.:](\d{2})\s*h?\s*:\s*(.+)$/u;

/** "1.9." – ein Datum ohne Jahr, wie die Filmblöcke es schreiben. */
const DAY = /(\d{1,2})\.(\d{1,2})\.(?!\d)/;

/** "um 20.15 h", auch ohne das "h" am Ende. */
const CLOCK = /um\s*(\d{1,2})[.:](\d{2})/;

export interface ParseResult {
  events: CalendarEvent[];
  /** Terminzeilen, die sich nicht eindeutig auflösen liessen. */
  skipped: number;
}

/**
 * @param today Bezugstag "YYYY-MM-DD" für die Wahl des Jahres.
 */
export function parseProgrammePage(html: string, today: string): ParseResult {
  const $ = cheerio.load(html);
  const content = $('.entry-content').first();
  if (content.length === 0) return { events: [], skipped: 0 };

  const films = readFilms($, content, today);
  const overview = readOverview($, content, today);

  // Die Übersicht führt, die Filmblöcke füllen auf – gleicher Tag, gleiche
  // Uhrzeit ist im Ein-Saal-Kino dieselbe Vorstellung.
  const bySlot = new Map<string, Screening>();
  for (const screening of [...films.screenings, ...overview.screenings]) {
    bySlot.set(screening.slot, { ...bySlot.get(screening.slot), ...screening });
  }

  const events = [...bySlot.values()]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((screening) => toEvent(screening, films.descriptions));

  return { events, skipped: films.skipped + overview.skipped };
}

/* ------------------------------------------------------------------ */

type Root = cheerio.CheerioAPI;
type Node = ReturnType<Root>;

interface Screening {
  /** "YYYY-MM-DD HH:MM" – im Ein-Saal-Kino eindeutig. */
  slot: string;
  date: string;
  hour: number;
  minute: number;
  title: string;
  notes: string[];
}

/**
 * Programmübersicht: eine Zeile je Vorstellung. Alles hinter dem Titel –
 * Klammerzusätze wie "(OmU)" und Abschnitte hinter "|" – sind Hinweise.
 */
function readOverview($: Root, content: Node, today: string) {
  const screenings: Screening[] = [];
  let skipped = 0;

  content.find('div, p, li').each((_, element) => {
    const line = clean($(element).text());
    const match = line.match(OVERVIEW);
    if (!match) return;

    const date = resolveYear(Number(match[1]), Number(match[2]), today);
    if (!date) {
      skipped++;
      return;
    }

    const [rawTitle, ...rest] = match[5].split('|').map(clean);
    const notes = rest.filter(Boolean);

    // "WHERE THE WAVES TOOK HER (OmU)" – Klammerzusatz ist ein Hinweis.
    const suffix = rawTitle.match(/\s*\(([^()]*)\)\s*$/);
    const title = clean(suffix ? rawTitle.slice(0, suffix.index) : rawTitle);
    if (suffix) notes.unshift(clean(suffix[1]));

    if (!title) {
      skipped++;
      return;
    }

    const hour = Number(match[3]);
    const minute = Number(match[4]);
    screenings.push({ slot: `${date} ${pad(hour)}:${pad(minute)}`, date, hour, minute, title, notes });
  });

  return { screenings, skipped };
}

/**
 * Filmblöcke: je Absatz ein Film. Die erste Zeile ist der Titel, die fetten
 * Zeilen mit Datum sind die Termine, der Rest ist Programmtext.
 *
 * Terminzeilen werden an "|" in Abschnitte geteilt. Ein Abschnitt mit genau
 * einer Uhrzeit gibt diese an alle seine Daten weiter – so löst sich
 * "Samstag, 5.9. / Montag, 7.9. / Dienstag, 8.9. jeweils um 20.00 h" korrekt
 * auf. Alles andere wird übersprungen statt geraten.
 */
function readFilms($: Root, content: Node, today: string) {
  const screenings: Screening[] = [];
  const descriptions = new Map<string, string>();
  let skipped = 0;

  content.children('p').each((_, element) => {
    const block = $(element).clone();
    block.find('br').replaceWith('\n');
    const lines = block
      .text()
      .split('\n')
      .map(clean)
      .filter(Boolean);
    if (lines.length < 2) return;

    const title = lines[0];
    // Ein Filmblock beginnt mit dem Titel und nennt weiter unten Termine.
    const dateLines = lines.slice(1).filter((line) => DAY.test(line));
    if (dateLines.length === 0 || DAY.test(title)) return;

    const prose = lines
      .slice(1)
      .filter((line) => !dateLines.includes(line))
      .join('\n');
    if (prose) descriptions.set(key(title), prose);

    for (const line of dateLines) {
      for (const segment of line.split('|').map(clean)) {
        const days = [...segment.matchAll(new RegExp(DAY, 'g'))];
        if (days.length === 0) continue;

        const clock = segment.match(CLOCK);
        if (!clock) {
          skipped++;
          continue;
        }

        const hour = Number(clock[1]);
        const minute = Number(clock[2]);
        for (const day of days) {
          const date = resolveYear(Number(day[1]), Number(day[2]), today);
          if (!date) {
            skipped++;
            continue;
          }
          screenings.push({
            slot: `${date} ${pad(hour)}:${pad(minute)}`,
            date,
            hour,
            minute,
            title,
            notes: [],
          });
        }
      }
    }
  });

  return { screenings, descriptions, skipped };
}

function toEvent(screening: Screening, descriptions: Map<string, string>): CalendarEvent {
  return {
    id: `${SOURCE_ID}:${screening.slot.replace(' ', '-').replace(':', '')}`,
    sourceId: SOURCE_ID,
    title: softenShouted(screening.title),
    // Gattung führt die Quelle nicht; der Fallback steht in der Definition.
    description: lookupDescription(screening.title, descriptions),
    start: berlinIso(screening.date, screening.hour, screening.minute),
    allDay: false,
    venue: { name: VENUE },
    // Das Kino verkauft weder online noch nimmt es Reservierungen an:
    // Karten gibt es nur an der Abendkasse, 15 Minuten vor Beginn.
    availability: 'not_on_sale',
    availabilityLabel: 'Nur Abendkasse',
    url: BASE,
    notes: screening.notes.length ? [...new Set(screening.notes)] : undefined,
  };
}

/**
 * Die Übersicht kürzt Titel gelegentlich ("SEMILLAS" statt "SEMILLAS – BIS DER
 * REGEN FÄLLT"). Deshalb erst exakt, dann über den gemeinsamen Anfang suchen.
 */
function lookupDescription(title: string, descriptions: Map<string, string>): string | undefined {
  const wanted = key(title);
  const exact = descriptions.get(wanted);
  if (exact) return exact;

  const matches = [...descriptions].filter(
    ([candidate]) => candidate.startsWith(wanted) || wanted.startsWith(candidate),
  );
  return matches.length === 1 ? matches[0][1] : undefined;
}

/** Vergleichsform eines Titels: ohne Versalien, Satzzeichen und Leerraum. */
function key(title: string): string {
  return title.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Tag und Monat mit dem Jahr versehen. Gewählt wird das Jahr, mit dem der
 * Termin am nächsten bei "heute" liegt; Rückwärts zählt doppelt, weil die
 * Seite nach vorn blickt. Damit bleibt eine Zeile vom Monatsanfang auch Mitte
 * des Monats im richtigen Jahr, und ein Januartermin auf der Dezemberseite
 * rutscht nicht ins alte Jahr.
 */
function resolveYear(day: number, month: number, today: string): string | undefined {
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;

  const reference = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(reference)) return undefined;

  const year = Number(today.slice(0, 4));
  let best: { date: string; distance: number } | undefined;
  for (const candidate of [year - 1, year, year + 1]) {
    const date = `${candidate}-${pad(month)}-${pad(day)}`;
    const value = Date.parse(`${date}T12:00:00Z`);
    if (Number.isNaN(value)) continue;
    const days = (value - reference) / 86_400_000;
    // Rückwärts wiegt schwerer als vorwärts: die Seite blickt nach vorn.
    const distance = days < 0 ? -days * 2 : days;
    if (!best || distance < best.distance) best = { date, distance };
  }

  return best?.date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
