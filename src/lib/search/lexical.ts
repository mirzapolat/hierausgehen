import { FIELDS, type Field, type SearchDoc } from './document.ts';
import { boundedLevenshtein, stem, terms, words } from './normalize.ts';

/**
 * Wortsuche: BM25F über gewichtete Felder.
 *
 * BM25F statt einer Summe von BM25 je Feld: erst werden die Vorkommen eines
 * Begriffs über alle Felder gewichtet zusammengezählt (jedes Feld mit seiner
 * eigenen Längennormierung), dann wird einmal gesättigt. Ein Wort, das in
 * Titel *und* Beschreibung steht, zählt so mehr als eins nur im Titel – aber
 * nicht doppelt so viel, wie es eine Summe zweier BM25-Werte täte.
 */

/** Wie viel ein Vorkommen im Feld zählt. Namen wiegen so viel wie der Titel. */
export const FIELD_WEIGHTS: Record<Field, number> = {
  title: 3,
  people: 3,
  subtitle: 2,
  venue: 1.5,
  labels: 1.5,
  description: 1,
  notes: 0.3,
};

/** Längennormierung je Feld: lange Programmtexte sollen nicht allein durch Länge gewinnen. */
const LENGTH_NORM: Record<Field, number> = {
  title: 0.3,
  people: 0.3,
  subtitle: 0.5,
  venue: 0.3,
  labels: 0.3,
  description: 0.75,
  notes: 0.5,
};

const K1 = 1.2;

/** Abschläge für ungenaue Treffer. */
export const MATCH_WEIGHT = {
  exact: 1,
  synonym: 0.7,
  prefix: 0.8,
  compound: 0.7,
  typo1: 0.6,
  typo2: 0.4,
} as const;

export interface LexicalIndex {
  docCount: number;
  /** Begriff → Dokument → Vorkommen je Feld (Reihenfolge wie `FIELDS`). */
  postings: Map<string, Map<number, Float32Array>>;
  lengths: Float32Array[];
  averages: Float32Array;
  vocabulary: string[];
  /** Begriffe aus Titel, Untertitel und Mitwirkenden, in Reihenfolge – für die Nähe. */
  head: string[][];
  /** Gefalteter Titel, Wörter mit Leerzeichen – für den Volltreffer. */
  titles: string[];
}

export function buildLexical(docs: SearchDoc[]): LexicalIndex {
  const postings = new Map<string, Map<number, Float32Array>>();
  const lengths: Float32Array[] = [];
  const totals = new Float32Array(FIELDS.length);

  docs.forEach((doc, docIndex) => {
    const docLengths = new Float32Array(FIELDS.length);
    FIELDS.forEach((field, fieldIndex) => {
      const fieldTerms = terms(doc.fields[field]);
      docLengths[fieldIndex] = fieldTerms.length;
      totals[fieldIndex] += fieldTerms.length;
      for (const term of fieldTerms) {
        let byDoc = postings.get(term);
        if (!byDoc) postings.set(term, (byDoc = new Map()));
        let counts = byDoc.get(docIndex);
        if (!counts) byDoc.set(docIndex, (counts = new Float32Array(FIELDS.length)));
        counts[fieldIndex]++;
      }
    });
    lengths.push(docLengths);
  });

  const averages = totals.map((total) => (docs.length ? total / docs.length : 0) || 1);

  return {
    docCount: docs.length,
    postings,
    lengths,
    averages,
    vocabulary: [...postings.keys()],
    head: docs.map((doc) => terms([doc.fields.title, doc.fields.subtitle, doc.fields.people].join(' '))),
    titles: docs.map((doc) => words(doc.fields.title).join(' ')),
  };
}

export function idf(index: LexicalIndex, term: string): number {
  const df = index.postings.get(term)?.size ?? 0;
  return Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5));
}

/* ------------------------------ Erweiterung ------------------------------ */

/**
 * Gleichbedeutende Wörter, auch über die Sprache hinweg. Klein gehalten: nur
 * was im Programm wirklich vorkommt und anders heissen kann. Arten selbst
 * erkennt der Parser; hier stehen Gattungen, Instrumente, Anlässe, Stimmungen.
 */
