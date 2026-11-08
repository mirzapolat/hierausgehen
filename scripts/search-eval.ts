/**
 * Wie gut ist die Suche? Misst die Rangfolge gegen `search-judgments.ts`.
 *
 *   npm run search:eval                 # mit und ohne Bedeutungssuche
 *   npm run search:eval -- --lexical    # nur Wortsuche (ohne Modell)
 *
 * Grundlage ist der Demo-Abzug (`demo/muenchen.json`, `npm run demo:pull`),
 * „jetzt" ist der Zeitpunkt des Abzugs. Gemessen werden
 *
 * - nDCG@10: stehen die besten Treffer oben? 1 = ideale Reihenfolge.
 * - MRR: wie weit oben steht der erste gute Treffer (Note ≥ 2)?
 *
 * Getrennt nach Art der Anfrage, damit sichtbar wird, ob die Bedeutungssuche
 * die vagen Anfragen besser macht, ohne Namen und Angaben schlechter zu machen.
 */
import { readFileSync } from 'node:fs';
import { addDays, weekday } from '../src/lib/calendar.ts';
import { todayInZone } from '../src/lib/events/schedule.ts';
import type { CalendarEvent } from '../src/lib/events/types.ts';
import { localClock } from '../src/lib/search/engine.ts';
import { judgments, type Context, type Judgment } from './search-judgments.ts';

process.env.EVENT_DEMO = '1';
const { runSearch, searchIndex, warmSearch } = await import('../src/lib/search/service.ts');

const cityId = 'muenchen';
const timeZone = 'Europe/Berlin';
const demo = JSON.parse(readFileSync(`demo/${cityId}.json`, 'utf8')) as { pulledAt: string };
const now = new Date(demo.pulledAt);
const clock = localClock(timeZone);
const context: Context = {
  day: (event) => clock(event.start).day,
  minutes: (event) => clock(event.start).minutes,
  today: todayInZone(timeZone, now),
  addDays,
  weekday,
};

const lexicalOnly = process.argv.includes('--lexical');
if (!lexicalOnly) {
  console.log('Vektoren vorbereiten (beim ersten Mal etwa eine Minute) …');
  await warmSearch([cityId]);
}

const index = await searchIndex(cityId);
const upcoming = (event: CalendarEvent) => Date.parse(event.end ?? event.start) >= now.getTime();

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
}

/** Ideal: die zehn besten Produktionen des Bestands, jede mit ihrem besten kommenden Termin. */
function idealGrades(judgment: Judgment): number[] {
  return index.docs
    .map((doc) => Math.max(0, ...doc.events.filter(upcoming).map((event) => judgment.grade(event, context))))
    .sort((a, b) => b - a)
    .slice(0, 10);
}

interface Row {
  query: string;
  kind: Judgment['kind'];
  ndcg: number;
  mrr: number;
  top: string;
}

async function evaluate(semantic: boolean): Promise<Row[]> {
  process.env.EVENT_SEMANTIC = semantic ? '1' : '0';
  const rows: Row[] = [];
  for (const judgment of judgments) {
    const { result } = await runSearch({ query: judgment.query, cityId, now, limit: 10 });
    const grades = result.hits.map((hit) => judgment.grade(hit.event, context));
    const ideal = dcg(idealGrades(judgment));
    const firstGood = grades.findIndex((grade) => grade >= 2);
    rows.push({
      query: judgment.query,
      kind: judgment.kind,
      ndcg: ideal > 0 ? dcg(grades) / ideal : 1,
      mrr: firstGood >= 0 ? 1 / (firstGood + 1) : 0,
      top: result.hits[0]?.event.title.slice(0, 40) ?? '–',
    });
  }
  return rows;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const fixed = (value: number) => value.toFixed(2);

const lexical = await evaluate(false);
const semantic = lexicalOnly ? undefined : await evaluate(true);

console.log(
  '\n' + 'Anfrage'.padEnd(37) + 'Art'.padEnd(9) + 'nDCG wort'.padEnd(11) + (semantic ? 'nDCG +bed'.padEnd(11) : '') + 'erster Treffer',
);
lexical.forEach((row, i) => {
  const other = semantic?.[i];
  const delta = other ? other.ndcg - row.ndcg : 0;
  const flag = other ? (delta > 0.05 ? ' ▲' : delta < -0.05 ? ' ▼' : '') : '';
  console.log(
    row.query.slice(0, 36).padEnd(37) +
      row.kind.padEnd(9) +
      fixed(row.ndcg).padEnd(11) +
      (other ? (fixed(other.ndcg) + flag).padEnd(11) : '') +
      (other ?? row).top,
  );
});

console.log('\n' + 'Nach Art'.padEnd(17) + 'nDCG wort  MRR wort' + (semantic ? '   nDCG +bed  MRR +bed' : ''));
const kinds = [...new Set(judgments.map((judgment) => judgment.kind as string)), 'alle'];
for (const kind of kinds) {
  const pick = (rows: Row[]) => (kind === 'alle' ? rows : rows.filter((row) => row.kind === kind));
  console.log(
    kind.padEnd(17) +
      fixed(mean(pick(lexical).map((row) => row.ndcg))).padEnd(11) +
      fixed(mean(pick(lexical).map((row) => row.mrr))).padEnd(9) +
      (semantic
        ? '   ' + fixed(mean(pick(semantic).map((row) => row.ndcg))).padEnd(11) + fixed(mean(pick(semantic).map((row) => row.mrr)))
        : ''),
  );
}
