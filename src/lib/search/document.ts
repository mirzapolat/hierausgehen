import type { CalendarEvent, SourceDefinition } from '../events/types.ts';
import { seriesKey } from '../events/series.ts';
import { isFreeEntry, PRICE } from '../events/price.ts';
import { noteFacts } from '../events/notes.ts';
import { clean } from '../events/text.ts';
import { translateTerm } from '../i18n.ts';
import { fold } from './normalize.ts';

/**
 * Was die Suche über eine Veranstaltung weiss.
 *
 * Gesucht wird nach Produktionen, nicht nach einzelnen Terminen: ein Musical
 * mit 52 Vorstellungen ist ein Treffer mit 52 Terminen, kein Stapel von 52
 * gleichen Zeilen, der alles andere von der ersten Seite drückt. Der Text ist
 * über alle Termine einer Reihe derselbe; was sich unterscheidet – Tag,
 * Uhrzeit, Preis, Ticketlage –, bewertet die Rangfolge je Termin.
 *
 * Alles hier leitet sich aus `CalendarEvent` ab. Das Datenmodell bekommt
 * keine Suchfelder; was die Suche braucht (Mitwirkende, Preis, „für Kinder"),
 * entsteht beim Aufbau des Index.
 */

export const FIELDS = ['title', 'people', 'subtitle', 'venue', 'labels', 'description', 'notes'] as const;
export type Field = (typeof FIELDS)[number];

export interface SearchDoc {
  /** `seriesKey` der Reihe. */
  key: string;
  /** Alle Termine der Reihe, nach Beginn sortiert. */
  events: CalendarEvent[];
  /** Der Termin mit dem meisten Text – er spricht für die Reihe. */
  representative: CalendarEvent;
  fields: Record<Field, string>;
  people: string[];
  kidFriendly: boolean;
  /** Text für das Embedding, ohne Präfix. */
  embedText: string;
  /** Fingerabdruck von `embedText` – ändert er sich, wird neu eingebettet. */
  hash: string;
}

export function buildDocs(events: CalendarEvent[], definitions: SourceDefinition[]): SearchDoc[] {
  const sourceNames = new Map(definitions.map((source) => [source.id, source.name]));

  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = productionKey(event);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }

  const productions = [...groups].map(([key, members]) => {
    const sorted = [...members].sort((a, b) => a.start.localeCompare(b.start));
    return { key, events: sorted, representative: richest(sorted) };
  });

  const boilerplate = boilerplateBySource(productions.map((p) => p.representative));

  return productions.map(({ key, events: members, representative: event }) => {
    const description = withoutBoilerplate(event.description ?? '', boilerplate.get(event.sourceId));
    const people = extractPeople(event);
    const labels = [
      event.category,
      event.category ? translateTerm('en', event.category) : undefined,
      event.categoryLabel,
      sourceNames.get(event.sourceId),
    ]
      .filter(Boolean)
      .join(' · ');
    const fields: Record<Field, string> = {
      title: event.title,
      people: people.join(' · '),
      subtitle: event.subtitle ?? '',
      venue: [event.venue.name, event.venue.place?.name].filter(Boolean).join(' · '),
      labels,
      description,
      notes: (event.notes ?? []).join(' · '),
    };
    const embedText = clean(
      [
        event.title,
        event.subtitle,
        people.length ? people.join(', ') : undefined,
        [event.category, event.categoryLabel].filter(Boolean).join(', '),
        event.venue.name,
        description.slice(0, 1500),
      ]
        .filter(Boolean)
        .join('. '),
    );
    return {
      key,
      events: members,
      representative: event,
      fields,
      people,
      kidFriendly: isKidFriendly(event),
      embedText,
      hash: hashText(embedText),
    };
  });
}

/**
 * Die Reihe nach `seriesKey` – nur ohne Untertitel, wenn der bloss Preise
 * trägt: die Staatsoper schreibt „Preise G, € 70 / 63 …" dorthin, und jede
 * Preisstufe wäre sonst eine eigene Produktion.
 */
