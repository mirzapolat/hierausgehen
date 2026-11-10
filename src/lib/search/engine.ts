import type { CalendarEvent, SourceDefinition } from '../events/types.ts';
import { addDays, weekday } from '../calendar.ts';
import { TIME_OF_DAY_START } from '../events/filter.ts';
import { todayInZone } from '../events/schedule.ts';
import { buildDocs, priceOf, type PriceFacts, type SearchDoc } from './document.ts';
import { buildLexical, scoreLexical, type LexicalIndex, type LexicalResult } from './lexical.ts';
import { STOPWORDS, words } from './normalize.ts';
import type { ParsedQuery } from './parse.ts';
import {
  EXCLUDE,
  availabilityPrior,
  calibrate,
  categoryFit,
  completenessPrior,
  eveningFit,
  hintFit,
  priceFit,
  rarityPrior,
  semanticAlpha,
  textLambda,
  ticketsFit,
  timeFit,
  timePrior,
} from './rank.ts';

/**
 * Die Suche einer Stadt: Index aufbauen, Anfrage bewerten.
 *
 * Rein bis auf die Uhr, die hereinkommt – Embeddings eingeschlossen: die
 * Ähnlichkeiten berechnet der Aufrufer (`service.ts`) und reicht sie als
 * Zahlenreihe durch. So läuft die Rangfolge in den Tests ohne Modell.
 */

export interface SearchIndex {
  cityId: string;
  timeZone: string;
  docs: SearchDoc[];
  lexical: LexicalIndex;
  /** Ändert sich mit dem Datenstand – daran erkennt der Dienst einen neuen Index. */
  fingerprint: string;
  prices: Map<string, PriceFacts>;
}

export function buildSearchIndex(
  events: CalendarEvent[],
  definitions: SourceDefinition[],
  options: { cityId: string; timeZone: string; fingerprint?: string },
): SearchIndex {
  const docs = buildDocs(events, definitions);
  return {
    cityId: options.cityId,
    timeZone: options.timeZone,
    docs,
    lexical: buildLexical(docs),
    fingerprint: options.fingerprint ?? '',
    prices: new Map(),
  };
}

/** Was sich einzeln abschalten lässt – über einen Chip oder beim Lockern. */
export const FACETS = ['time', 'price', 'tickets', 'kids', 'date', 'category', 'text'] as const;
export type Facet = (typeof FACETS)[number];

export interface SearchOptions {
  now: Date;
  limit?: number;
  /** Kosinus je Dokument (NaN = noch kein Vektor). Fehlt sie, sucht nur die Wortsuche. */
  similarity?: Float32Array;
  /** Angaben, die die Anfrage zwar enthält, die aber nicht gelten sollen. */
  ignore?: Facet[];
  debug?: boolean;
}

export interface Breakdown {
  text: number;
  lexical: number;
  semantic: number;
  coverage: number;
  lambda: number;
  alpha: number;
  fit: number;
  prior: number;
}

/**
 * Ein Treffer ist ein Termin – jeder passende Tag steht für sich, auch bei
 * einer Reihe. Text und Art bewertet die Suche je Produktion (sie sind über
 * alle Vorstellungen gleich), Zeitraum, Preis, Karten und „bald" je Termin.
 */
export interface SearchHit {
  /** Kennung des Termins. */
  key: string;
  event: CalendarEvent;
  score: number;
  /** 0 = genau die gesuchte Art (oder keine gesucht), 1 = eine verwandte. */
  tier: number;
  /** Passende kommende Termine derselben Reihe, dieser eingeschlossen. */
  matching: number;
  breakdown?: Breakdown;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  /** Angaben, die gelockert wurden, weil es mit ihnen nichts gab. */
  relaxed: Facet[];
  mode: 'text' | 'browse';
  lambda: number;
  alpha: number;
  semantic: boolean;
}

/** Reihenfolge des Lockerns: das Nebensächliche zuerst, Gesuchtes zuletzt. */
const RELAX_ORDER: Facet[] = ['time', 'price', 'tickets', 'kids', 'date', 'category', 'text'];

