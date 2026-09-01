/**
 * Veranstaltungsarten prüfen – was liefern die Quellen, und worauf fällt es?
 *
 *   npm run categories                    # alle Quellen, die nächsten Monate
 *   npm run categories -- lostweekend     # nur eine Quelle
 *   npm run categories -- lostweekend 2026-11
 *
 * Ruft die Adapter live auf und stellt den Wortlaut der Quelle dem Wert
 * gegenüber, den `src/lib/events/categories.ts` daraus macht. Mit `*` markiert
 * sind Arten ausserhalb des kanonischen Wortschatzes: die sind kein Fehler –
 * sie entstehen automatisch, damit nichts verlorengeht –, aber sie sind die
 * Stelle zum Hinschauen. Entweder ist es eine Schreibweise für etwas, das es
 * schon gibt (dann als Synonym eintragen), oder wirklich eine neue Art (dann
 * in `CATEGORIES` aufnehmen).
 *
 * Gehört zum Hinzufügen einer Quelle, nach `npm run check`.
 */

import type { CalendarEvent, EventSource } from '../src/lib/events/types.ts';

process.env.EVENT_CACHE_DISK = '0';

const { sources, sourceById } = await import('../src/lib/events/registry.ts');
const { normalizeSourceEvents } = await import('../src/lib/events/normalize.ts');
const { CATEGORIES, isKnownCategory } = await import('../src/lib/events/categories.ts');

const args = process.argv.slice(2);
const months = args.filter((arg) => /^\d{4}-\d{2}$/.test(arg));
const ids = args.filter((arg) => !/^\d{4}-\d{2}$/.test(arg));

const unknown = ids.filter((id) => !sourceById.has(id));
if (unknown.length > 0) {
  console.error(`Unbekannte Quelle(n): ${unknown.join(', ')}`);
  console.error(`Bekannt: ${sources.map((s) => s.definition.id).join(', ')}`);
  process.exit(1);
}

const selected = ids.length > 0 ? ids.map((id) => sourceById.get(id)!) : sources;
const ranges = (months.length > 0 ? months : defaultMonths()).map(monthRange);

/** Kanonische Art -> Wortlaut der Quelle -> Anzahl. */
const table = new Map<string, Map<string, number>>();
const sourcesByCategory = new Map<string, Set<string>>();

for (const source of selected) {
  const counted = await collect(source, ranges);
  console.log(
    `${source.definition.id.padEnd(20)} ${String(counted).padStart(5)} Termine` +
      `${counted === 0 ? '  (nichts geladen)' : ''}`,
  );
}

console.log(`\n${'='.repeat(72)}`);
const news = [...table.keys()].filter((name) => !isKnownCategory(name));
for (const [name, wordings] of sortedByCount(table)) {
  const total = [...wordings.values()].reduce((sum, value) => sum + value, 0);
  const marker = isKnownCategory(name) ? ' ' : '*';
  console.log(
    `\n${marker} ${name}  (${total}, ${[...(sourcesByCategory.get(name) ?? [])].join(', ')})`,
  );
  for (const [wording, count] of [...wordings].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(count).padStart(4)}  ${wording === name ? '=' : wording}`);
  }
}

console.log(`\n${'='.repeat(72)}`);
if (news.length === 0) {
  console.log('Alle Arten stehen im Wortschatz.');
} else {
  console.log(`Neu, nicht im Wortschatz (*): ${news.join(', ')}`);
  console.log('Entscheiden: Synonym einer bestehenden Art oder eigene Art?');
  console.log(`Bestehend: ${CATEGORIES.join(', ')}`);
}

/* ------------------------------------------------------------------ */

async function collect(source: EventSource, list: { from: string; to: string }[]): Promise<number> {
  const seen = new Set<string>();
  let counted = 0;

  for (const range of list) {
    let raw: CalendarEvent[];
    try {
      raw = await source.fetchEvents(range, undefined, {
        requestTimeoutMs: 15_000,
        descriptionBudgetMs: 15_000,
      });
    } catch (error) {
      console.log(`${source.definition.id.padEnd(20)}   ✖ ${range.from.slice(0, 7)}: ${(error as Error).message}`);
      continue;
    }

    // Der Wortlaut steht vor der Normalisierung am Termin, der kanonische
    // Wert danach – deshalb beide Fassungen nebeneinander.
    const normalized = normalizeSourceEvents(raw, source.definition);
    for (const [index, event] of normalized.entries()) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      counted++;

      const name = event.category ?? '—';
      const wording = raw[index]?.category?.trim() || `(${source.definition.id})`;
      const wordings = table.get(name) ?? new Map<string, number>();
      wordings.set(wording, (wordings.get(wording) ?? 0) + 1);
      table.set(name, wordings);
      const sourceIds = sourcesByCategory.get(name) ?? new Set<string>();
      sourceIds.add(source.definition.id);
      sourcesByCategory.set(name, sourceIds);
    }
  }

  return counted;
}

function sortedByCount(input: Map<string, Map<string, number>>): [string, Map<string, number>][] {
  const total = (wordings: Map<string, number>) =>
    [...wordings.values()].reduce((sum, value) => sum + value, 0);
  return [...input].sort((a, b) => total(b[1]) - total(a[1]));
}

/** Laufender Monat und die beiden folgenden – genug für einen Querschnitt. */
function defaultMonths(): string[] {
  const now = new Date();
  return [0, 1, 2].map((offset) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${last}` };
}
