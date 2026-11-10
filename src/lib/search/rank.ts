import type { Availability } from '../events/types.ts';
import { TIME_OF_DAY_START, type TimeOfDay } from '../events/filter.ts';
import type { PriceFacts } from './document.ts';

/**
 * Die Faktoren der Rangfolge – jeder für sich, rein und einzeln prüfbar.
 *
 *     score = text^λ × fit × prior
 *
 * `fit` fragt, ob ein Termin zu dem passt, was ausdrücklich verlangt wurde
 * (Zeitraum, Tageszeit, Art, Preis, Karten). Jeder Faktor liegt zwischen 0,3
 * und 1, oder er schliesst aus (`EXCLUDE`). `prior` ordnet nur, was ohnehin
 * nah beieinanderliegt, und bleibt deshalb zwischen etwa 0,6 und 1.
 *
 * Fehlt eine Angabe, ist das weder Treffer noch Ausschluss: der Termin bleibt
 * sichtbar, rückt aber hinter die, bei denen die Quelle es bestätigt.
 */

export const EXCLUDE = 0;

/* ------------------------------ Verwandte Arten ------------------------------ */

/**
 * Arten, die einander nahe sind. Wer „Theater mit Simon Rattle" sucht, findet
 * so seine Konzerte, und wer „Theater" sucht, auch das Kindertheater – nur
 * eben nicht an erster Stelle. Enthält auch die Arten, die Quellen
 * mitbringen, ohne dass der Wortschatz sie kanonisch führt.
 */
const RELATED_GROUPS: string[][] = [
  ['Oper', 'Operette', 'Musical', 'Kinder-Jugend-Oper'],
  ['Ballett', 'Tanz', 'Tanz-Show'],
  ['Theater', 'Kindertheater', 'Performance', 'Show', 'Krippenspiel'],
  ['Show', 'Comedy', 'Late Night Show', 'Tanz-Show', 'Musical'],
  ['Konzert', 'Klassik', 'Klassenkonzerte', 'Prüfungskonzerte', 'Singen', 'Soiree', 'Festival'],
  ['Literatur', 'Vortrag', 'Talk-Abend', 'Netzwerk'],
  ['Party', 'Festival'],
  ['Kinder & Familie', 'Kindertheater', 'Kinder-Jugend-Oper', 'Krippenspiel'],
  ['Ausstellung', 'Führung', 'Kultur'],
  ['Kino', 'Kultur'],
];

const RELATED = new Map<string, Set<string>>();
for (const group of RELATED_GROUPS) {
  for (const category of group) {
    const set = RELATED.get(category) ?? new Set<string>();
    for (const other of group) if (other !== category) set.add(other);
    RELATED.set(category, set);
  }
}

export function relatedness(wanted: string, actual: string | undefined): 'same' | 'related' | 'other' {
  if (!actual) return 'other';
  if (wanted === actual) return 'same';
  // „Konzerte heute" meint auch die klassischen; „Klassik" nur diese.
  if (wanted === 'Konzert' && actual === 'Klassik') return 'same';
  return RELATED.get(wanted)?.has(actual) ? 'related' : 'other';
}

/**
 * Ausdrücklich genannte Arten. Ohne weitere Suchwörter („Konzerte heute")
 * sind sie verbindlich – dann bleiben nur die Art und ihre Verwandten. Mit
 * Suchwörtern sind sie eine Vorliebe: der Name entscheidet, die Art ordnet.
 */
export function categoryFit(wanted: string[], actual: string | undefined, strict: boolean): number {
  let best = strict ? EXCLUDE : 0.3;
  for (const category of wanted) {
    const relation = relatedness(category, actual);
    if (relation === 'same') return 1;
    if (relation === 'related') best = Math.max(best, 0.6);
  }
  return best;
}

/** Arten, auf die ein Suchwort nur deutet („Jazz"): sanfter als genannte. */
export function hintFit(hints: string[], actual: string | undefined): number {
  if (hints.length === 0) return 1;
  let best = 0.6;
  for (const category of hints) {
    const relation = relatedness(category, actual);
    if (relation === 'same') return 1;
    if (relation === 'related') best = Math.max(best, 0.85);
  }
  return best;
}

/* -------------------------------- Tageszeit -------------------------------- */

/** Minuten-Fenster der Tageszeiten nach `TIME_OF_DAY_START`; die Nacht geht über Mitternacht. */
function windows(): Record<TimeOfDay, [number, number]> {
  const { day, evening, night } = TIME_OF_DAY_START;
  return {
    day: [day * 60, evening * 60],
    evening: [evening * 60, night * 60],
    night: [night * 60, (day + 24) * 60],
  };
}

/**
 * Im Fenster 1, danach in einer Stunde abfallend bis 0,4. Ein Konzert um
 * 16:45 ist für „abends" fast richtig, eins um 11 Uhr nicht.
 */