export function search(index: SearchIndex, parsed: ParsedQuery, options: SearchOptions): SearchResult {
  const active = new Set<Facet>(presentFacets(parsed).filter((facet) => !options.ignore?.includes(facet)));
  const relaxed: Facet[] = [];

  let attempt = run(index, parsed, active, options);
  // Nichts gefunden: Angabe für Angabe lockern, bis etwas da ist. Ein
  // Suchwort, das es nirgends gibt, fällt zuerst – sonst verlöre „xyzzy
  // Konzerte heute" erst den Tag und die Art.
  const order: Facet[] = attempt.textUnknown
    ? ['text', ...RELAX_ORDER.filter((facet) => facet !== 'text')]
    : RELAX_ORDER;
  for (const facet of order) {
    if (attempt.result.hits.length > 0) break;
    if (!active.has(facet)) continue;
    active.delete(facet);
    relaxed.push(facet);
    attempt = run(index, parsed, active, options);
  }

  return { ...attempt.result, relaxed };
}

export function presentFacets(parsed: ParsedQuery): Facet[] {
  const facets: Facet[] = [];
  if (parsed.times) facets.push('time');
  if (parsed.price) facets.push('price');
  if (parsed.tickets) facets.push('tickets');
  if (parsed.kids && parsed.kids.spans.length > 0) facets.push('kids');
  if (parsed.date) facets.push('date');
  if (parsed.categories) facets.push('category');
  if (parsed.words.length > 0) facets.push('text');
  return facets;
}

/* --------------------------------- Lauf --------------------------------- */

interface Candidate {
  lexical: number;
  semantic: number;
  coverage: number;
}