const SYNONYM_GROUPS: string[][] = [
  ['theater', 'theatre', 'schauspiel', 'play'],
  ['oper', 'opera', 'opern'],
  ['konzert', 'concert', 'gig', 'konzerte', 'concerts', 'gigs'],
  ['musik', 'music'],
  ['tanz', 'dance', 'dancing', 'tanzen'],
  ['ballett', 'ballet'],
  ['kino', 'cinema', 'film', 'movie', 'movies', 'filme'],
  ['lesung', 'reading', 'readings'],
  ['literatur', 'literature', 'buch', 'book'],
  ['vortrag', 'talk', 'lecture'],
  ['ausstellung', 'exhibition'],
  ['fuehrung', 'tour', 'rundgang'],
  ['kinder', 'kids', 'children', 'kind', 'child'],
  ['familie', 'family', 'familien', 'families'],
  ['klassik', 'klassisch', 'classical', 'klassische'],
  ['orchester', 'orchestra', 'sinfonie', 'symphonie', 'symphony', 'sinfonieorchester'],
  ['chor', 'choir', 'choral'],
  ['klavier', 'piano', 'pianist', 'pianistin'],
  ['orgel', 'organ'],
  ['geige', 'violine', 'violin'],
  ['cello', 'violoncello'],
  ['gitarre', 'guitar'],
  ['weihnacht', 'weihnachten', 'christmas', 'xmas', 'advent', 'weihnachtlich'],
  ['kirche', 'church'],
  ['lustig', 'witzig', 'funny', 'komisch', 'humor', 'humour', 'komoedie', 'comedy'],
  ['romantisch', 'romantic', 'romantik', 'romance'],
  ['liebe', 'love', 'liebesgeschichte'],
  ['party', 'feiern', 'clubbing', 'club'],
  ['improvisation', 'impro', 'improv', 'improtheater'],
  ['englisch', 'english'],
  ['deutsch', 'german'],
  ['krimi', 'thriller', 'crime'],
  ['maerchen', 'fairytale', 'fairy'],
  ['zauber', 'magie', 'magic', 'zauberer', 'magician'],
  ['zirkus', 'circus', 'akrobatik', 'acrobatics'],
  ['puppentheater', 'puppet', 'puppets', 'puppen', 'marionetten'],
  ['electronic', 'elektronisch', 'techno', 'house'],
  ['singer', 'songwriter', 'liedermacher'],
  ['volksmusik', 'folk'],
];

const SYNONYMS = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const stems = group.map(stem);
  for (const word of [...group, ...stems]) {
    const set = SYNONYMS.get(word) ?? new Set<string>();
    for (const other of stems) set.add(other);
    SYNONYMS.set(word, set);
  }
}

export interface Expansion {
  term: string;
  weight: number;
  kind: keyof typeof MATCH_WEIGHT;
}

/**
 * Welche Begriffe des Index ein Wort der Anfrage trifft – genau, als Synonym,
 * als Anfang eines längeren Worts („jazz" → „jazzkonzert"), als Ende eines
 * zusammengesetzten Worts („theater" → „kindertheater") oder mit Tippfehler.
 *
 * Tippfehler erst ab fünf Buchstaben und zwei Fehler erst ab acht: sonst
 * wird aus „oper" ein „opa".
 */
export function expand(index: LexicalIndex, word: string): Expansion[] {
  const base = stem(word);
  const found = new Map<string, Expansion>();
  const add = (term: string, kind: Expansion['kind']) => {
    if (!index.postings.has(term)) return;
    const weight = MATCH_WEIGHT[kind];
    const existing = found.get(term);
    if (!existing || existing.weight < weight) found.set(term, { term, weight, kind });
  };

  add(base, 'exact');
  if (word !== base) add(word, 'exact');
  for (const synonym of SYNONYMS.get(word) ?? SYNONYMS.get(base) ?? []) {
    if (synonym !== base) add(synonym, 'synonym');
  }

  const maxTypos = word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0;
  for (const term of index.vocabulary) {
    if (term === base || found.get(term)?.weight === 1) continue;
    // Präfix am ungestemmten Wort: „ratle" ist kein Anfang von „ratlos",
    // auch wenn sein Stamm „ratl" es wäre.
    if (word.length >= 4 && term.startsWith(word)) add(term, 'prefix');
    else if (base.length >= 5 && term.length > base.length + 2 && term.endsWith(base)) add(term, 'compound');
    else if (maxTypos > 0 && term.length >= 4 && Math.abs(term.length - base.length) <= maxTypos) {
      const distance = boundedLevenshtein(base, term, maxTypos);
      if (distance === 1) add(term, 'typo1');
      else if (distance === 2 && maxTypos >= 2) add(term, 'typo2');
    }
  }

  return [...found.values()]
    .sort(
      (a, b) =>
        b.weight - a.weight || index.postings.get(b.term)!.size - index.postings.get(a.term)!.size,
    )
    .slice(0, 40);
}

/* -------------------------------- Bewertung -------------------------------- */

export interface QueryTerm {
  word: string;
  expansions: Expansion[];
  /** Wie viel das Wort zählt: Seltenheit seines stärksten Treffers. */
  importance: number;
}

export interface LexicalMatch {
  /** Roher BM25F-Wert samt Nähe- und Titelbonus. */
  raw: number;
  /** Anteil der Wörter (nach Wichtigkeit), die überhaupt getroffen wurden. */
  presence: number;
  /** Wie `presence`, aber mit dem Abschlag ungenauer Treffer. */
  coverage: number;
}

export interface LexicalResult {
  matches: Map<number, LexicalMatch>;
  /** Wörter mit Treffern im Bestand. */
  known: QueryTerm[];
  /** Wörter, die nirgends vorkommen. */
  unknown: string[];
  /** Beste `presence` über alle Dokumente. */
  bestPresence: number;
}

/**
 * Mindestanteil getroffener Wörter: bei ein, zwei Wörtern alle, darüber
 * sechzig Prozent. Ohne diese Schwelle gewänne bei „Simon Rattle" jeder
 * Simon.
 */
