import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Der Zwischenspeicher liegt im Arbeitsverzeichnis – für den Test also in
 * einem eigenen. Muss vor dem Import stehen: das Modul liest den Pfad einmal.
 */
const previousCwd = process.cwd();
const dir = mkdtempSync(path.join(tmpdir(), 'hierausgehen-cache-'));
process.chdir(dir);

const { readCache, writeCache } = await import('./cache.ts');

const diskPath = (key: string) => path.join(dir, '.cache', 'events', `${key}.json`);

test.after(() => {
  process.chdir(previousCwd);
  rmSync(dir, { recursive: true, force: true });
});

test('liest wieder, was es geschrieben hat', async () => {
  await writeCache('probe', { value: 1 }, 3600);
  assert.deepEqual((await readCache<{ value: number }>('probe'))?.value, { value: 1 });
});

test('übernimmt, was ein anderer Prozess auf die Platte geschrieben hat', async () => {
  await writeCache('geteilt', { value: 'alt' }, 3600);

  // Genau der Fall aus dem Betrieb: Server Components und Route Handler sind
  // getrennte Modulinstanzen mit je eigenem Speicher. Schreibt die eine, muss
  // die andere es sehen – sonst liefert die Startansicht wochenlang einen
  // Stand, den die API längst überholt hat.
  writeFileSync(
    diskPath('geteilt'),
    JSON.stringify({ value: { value: 'neu' }, fetchedAt: new Date().toISOString(), expiresAt: Date.now() + 3_600_000 }),
    'utf8',
  );
  // Die Änderungszeit muss messbar jünger sein als der eigene Schreibvorgang.
  await new Promise((resolve) => setTimeout(resolve, 12));
  writeFileSync(
    diskPath('geteilt'),
    JSON.stringify({ value: { value: 'neu' }, fetchedAt: new Date().toISOString(), expiresAt: Date.now() + 3_600_000 }),
    'utf8',
  );

  assert.deepEqual((await readCache<{ value: string }>('geteilt'))?.value, { value: 'neu' });
});

test('behält den Speicherstand, wenn auf der Platte nichts (mehr) liegt', async () => {
  await writeCache('fluechtig', { value: 'da' }, 3600);
  rmSync(diskPath('fluechtig'));
  assert.deepEqual((await readCache<{ value: string }>('fluechtig'))?.value, { value: 'da' });
});