export function productionKey(event: CalendarEvent): string {
  const subtitle = event.subtitle && PRICE.test(event.subtitle) ? undefined : event.subtitle;
  return seriesKey({ ...event, subtitle });
}

function richest(events: CalendarEvent[]): CalendarEvent {
  return events.reduce((best, event) => (textWeight(event) > textWeight(best) ? event : best));
}

function textWeight(event: CalendarEvent): number {
  return (event.description?.length ?? 0) + (event.subtitle?.length ?? 0) + (event.notes?.length ?? 0) * 20;
}

/* ------------------------------ Textbausteine ------------------------------ */

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => clean(sentence))
    .filter(Boolean);
}

/**
 * Sätze, die eine Quelle unter fast jeden Termin setzt („Wir sind leider
 * nicht barrierefrei", Anmeldehinweise der offenen Bühne). Im Index würden
 * sie genau die falschen Termine finden – wer „barrierefrei" sucht, bekäme
 * alle, die es nicht sind.
 *
 * Gezählt wird je Produktion, nicht je Termin: ein Stück mit 40 Vorstellungen
 * ist ein Text, nicht 40.
 */
export function boilerplateBySource(
  events: Pick<CalendarEvent, 'sourceId' | 'description'>[],
  { share = 0.3, minProductions = 8 }: { share?: number; minProductions?: number } = {},
): Map<string, Set<string>> {
  const bySource = new Map<string, { total: number; counts: Map<string, number> }>();
  for (const event of events) {
    const entry = bySource.get(event.sourceId) ?? { total: 0, counts: new Map<string, number>() };
    bySource.set(event.sourceId, entry);
    entry.total++;
    for (const sentence of new Set(sentences(event.description ?? ''))) {
      if (sentence.length < 20) continue;
      entry.counts.set(sentence, (entry.counts.get(sentence) ?? 0) + 1);
    }
  }

  const result = new Map<string, Set<string>>();
  for (const [sourceId, { total, counts }] of bySource) {
    if (total < minProductions) continue;
    const repeated = [...counts]
      .filter(([, count]) => count >= 3 && count > total * share)
      .map(([sentence]) => sentence);
    if (repeated.length) result.set(sourceId, new Set(repeated));
  }
  return result;
}

/**
 * Den Programmtext ohne die Sätze, die die Quelle überall anhängt – auch dort,
 * wo sie ohne Satzende am vorigen Text klebt („… 20 € ACHTUNG: Wir sind …").
 */
export function withoutBoilerplate(description: string, boilerplate: Set<string> | undefined): string {
  let text = clean(description);
  for (const sentence of boilerplate ?? []) {
    if (text.includes(sentence)) text = text.split(sentence).join(' ');
  }
  return clean(text);
}

/* ------------------------------- Mitwirkende ------------------------------- */

/** Beschriftungen in `notes`, hinter denen Namen stehen (gefaltet geprüft). */
const PEOPLE_LABEL =
  /^(?:regie|inszenierung|besetzung|mitwirkende|leitung|musikalische leitung|dirigent(?:in)?|dirigat|solist(?:in|en|innen)?|mit|cast|conductor|director|line-?up|kuenstler(?:in|innen)?|artists?|acts?|support|choreo(?:grafie|graphie|graphy)|komponist(?:in)?|autor(?:in)?|author|moderation|host)\s*:\s*/;

/**
 * Namen aus Untertitel und Zusatzinfos – „mit Julia Hagen (Violoncello) &
 * Sir Simon Rattle (Leitung)", „Besetzung: Saoirse Ronan, Jacob Anderson".
 *
 * Bewusst vorsichtig: genommen wird nur, was wie ein Name aussieht (ein bis
 * fünf Wörter, mindestens eins gross geschrieben, kein Satz). Ein fehlender
 * Name kostet wenig – er steht ja weiter im Untertitel –, ein falscher bläst
 * ein beliebiges Wort zu einem Namen auf.
 */