function requiredPresence(known: number): number {
  return known <= 2 ? 0.999 : 0.6;
}

/**
 * `optional`: Wörter, die zählen, wenn sie stehen, aber keine Pflicht sind
 * (Stimmungen). Die Schwelle gilt nur für die übrigen; besteht die Anfrage
 * nur aus solchen, genügt eins davon.
 */
export function scoreLexical(
  index: LexicalIndex,
  queryWords: string[],
  optional: ReadonlySet<string> = new Set(),
): LexicalResult {
  const known: QueryTerm[] = [];
  const unknown: string[] = [];
  for (const word of queryWords) {
    const expansions = expand(index, word);
    if (expansions.length === 0) unknown.push(word);
    else known.push({ word, expansions, importance: idf(index, expansions[0].term) });
  }

  const matches = new Map<number, LexicalMatch>();
  if (known.length === 0) return { matches, known, unknown, bestPresence: 0 };

  const totalImportance = known.reduce((sum, term) => sum + term.importance, 0) || 1;
  /** Je Dokument: bester Wert und bestes Gewicht je Wort. */
  const perDoc = new Map<number, { scores: Float32Array; weights: Float32Array }>();

  known.forEach((queryTerm, termIndex) => {
    for (const expansion of queryTerm.expansions) {
      const termIdf = idf(index, expansion.term);
      for (const [docIndex, counts] of index.postings.get(expansion.term)!) {
        const tf = weightedFrequency(index, docIndex, counts);
        const score = expansion.weight * termIdf * (tf / (K1 + tf));
        let entry = perDoc.get(docIndex);
        if (!entry) {
          entry = { scores: new Float32Array(known.length), weights: new Float32Array(known.length) };
          perDoc.set(docIndex, entry);
        }
        if (score > entry.scores[termIndex]) entry.scores[termIndex] = score;
        if (expansion.weight > entry.weights[termIndex]) entry.weights[termIndex] = expansion.weight;
      }
    }
  });

  const mandatory = known.filter((term) => !optional.has(term.word));
  const mandatoryImportance = mandatory.reduce((sum, term) => sum + term.importance, 0);
  const required = mandatory.length ? requiredPresence(mandatory.length) : Number.MIN_VALUE;
  const phrase = known.map((term) => term.word).join(' ');
  let bestPresence = 0;

  for (const [docIndex, { scores, weights }] of perDoc) {
    let presence = 0;
    let mandatoryPresence = 0;
    let coverage = 0;
    let raw = 0;
    known.forEach((term, termIndex) => {
      if (weights[termIndex] > 0) {
        presence += term.importance;
        if (!optional.has(term.word)) mandatoryPresence += term.importance;
      }
      coverage += term.importance * weights[termIndex];
      raw += scores[termIndex];
    });
    presence /= totalImportance;
    coverage /= totalImportance;
    if (presence > bestPresence) bestPresence = presence;
    const gate = mandatory.length ? mandatoryPresence / (mandatoryImportance || 1) : presence;
    if (gate < required) continue;

    raw *= proximityBonus(index.head[docIndex], known);
    const title = index.titles[docIndex];
    if (phrase.length >= 3 && title === phrase) raw *= 1.25;
    else if (phrase.length >= 3 && title.startsWith(phrase)) raw *= 1.1;

    matches.set(docIndex, { raw, presence, coverage });
  }

  return { matches, known, unknown, bestPresence };
}

function weightedFrequency(index: LexicalIndex, docIndex: number, counts: Float32Array): number {
  const lengths = index.lengths[docIndex];
  let tf = 0;
  FIELDS.forEach((field, fieldIndex) => {
    const count = counts[fieldIndex];
    if (!count) return;
    const b = LENGTH_NORM[field];
    const norm = 1 - b + b * (lengths[fieldIndex] / index.averages[fieldIndex]);
    tf += (FIELD_WEIGHTS[field] * count) / norm;
  });
  return tf;
}

/**
 * Stehen aufeinanderfolgende Wörter der Anfrage auch im Kopf des Termins
 * beieinander („Simon Rattle"), ist das fast immer der gemeinte Name: bis zu
 * 30 % Bonus, halb so viel, wenn nur ein, zwei Wörter dazwischen stehen.
 */
function proximityBonus(head: string[], known: QueryTerm[]): number {
  if (known.length < 2 || head.length < 2) return 1;
  const positions = known.map((term) => {
    const wanted = new Set(term.expansions.map((expansion) => expansion.term));
    const found: number[] = [];
    head.forEach((token, position) => {
      if (wanted.has(token)) found.push(position);
    });
    return found;
  });

  let bonus = 0;
  for (let i = 0; i + 1 < positions.length; i++) {
    let best = Infinity;
    for (const a of positions[i]) for (const b of positions[i + 1]) if (b > a) best = Math.min(best, b - a);
    if (best === 1) bonus += 0.3;
    else if (best <= 3) bonus += 0.15;
  }
  return 1 + bonus / (positions.length - 1);
}