export function timeFit(wanted: TimeOfDay[], minutes: number | undefined): number {
  if (minutes === undefined) return 0.7;
  const bounds = windows();
  let best = 0.4;
  for (const time of wanted) {
    const [start, end] = bounds[time];
    for (const value of [minutes, minutes + 24 * 60]) {
      const distance = value < start ? start - value : value >= end ? value - end + 1 : 0;
      best = Math.max(best, distance === 0 ? 1 : Math.max(0.4, 1 - (distance / 60) * 0.6));
    }
  }
  return best;
}

/** Für ein Date, zu zweit: der Abend passt, der Vormittag weniger. */
export function eveningFit(minutes: number | undefined): number {
  if (minutes === undefined) return 0.85;
  return minutes >= TIME_OF_DAY_START.evening * 60 || minutes < TIME_OF_DAY_START.day * 60 ? 1 : 0.8;
}

/* ---------------------------------- Preis ---------------------------------- */

export function priceFit(wanted: { free?: boolean; max?: number; cheap?: boolean }, price: PriceFacts): number {
  const known = price.free || price.min !== undefined;
  if (wanted.free) {
    if (price.free) return 1;
    // Unbekannt bleibt sichtbar, aber weit hinten; ein Preis schliesst aus.
    return known ? EXCLUDE : 0.4;
  }
  let fit = 1;
  if (wanted.max !== undefined) {
    if (!known) fit *= 0.5;
    else if (!price.free && price.min! > wanted.max) return EXCLUDE;
  }
  if (wanted.cheap) {
    if (!known) fit *= 0.8;
    else if (price.free || price.min! <= 15) fit *= 1;
    else if (price.min! <= 30) fit *= 0.85;
    else fit *= 0.6;
  }
  return fit;
}

/* ---------------------------------- Karten ---------------------------------- */

export function ticketsFit(availability: Availability): number {
  switch (availability) {
    case 'available':
    case 'limited':
      return 1;
    case 'unknown':
      return 0.8;
    case 'not_on_sale':
      return 0.6;
    case 'soldout':
      return EXCLUDE;
  }
}

/* ---------------------------------- Prior ---------------------------------- */

/**
 * Bald vor später – aber sanft: ein starker Treffer in drei Monaten schlägt
 * einen schwachen morgen. Gilt nur ohne Zeitraum in der Anfrage; mit einem
 * entscheidet innerhalb des Zeitraums die Uhr.
 */
export function timePrior(daysAhead: number): number {
  return 0.7 + 0.3 * Math.exp(-Math.max(0, daysAhead) / 21);
}

/** Knappe Karten sind ein Grund hinzuschauen, ausverkaufte einer, es zu lassen. */
export function availabilityPrior(availability: Availability): number {
  switch (availability) {
    case 'available':
    case 'limited':
      return 1;
    case 'unknown':
      return 0.95;
    case 'not_on_sale':
      return 0.85;
    case 'soldout':
      return 0.7;
  }
}

/** Ohne Beschreibung weiss man weniger, worauf man sich einlässt. */
export function completenessPrior(descriptionLength: number): number {
  return descriptionLength >= 40 ? 1 : 0.9;
}

/**
 * Beim Stöbern („Konzerte am Wochenende") geht der einmalige Abend der
 * 39. Vorstellung eines Dauerbrenners vor. Bei einer Namenssuche nicht – wer
 * „König der Löwen" sucht, will genau den Dauerbrenner.
 */
export function rarityPrior(upcomingPerformances: number): number {
  return 1 / (1 + 0.1 * Math.log(Math.max(1, upcomingPerformances)));
}

/* --------------------------------- Gewichte --------------------------------- */

/**
 * λ: wie viel der Suchtext zu sagen hat. Ein seltenes Wort („Rattle") hebt
 * es fast auf 1, ein häufiges („Musik") lässt es bei einem Drittel, ohne
 * Text ist es 0 und die Rangfolge kommt ganz aus `fit × prior`.
 */
export function textLambda(textMass: number): number {
  return textMass <= 0 ? 0 : 1 - Math.exp(-textMass / 3);
}

/**
 * α: Anteil der Bedeutungssuche am Text. Je sicherer die Wortsuche – alle
 * Wörter getroffen, seltene Wörter –, desto weniger. Nie ganz 0 und nie ganz
 * 1: auch eine gute Wortsuche gewinnt durch Bedeutung beim Gleichstand, und
 * auch eine vage Anfrage hat Wörter, die zählen.
 */
export function semanticAlpha(lexicalConfidence: number): number {
  return Math.min(0.85, Math.max(0.15, 1 - lexicalConfidence));
}

/** Kosinus auf 0..1: über den z-Wert der Anfrage, damit Anfragen vergleichbar sind. */
export function calibrate(z: number): number {
  return 1 / (1 + Math.exp(-1.6 * (z - 1.5)));
}
