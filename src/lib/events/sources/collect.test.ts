import assert from 'node:assert/strict';
import test from 'node:test';
import { settleParts } from './collect.ts';
import { assertRecognised } from './page.ts';

const quietly = async <T>(run: () => Promise<T>): Promise<{ result: T; warnings: string[] }> => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = warn;
  }
};

test('liefert alle Teile in der Reihenfolge der Anfrage', async () => {
  const { result, warnings } = await quietly(() =>
    settleParts({ sourceId: 'x', parts: ['2026-09', '2026-10'], load: async (month) => `${month}!` }),
  );
  assert.deepEqual(result, ['2026-09!', '2026-10!']);
  assert.deepEqual(warnings, []);
});

test('nimmt einzelne Lücken hin und meldet sie', async () => {
  const { result, warnings } = await quietly(() =>
    settleParts({
      sourceId: 'x',
      parts: ['2026-09', '2026-10'],
      load: async (month) => {
        if (month === '2026-10') throw new Error('503');
        return month;
      },
    }),
  );
  assert.deepEqual(result, ['2026-09']);
  assert.deepEqual(warnings, ['[x] Teilausfall – 2026-10: 503']);
});

test('wirft bei Totalausfall mit allen Gründen', async () => {
  await assert.rejects(
    settleParts({
      sourceId: 'x',
      parts: [{ name: 'Oper' }, { name: 'Ballett' }],
      label: (sparte) => sparte.name,
      load: async (sparte) => {
        throw new Error(`${sparte.name} kaputt`);
      },
    }),
    { message: 'Oper: Oper kaputt; Ballett: Ballett kaputt' },
  );
});

test('lädt auf Wunsch nacheinander', async () => {
  let running = 0;
  let peak = 0;
  await settleParts({
    sourceId: 'x',
    parts: [1, 2, 3],
    sequential: true,
    load: async (part) => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return part;
    },
  });
  assert.equal(peak, 1);
});

test('ohne Teile gibt es nichts zu melden', async () => {
  assert.deepEqual(await settleParts({ sourceId: 'x', parts: [], load: async () => 1 }), []);
});

test('trennt leere Liste von unerkannter Seite', () => {
  assert.doesNotThrow(() => assertRecognised(3, false, 'Programm'));
  assert.doesNotThrow(() => assertRecognised(0, true, 'Programm'));
  assert.throws(() => assertRecognised(0, false, 'Spielplan 2026-09'), {
    message: 'Spielplan 2026-09: kein Termin erkannt (Layout geändert?)',
  });
});