export function extractPeople(event: Pick<CalendarEvent, 'subtitle' | 'notes'>): string[] {
  const found: string[] = [];
  const subtitle = (event.subtitle ?? '').trim();
  const lead = /^(?:mit|with|feat\.?|featuring|von|by)\s+/i;
  if (lead.test(subtitle) || /\([^)]{2,40}\)/.test(subtitle)) {
    found.push(...namesIn(subtitle.replace(lead, '')));
  }
  for (const note of event.notes ?? []) {
    const text = note.trim();
    const label = PEOPLE_LABEL.exec(fold(text));
    // Die Faltung ändert die Länge nicht für die Zeichen einer Beschriftung
    // ausser bei Umlauten – deshalb über den Doppelpunkt schneiden.
    if (label) found.push(...namesIn(text.slice(text.indexOf(':') + 1)));
  }
  return [...new Set(found)];
}

function namesIn(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:,|;|&|\/|\+|\bund\b|\band\b|\bsowie\b|\bmit\b|\bwith\b|\bnach\b)\s*/i)
    // „Regie: Christian Stückl" innerhalb einer Aufzählung: die Beschriftung weg.
    .map((part) => clean(part.replace(/^[\p{L} ]{2,30}:\s*/u, '')))
    .filter((part) => {
      const tokens = part.split(' ');
      return (
        tokens.length <= 5 &&
        part.length >= 3 &&
        part.length <= 60 &&
        /^\p{Lu}/u.test(part) &&
        !/[.!?:]$/.test(part) &&
        !/\d{2}/.test(part)
      );
    });
}

/* --------------------------------- Kinder --------------------------------- */

const KIDS_CATEGORIES = new Set(['Kinder & Familie', 'Kindertheater', 'Kinder-Jugend-Oper', 'Krippenspiel']);
const KIDS_WORDS =
  /\b(?:kinder\w*|kindgerecht|familie\w*|family|families|kids|children|childrens|junges publikum)\b/;

/**
 * Für Kinder geeignet – nur, wenn die Quelle es sagt: über die Art, ihren
 * Wortlaut, Titel oder Untertitel („Familienkonzert") oder eine Altersangabe
 * bis zwölf Jahre.
 */
export function isKidFriendly(event: CalendarEvent): boolean {
  if (event.category && KIDS_CATEGORIES.has(event.category)) return true;
  const head = fold([event.categoryLabel, event.title, event.subtitle].filter(Boolean).join(' '));
  if (KIDS_WORDS.test(head)) return true;
  for (const note of event.notes ?? []) {
    const age = /(?:\bab|\bfrom|\bages?|\balter)\s*(\d{1,2})\s*(?:j\b|jahre|years|\+|$)/.exec(fold(note));
    if (age && Number(age[1]) <= 12) return true;
  }
  return false;
}

/* --------------------------------- Preise --------------------------------- */

export interface PriceFacts {
  free: boolean;
  /** Günstigster genannter Betrag; fehlt, wenn die Quelle keinen nennt. */
  min?: number;
}

const AMOUNT = /(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euro\b|£|chf\b)|[€£]\s*(\d+(?:[.,]\d{1,2})?)/gi;

/** Preis aus den Angaben der Quelle – nie geschätzt. */
export function priceOf(event: CalendarEvent): PriceFacts {
  if (isFreeEntry(event)) return { free: true, min: 0 };
  const lines = [...noteFacts(event).prices, event.availabilityLabel ?? ''];
  let min: number | undefined;
  for (const line of lines) {
    for (const match of line.matchAll(AMOUNT)) {
      const value = Number((match[1] ?? match[2]).replace(',', '.'));
      if (Number.isFinite(value) && (min === undefined || value < min)) min = value;
    }
  }
  return { free: false, min };
}

/* ------------------------------- Fingerabdruck ------------------------------ */

/** FNV-1a mit zwei Multiplikatoren – genug, um geänderte Texte zu erkennen. */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
