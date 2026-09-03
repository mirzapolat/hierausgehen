import assert from 'node:assert/strict';
import test from 'node:test';

// Kein Cache auf Platte und eine kurze Frist – wie in aggregate.test.ts.
// Muss vor dem Import der Module gesetzt sein.
process.env.EVENT_CACHE_DISK = '0';
process.env.EVENT_SOURCE_DEADLINE_MS = '300';

const { collectInto, eventsInRange, pendingRepairs, snapshotRange, unknownSources } =
  await import('./snapshot.ts');
const { readCache, writeCache } = await import('./cache.ts');
const { sources } = await import('./registry.ts');
import type { AggregateResult } from './types.ts';

const CITY = 'muenchen';
const range = snapshotRange(CITY);
const snapshotKey = `snapshot_${CITY}_${range.from}_${range.to}`;
const registered = sources.map((source) => source.definition.id);
const NOW = new Date().toISOString();

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

test('erkennt eine bei der Erhebung ausgefallene Quelle als nachzuholen', () => {
  const stand: AggregateResult = {
    events: [],
    sources: [
      { sourceId: 'a', status: 'ok', fetchedAt: NOW, eventCount: 12 },
      { sourceId: 'b', status: 'revalidating', fetchedAt: NOW, eventCount: 3 },
      { sourceId: 'c', status: 'error', fetchedAt: NOW, eventCount: 0, error: 'nicht erreichbar' },
      { sourceId: 'd', status: 'stale', fetchedAt: NOW, eventCount: 7, error: 'nicht erreichbar' },
    ],
    definitions: [],
  };

  const { missing, failed } = pendingRepairs(['a', 'b', 'c', 'd', 'e'], stand);

  // Ohne das bliebe eine Quelle bis zur nächsten Erhebung kaputt, auch wenn
  // die Ursache längst behoben ist.
  assert.deepEqual(failed, ['c', 'd']);
  assert.deepEqual(missing, ['e']);
});

test('lässt einen vollständigen Stand in Ruhe', () => {
  const stand: AggregateResult = {
    events: [],
    sources: [
      { sourceId: 'a', status: 'ok', fetchedAt: NOW, eventCount: 12 },
      // Eine leere Quelle ist keine kaputte – ein Haus darf Pause haben.
      { sourceId: 'b', status: 'ok', fetchedAt: NOW, eventCount: 0 },
    ],
    definitions: [],
  };

  assert.deepEqual(pendingRepairs(['a', 'b'], stand), { missing: [], failed: [] });
});

test('erkennt eine heute hinzugekommene Quelle am gespeicherten Stand', async () => {
  await seedSourceCaches();
  await seedPartialSnapshot();

  // Genau der Fall nach einem Deployment: der Stand von heute Nacht ist
  // gültig, kennt die neu registrierte Quelle aber nicht.
  assert.deepEqual(await unknownSources(CITY), registered.slice(1));
});

test('holt eine neue Quelle in den bestehenden Stand, ohne auf einen Besuch zu warten', async () => {
  await seedSourceCaches();
  await seedPartialSnapshot();

  const fresh = await unknownSources(CITY);
  const pending = await collectInto(CITY, fresh);

  // Nichts bleibt offen, und der gespeicherte Stand kennt danach alles –
  // ohne dass jemand die Seite aufgerufen hätte.
  assert.deepEqual(pending, []);
  const stored = await readCache<AggregateResult>(snapshotKey);
  assert.deepEqual(
    stored!.value.sources.map((source) => source.sourceId).sort(),
    [...registered].sort(),
  );
});

test('ohne offene Namen bleibt der Stand unangetastet', async () => {
  await seedPartialSnapshot();
  const before = await readCache<AggregateResult>(snapshotKey);
  assert.deepEqual(await collectInto(CITY, []), []);
  assert.equal((await readCache<AggregateResult>(snapshotKey))!.fetchedAt, before!.fetchedAt);
});
