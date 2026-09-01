import assert from 'node:assert/strict';
import test from 'node:test';

// Kein Cache auf Platte und eine kurze Frist – wie in aggregate.test.ts.
// Muss vor dem Import der Module gesetzt sein.
process.env.EVENT_CACHE_DISK = '0';
process.env.EVENT_SOURCE_DEADLINE_MS = '300';

const { eventsInRange, snapshotRange } = await import('./snapshot.ts');
const { writeCache } = await import('./cache.ts');
const { sources } = await import('./registry.ts');
import type { AggregateResult } from './types.ts';

const CITY = 'muenchen';
const range = snapshotRange(CITY);
const snapshotKey = `snapshot_${CITY}_${range.from}_${range.to}`;
const registered = sources.map((source) => source.definition.id);

/**
 * Jede Quelle bekommt einen frischen, leeren Eigencache. Damit bleibt auch
 * das Nachholen im Hintergrund ohne Netz – geprüft wird hier der Umgang mit
 * dem Datenstand, nicht das Verhalten der Häuser.
 */
async function seedSourceCaches(): Promise<void> {
  for (const id of registered) await writeCache(`${id}_${range.from}_${range.to}`, [], 3600);
}

/** Ein gültiger Stand, der nur die erste Quelle kennt. */
async function seedPartialSnapshot(): Promise<void> {
  const [first] = sources;
  const snapshot: AggregateResult = {
    events: [],
    sources: [
      {
        sourceId: first.definition.id,
        status: 'ok',
        fetchedAt: new Date().toISOString(),
        eventCount: 0,
      },
    ],
    definitions: [first.definition],
  };
  await writeCache(snapshotKey, snapshot, 3600);
}

test('zeigt jede registrierte Quelle, auch wenn der Datenstand sie nicht kennt', async () => {
  await seedSourceCaches();
  await seedPartialSnapshot();

  const result = await eventsInRange(CITY, range);

  // Die Sidebar baut sich aus `definitions` – da muss alles drinstehen, was
  // die Registry kennt, nicht nur das, was beim letzten Lauf erhoben wurde.
  assert.deepEqual(
    result.definitions.map((definition) => definition.id).sort(),
    [...registered].sort(),
  );
});

test('meldet eine noch nicht erhobene Quelle als solche, statt sie zu verschweigen', async () => {
  await seedSourceCaches();
  await seedPartialSnapshot();

  const result = await eventsInRange(CITY, range);
  const fehlend = registered.filter((id) => id !== sources[0].definition.id);

  for (const id of fehlend) {
    const status = result.sources.find((source) => source.sourceId === id);
    assert.ok(status, `${id} hat einen Statuseintrag`);
    // Ohne eigenen Status wäre die Quelle in der Oberfläche nicht von einer
    // ohne Termine zu unterscheiden – und ohne Knopf zum Nachladen.
    assert.equal(status.status, 'error');
    assert.equal(status.error, 'Noch nicht erhoben');
    assert.equal(status.eventCount, 0);
  }

  const vorhanden = result.sources.find((s) => s.sourceId === sources[0].definition.id);
  assert.equal(vorhanden!.status, 'ok', 'die bekannte Quelle bleibt unangetastet');
});

test('holt die fehlenden Quellen im Hintergrund nach', async () => {
  await seedSourceCaches();
  await seedPartialSnapshot();

  // Der erste Aufruf wartet nicht – er stösst das Nachholen nur an.
  await eventsInRange(CITY, range);

  const deadline = Date.now() + 3000;
  let result = await eventsInRange(CITY, range);
  while (result.sources.some((s) => s.error === 'Noch nicht erhoben') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    result = await eventsInRange(CITY, range);
  }

  assert.deepEqual(
    result.sources.map((source) => source.sourceId).sort(),
    [...registered].sort(),
  );
  for (const status of result.sources) {
    assert.equal(status.status, 'ok', `${status.sourceId} wurde nachgeholt`);
  }
});