function run(
  index: SearchIndex,
  parsed: ParsedQuery,
  active: Set<Facet>,
  options: SearchOptions,
): { result: Omit<SearchResult, 'relaxed'>; textUnknown: boolean } {
  // Nur Stimmungswörter („was Lustiges") sind kein Suchtext, den ein Termin
  // enthalten muss: dann wird gestöbert, und Bedeutung und Art ordnen.
  const moods = new Set(parsed.moods);
  const textMode = active.has('text') && parsed.words.some((word) => !moods.has(word));
  const z = options.similarity ? zScores(options.similarity) : undefined;
  const useSemantic = !!z && (textMode || !!parsed.vague);

  let lexical: LexicalResult | undefined;
  let lambda = 0;
  let alpha = 0;
  const candidates = new Map<number, Candidate>();

  if (textMode) {
    lexical = scoreLexical(index.lexical, parsed.words, new Set(parsed.moods));
    const raws = [...lexical.matches.values()].map((match) => match.raw);
    const k = Math.max(median(raws), 1e-6);
    for (const [docIndex, match] of lexical.matches) {
      candidates.set(docIndex, {
        lexical: (match.raw / (match.raw + k)) * match.coverage ** 2,
        semantic: 0,
        coverage: match.coverage,
      });
    }

    const knownMass = lexical.known.reduce((sum, term) => sum + term.importance, 0);
    const unknownMass = lexical.unknown.length * 2.5;
    lambda = textLambda(knownMass + (useSemantic ? unknownMass : 0));

    if (useSemantic) {
      // Wie sicher ist die Wortsuche? Alle Wörter getroffen, genau statt über
      // Synonym oder Tippfehler, seltene Wörter – und keine Stimmung, die der
      // Parser erkannt hat: „romantisch" trifft das Wort, nicht den Abend.
      const strength = knownMass / (knownMass + unknownMass || 1);
      const rarity = lexical.known.length ? Math.min(1, knownMass / lexical.known.length / 3.5) : 0;
      // Ob ein Wort gefunden wurde, zählt – nicht wie genau: „ratle" ist mit
      // einem Tippfehler sicher Rattle, kein Fall für die Bedeutung.
      const confidence = strength * lexical.bestPresence * rarity * (parsed.vague ? 0.5 : 1);
      alpha = semanticAlpha(confidence);
      // Bedeutung bringt eigene Kandidaten mit – aber nur deutliche, und nur,
      // wenn die Wortsuche unsicher ist: bei „Simon Rattle" hat sie nichts
      // beizutragen ausser Rauschen. Die Ähnlichkeit liefert immer
      // irgendetwas, auch auf Unsinn.
      // Ist die Anfrage klar vage (α ≥ 0,5), kommt jede Produktion in Frage:
      // „was Lustiges am Freitag" soll unter allen Freitagsterminen wählen,
      // nicht unter den 150 lustigsten des Jahres, von denen keiner freitags ist.
      const open = alpha >= 0.5;
      // Eigene Kandidaten bringt sie nur, wenn die Wortsuche wenig findet;
      // sonst ordnet sie nur, was die Wörter schon gefunden haben.
      const semanticOnly =
        alpha >= 0.3 && lexical.matches.size < 25
          ? [...z!.entries()]
              .filter(([docIndex, value]) => value >= (open ? 0.5 : 1.75) && !candidates.has(docIndex))
              .sort((a, b) => b[1] - a[1])
              .slice(0, open ? Infinity : 150)
          : [];
      for (const [docIndex] of semanticOnly) candidates.set(docIndex, { lexical: 0, semantic: 0, coverage: 0 });
      // Ausdrücklich genannte Art („moderne Kunst Ausstellung"): jede
      // Produktion dieser Art kommt in Frage, auch ohne die Wörter – die
      // Bedeutung ordnet sie. Sonst gewinnt das Konzert, in dessen Text
      // zufällig „Kunst" steht, gegen jede Ausstellung. Nur wenn die
      // Wortsuche unsicher ist – „Theater mit Simon Rattle" sucht Rattle.
      if (alpha >= 0.3 && active.has('category') && parsed.categories) {
        index.docs.forEach((doc, docIndex) => {
          if (candidates.has(docIndex)) return;
          if (categoryFit(parsed.categories!.values, doc.representative.category, true) === 1) {
            candidates.set(docIndex, { lexical: 0, semantic: 0, coverage: 0 });
          }
        });
      }
      for (const [docIndex, candidate] of candidates) {
        candidate.semantic = Number.isFinite(z![docIndex]) ? calibrate(z![docIndex]) : 0;
      }
    }
  } else {
    index.docs.forEach((_, docIndex) =>
      candidates.set(docIndex, {
        lexical: 1,
        semantic: useSemantic && Number.isFinite(z![docIndex]) ? calibrate(z![docIndex]) : 0,
        coverage: 1,
      }),
    );
  }

  const textUnknown = textMode && !useSemantic && (lexical?.known.length ?? 0) === 0;
  if (candidates.size === 0) {
    return { result: emptyResult(textMode, lambda, alpha, useSemantic), textUnknown };
  }

  const clock = localClock(index.timeZone);
  const today = todayInZone(index.timeZone, options.now);
  const nowMs = options.now.getTime();
  const strict = !textMode;

  const hits: SearchHit[] = [];
  for (const [docIndex, candidate] of candidates) {
    const doc = index.docs[docIndex];
    let text: number;
    if (textMode) {
      text = (1 - alpha) * candidate.lexical + alpha * candidate.semantic;
      if (text <= 0) continue;
    } else {
      // Ohne Suchwörter ordnet die Bedeutung nur nach, wenn die Anfrage eine
      // Lage beschreibt („wenn es regnet"); sie schliesst nichts aus.
      text = useSemantic ? 0.6 + 0.4 * candidate.semantic : 1;
    }
    const textFactor = textMode ? text ** lambda : text;

    const upcoming = doc.events.filter((event) => isUpcoming(event, clock, today, nowMs) && !isCancelled(event));
    if (upcoming.length === 0) continue;

    const matches: { event: CalendarEvent; score: number; fit: number; prior: number }[] = [];
    for (const event of upcoming) {
      const fit = fitOf(index, event, doc, parsed, active, strict, clock);
      if (fit === EXCLUDE) continue;
      const prior = priorOf(event, doc, parsed, active, upcoming.length, lambda, textMode, clock, today);
      matches.push({ event, score: textFactor * fit * prior, fit, prior });
    }

    for (const match of matches) {
      // Beim Stöbern nach einer Art kommt erst die Art selbst, dann ihre
      // Verwandten – egal, wie gut ein verwandter Termin sonst dasteht.
      const tier =
        strict && active.has('category') && parsed.categories
          ? categoryFit(parsed.categories.values, match.event.category, true) === 1
            ? 0
            : 1
          : 0;

      hits.push({
        key: match.event.id,
        event: match.event,
        score: match.score,
        tier,
        matching: matches.length,
        ...(options.debug
          ? {
              breakdown: {
                text,
                lexical: candidate.lexical,
                semantic: candidate.semantic,
                coverage: candidate.coverage,
                lambda,
                alpha,
                fit: match.fit,
                prior: match.prior,
              },
            }
          : {}),
      });
    }
  }

  hits.sort((a, b) => a.tier - b.tier || b.score - a.score || a.event.start.localeCompare(b.event.start));
  const unique = collapseDuplicates(hits);
  const ordered =
    lambda < 0.6
      ? [...diversify(unique.filter((hit) => hit.tier === 0)), ...diversify(unique.filter((hit) => hit.tier === 1))]
      : unique;
  const limit = options.limit ?? 50;

  return {
    result: {
      hits: ordered.slice(0, limit),
      total: ordered.length,
      mode: textMode ? 'text' : 'browse',
      lambda,
      alpha,
      semantic: useSemantic,
    },
    textUnknown,
  };
}

function emptyResult(
  textMode: boolean,
  lambda: number,
  alpha: number,
  semantic: boolean,
): Omit<SearchResult, 'relaxed'> {
  return { hits: [], total: 0, mode: textMode ? 'text' : 'browse', lambda, alpha, semantic };
}

/* --------------------------------- Fit --------------------------------- */

function fitOf(
  index: SearchIndex,
  event: CalendarEvent,
  doc: SearchDoc,
  parsed: ParsedQuery,
  active: Set<Facet>,
  strict: boolean,
  clock: Clock,
): number {
  let fit = 1;
  const start = clock(event.start);
  const minutes = event.allDay ? undefined : start.minutes;

  if (active.has('date') && parsed.date) {
    const { from, to } = parsed.date;
    // „Freitagnacht" schliesst die Party ein, die Samstag um halb eins beginnt.
    const lateNight =
      minutes !== undefined && minutes < TIME_OF_DAY_START.day * 60 && !!parsed.times?.values.includes('night');
    const day = lateNight ? addDays(start.day, -1) : start.day;
    if (day < from) {
      // Läuft schon (Ausstellung, Festival) – passt, ist aber nicht neu. Nur
      // was wirklich über Tage geht: die Party vom Vorabend zählt nicht.
      if (!isMultiDay(event) || (event.end ? clock(event.end).day : start.day) < from) return EXCLUDE;
      fit *= 0.9;
    } else if (day > to) {
      return EXCLUDE;
    } else if (parsed.date.fridayEvening && day === from && weekday(from) === 5) {
      if (minutes !== undefined && minutes < 17 * 60 && !lateNight) return EXCLUDE;
      fit *= 0.8;
    }
  }

  if (active.has('time') && parsed.times) fit *= timeFit(parsed.times.values, minutes);

  if (active.has('category') && parsed.categories) {
    const value = categoryFit(parsed.categories.values, event.category, strict);
    if (value === EXCLUDE) return EXCLUDE;
    fit *= value;
  }
  fit *= hintFit(parsed.hints, event.category, strict);

  // „Für Kinder" ohne weitere Suchwörter verlangt Kinderprogramm; mit
  // Suchwörtern rückt es nur nach vorn.
  if (active.has('kids') && parsed.kids?.spans.length && !doc.kidFriendly) {
    if (strict) return EXCLUDE;
    fit *= 0.35;
  }

  if (active.has('price') && parsed.price) {
    let price = index.prices.get(event.id);
    if (!price) index.prices.set(event.id, (price = priceOf(event)));
    const value = priceFit(parsed.price, price);
    if (value === EXCLUDE) return EXCLUDE;
    fit *= value;
  }

  if (active.has('tickets') && parsed.tickets) {
    const value = ticketsFit(event.availability);
    if (value === EXCLUDE) return EXCLUDE;
    fit *= value;
  }

  if (parsed.evening) fit *= eveningFit(minutes);
  if (parsed.language) fit *= isEnglish(doc) ? 1 : 0.45;
  return fit;
}

const ENGLISH = /\b(?:english|englisch|englischsprachig\w*|in english|auf englisch|english[- ]language|english[- ]speaking)\b/i;
const englishCache = new WeakMap<SearchDoc, boolean>();

/** Steht irgendwo im Text, dass der Abend englisch ist? */
function isEnglish(doc: SearchDoc): boolean {
  let value = englishCache.get(doc);
  if (value === undefined) {
    value = ENGLISH.test(Object.values(doc.fields).join(' '));
    englishCache.set(doc, value);
  }
  return value;
}

/* -------------------------------- Prior -------------------------------- */

function priorOf(
  event: CalendarEvent,
  doc: SearchDoc,
  parsed: ParsedQuery,
  active: Set<Facet>,
  upcomingCount: number,
  lambda: number,
  textMode: boolean,
  clock: Clock,
  today: string,
): number {
  let prior =
    availabilityPrior(event.availability) * completenessPrior(doc.representative.description?.length ?? 0);
  if (!(active.has('date') && parsed.date)) prior *= timePrior(daysBetween(today, clock(event.start).day));
  if (!textMode || lambda < 0.3) prior *= rarityPrior(upcomingCount);
  return prior;
}

/* ------------------------------- Dubletten ------------------------------- */

/**
 * Derselbe Abend bei zwei Quellen – das Haus und ein Veranstalter, der ihn
 * ebenfalls führt („Wiener Philharmoniker: Mahler" und „Wiener
 * Philharmoniker"). Die Normalisierung erkennt nur gleiche Titel; hier
 * reicht dieselbe Minute bei einer anderen Quelle und ein Titel, dessen
 * Wörter grossteils im anderen stehen. Es bleibt der besser bewertete.
 */
function collapseDuplicates(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<number, { sourceId: string; words: Set<string> }[]>();
  const kept: SearchHit[] = [];
  for (const hit of hits) {
    const minute = Math.floor(Date.parse(hit.event.start) / 60_000);
    const titleWords = new Set(words(hit.event.title).filter((word) => word.length > 2 && !STOPWORDS.has(word)));
    const others = seen.get(minute) ?? [];
    const duplicate = others.some(
      (other) => other.sourceId !== hit.event.sourceId && overlap(other.words, titleWords) >= 0.6,
    );
    if (duplicate) continue;
    others.push({ sourceId: hit.event.sourceId, words: titleWords });
    seen.set(minute, others);
    kept.push(hit);
  }
  return kept;
}

function overlap(a: Set<string>, b: Set<string>): number {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / smaller;
}

/* ------------------------------- Vielfalt ------------------------------- */

/**
 * Beim Stöbern soll die erste Seite nicht aus einem einzigen Haus bestehen.
 * Jeder weitere Treffer derselben Quelle kostet 8 % – genug, um Blöcke
 * aufzubrechen, zu wenig, um einen klar besseren Treffer zu verdrängen.
 */
function diversify(hits: SearchHit[]): SearchHit[] {
  const head = hits.slice(0, 60);
  const rest = hits.slice(60);
  const placed: SearchHit[] = [];
  const perSource = new Map<string, number>();
  while (head.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    head.forEach((hit, i) => {
      const value = hit.score * 0.92 ** (perSource.get(hit.event.sourceId) ?? 0);
      if (value > bestValue + 1e-12) {
        bestValue = value;
        bestIndex = i;
      }
    });
    const [hit] = head.splice(bestIndex, 1);
    perSource.set(hit.event.sourceId, (perSource.get(hit.event.sourceId) ?? 0) + 1);
    placed.push(hit);
  }
  return [...placed, ...rest];
}

/* -------------------------------- Helfer -------------------------------- */

type Clock = (iso: string) => { day: string; minutes: number };

/** Tag und Uhrzeit in der Zeitzone der Stadt, zwischengespeichert. */
export function localClock(timeZone: string): Clock {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const cache = new Map<string, { day: string; minutes: number }>();
  return (iso) => {
    let value = cache.get(iso);
    if (value) return value;
    const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    value = {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
    cache.set(iso, value);
    return value;
  };
}

/**
 * Noch hingehbar: ganztägig ab heute, sonst höchstens eine halbe Stunde
 * begonnen. Das Konzert, das seit zwei Stunden läuft, ist kein Vorschlag
 * mehr – die Ausstellung bis März schon.
 */
function isUpcoming(event: CalendarEvent, clock: Clock, today: string, nowMs: number): boolean {
  if (event.allDay) return clock(event.end ?? event.start).day >= today;
  if (Date.parse(event.start) >= nowMs - 30 * 60_000) return true;
  return isMultiDay(event) && Date.parse(event.end!) >= nowMs;
}

/**
 * Abgesagt – die Quelle lässt den Termin stehen und schreibt es in den Titel
 * („Cancelled – Live at Lost", „ABGESAGT: …"). Kein Vorschlag mehr.
 */
const CANCELLED = /\b(?:cancell?ed|abgesagt|entf(?:ä|ae)llt|f(?:ä|ae)llt aus|postponed|verschoben)\b/i;

function isCancelled(event: CalendarEvent): boolean {
  return CANCELLED.test(event.title) || CANCELLED.test(event.availabilityLabel ?? '');
}

function isMultiDay(event: CalendarEvent): boolean {
  if (event.allDay) return true;
  return !!event.end && Date.parse(event.end) - Date.parse(event.start) >= 20 * 3_600_000;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function zScores(similarity: Float32Array): Float32Array {
  let count = 0;
  let sum = 0;
  for (const value of similarity) {
    if (!Number.isFinite(value)) continue;
    count++;
    sum += value;
  }
  const out = new Float32Array(similarity.length).fill(Number.NaN);
  if (count < 2) return out;
  const mean = sum / count;
  let squares = 0;
  for (const value of similarity) if (Number.isFinite(value)) squares += (value - mean) ** 2;
  const deviation = Math.sqrt(squares / count) || 1e-6;
  similarity.forEach((value, i) => {
    if (Number.isFinite(value)) out[i] = (value - mean) / deviation;
  });
  return out;
}
