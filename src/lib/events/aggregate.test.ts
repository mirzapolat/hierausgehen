import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Kein Cache auf Platte und eine kurze Frist – sonst dauern die Tests so lange
// wie im Betrieb. Muss vor dem Import der Module gesetzt sein.
process.env.EVENT_CACHE_DISK = '0';
process.env.EVENT_SOURCE_DEADLINE_MS = '300';
// Der Spiegel liegt im Betrieb als Bind-Mount im Container; für den Test
// genügt ein eigenes Verzeichnis, das kein echtes überschreibt.
process.env.EVENT_MIRROR_DIR = await mkdtemp(path.join(tmpdir(), 'hierausgehen-mirror-'));

const { aggregateEvents } = await import('./aggregate.ts');
const { writeCache } = await import('./cache.ts');
const { mirrorPath } = await import('./mirror.ts');
import type { CalendarEvent, EventFetchOptions, EventSource } from './types.ts';

const RANGE = { from: '2026-10-01', to: '2026-10-31' };

let counter = 0;
/** Quelle, die nie antwortet – wie ein Haus, das die Server-IP blockiert. */
function hangingSource(id: string): EventSource & { calls: number } {
  const source = {
    calls: 0,
    definition: {
      id,
      name: id,
      cityId: 'muenchen',
      group: 'Test',
      color: '#000',
      homepage: 'https://example.invalid',
    },
    ttlSeconds: 1,
    async fetchEvents(): Promise<CalendarEvent[]> {
      source.calls++;
      // Antwortet nie von selbst; nur die Frist beendet das.
      return new Promise(() => {});
    },
  };
  return source;
}

function sampleEvent(sourceId: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `${sourceId}:1`,
    sourceId,
    title: 'Aus dem Zwischenspeicher',
    start: '2026-10-10T19:00:00+02:00',
    allDay: false,
    venue: { name: 'Testbühne' },
    availability: 'available',
    url: 'https://example.invalid/termin',
    ...overrides,
  };
}

test('eine hängende Quelle blockiert nicht länger als die Frist', async () => {
  const source = hangingSource(`hang-${counter++}`);
  const started = Date.now();
  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1500, `hat ${elapsed} ms gedauert`);
  assert.equal(result.events.length, 0);
  assert.equal(result.sources[0].status, 'error');
  assert.match(result.sources[0].error ?? '', /Zeitlimit/);
});

test('veraltete Daten kommen sofort, die Auffrischung läuft im Hintergrund', async () => {
  const source = hangingSource(`stale-${counter++}`);
  const id = source.definition.id;
  // Eintrag, der bereits abgelaufen ist.
  await writeCache(`${id}_${RANGE.from}_${RANGE.to}`, [sampleEvent(id)], -1);

  const started = Date.now();
  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 100, `hat ${elapsed} ms gedauert – es wurde gewartet`);
  assert.equal(result.events.length, 1, 'die alten Termine werden ausgeliefert');
  assert.equal(result.sources[0].status, 'revalidating');
  assert.equal(source.calls, 1, 'die Auffrischung wurde angestossen');
});

test('nach mehreren Fehlversuchen wird die Quelle übersprungen', async () => {
  const source = hangingSource(`breaker-${counter++}`);

  for (let i = 0; i < 2; i++) {
    await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });
  }
  assert.equal(source.calls, 2, 'zweimal erfolglos versucht');

  const started = Date.now();
  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });
  const elapsed = Date.now() - started;

  assert.equal(source.calls, 2, 'der dritte Aufruf fasst die Quelle nicht mehr an');
  assert.ok(elapsed < 100, `hat ${elapsed} ms gedauert`);
  assert.equal(result.sources[0].status, 'error');
});

test('eine gesunde Quelle liefert normal und ohne Warnung', async () => {
  const id = `ok-${counter++}`;
  const source: EventSource = {
    definition: { id, name: id, cityId: 'muenchen', group: 'Test', color: '#000', homepage: 'https://example.invalid' },
    ttlSeconds: 60,
    async fetchEvents() {
      return [sampleEvent(id)];
    },
  };

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });
  assert.equal(result.sources[0].status, 'ok');
  assert.equal(result.events.length, 1);
});

test('ergänzt fehlende Veranstaltungsarten aus der Quelle', async () => {
  const id = `category-${counter++}`;
  const source: EventSource = {
    definition: {
      id,
      name: id,
      cityId: 'muenchen',
      group: 'Theater',
      defaultCategory: 'Schauspiel',
      color: '#000',
      homepage: 'https://example.invalid',
    },
    ttlSeconds: 60,
    async fetchEvents() {
      return [sampleEvent(id, { category: undefined })];
    },
  };

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });

  assert.equal(result.events[0].category, 'Schauspiel');
});

test('filtert dopplungen über quellen hinweg und behält die reichere fassung', async () => {
  const plain = `duplicate-plain-${counter++}`;
  const rich = `duplicate-rich-${counter++}`;
  const sources: EventSource[] = [
    {
      definition: {
        id: plain,
        name: plain,
        cityId: 'muenchen',
        group: 'Theater',
        color: '#000',
        homepage: 'https://example.invalid',
      },
      async fetchEvents() {
        return [
          sampleEvent(plain, {
            title: ' Macbeth ',
            venue: { name: ' Nationaltheater ' },
            availability: 'unknown',
          }),
        ];
      },
    },
    {
      definition: {
        id: rich,
        name: rich,
        cityId: 'muenchen',
        group: 'Oper',
        color: '#111',
        homepage: 'https://example.invalid',
      },
      async fetchEvents() {
        return [
          sampleEvent(rich, {
            title: 'Macbeth',
            venue: { name: 'Nationaltheater München' },
            availability: 'available',
            ticketUrl: 'https://tickets.example.invalid/macbeth',
          }),
        ];
      },
    },
  ];

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sourceId, rich);
  assert.equal(result.events[0].ticketUrl, 'https://tickets.example.invalid/macbeth');
});

test('verknüpft mehrere Aufführungen derselben Veranstaltung', async () => {
  const id = `performances-${counter++}`;
  const source: EventSource = {
    definition: {
      id,
      name: id,
      cityId: 'muenchen',
      group: 'Theater',
      color: '#000',
      homepage: 'https://example.invalid',
    },
    async fetchEvents() {
      return [
        sampleEvent(id, {
          id: `${id}:macbeth-1`,
          title: 'Macbeth',
          subtitle: 'William Shakespeare',
          start: '2026-10-10T19:00:00+02:00',
          venue: { name: 'Testbühne' },
        }),
        sampleEvent(id, {
          id: `${id}:macbeth-2`,
          title: 'Macbeth',
          subtitle: 'William Shakespeare',
          start: '2026-10-12T19:30:00+02:00',
          venue: { name: 'Testbühne' },
          availability: 'limited',
        }),
        sampleEvent(id, {
          id: `${id}:macbeth-gastspiel`,
          title: 'Macbeth',
          subtitle: 'William Shakespeare',
          start: '2026-10-13T19:00:00+02:00',
          venue: { name: 'Andere Bühne' },
        }),
      ];
    },
  };

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });
  const first = result.events.find((event) => event.id === `${id}:macbeth-1`)!;
  const second = result.events.find((event) => event.id === `${id}:macbeth-2`)!;
  const guest = result.events.find((event) => event.id === `${id}:macbeth-gastspiel`)!;

  assert.equal(result.events.length, 3);
  assert.deepEqual(first.relatedPerformances?.map((performance) => performance.id), [
    `${id}:macbeth-2`,
  ]);
  assert.equal(first.relatedPerformances?.[0].availability, 'limited');
  assert.deepEqual(second.relatedPerformances?.map((performance) => performance.id), [
    `${id}:macbeth-1`,
  ]);
  assert.equal(guest.relatedPerformances, undefined);
});

test('reicht längere Fristen an explizite Quellenabrufe weiter', async () => {
  const id = `retry-options-${counter++}`;
  let received: EventFetchOptions | undefined;
  const source: EventSource = {
    definition: {
      id,
      name: id,
      cityId: 'muenchen',
      group: 'Test',
      color: '#000',
      homepage: 'https://example.invalid',
    },
    async fetchEvents(_range, _signal, options) {
      received = options;
      return [sampleEvent(id)];
    },
  };

  await aggregateEvents(RANGE, {
    cityId: 'muenchen',
    force: true,
    sources: [source],
    fetchOptions: { deadlineMs: 1_000, requestTimeoutMs: 900 },
  });

  assert.deepEqual(received, { deadlineMs: 1_000, requestTimeoutMs: 900 });
});

/* --------------------------------- Spiegel -------------------------------- */

/**
 * Für eine Quelle, deren Server die Adresse dieses Rechners blockiert, erhebt
 * ein GitHub-Runner die Termine und legt sie als Spiegel ab. Die Aggregation
 * muss daraus einen vollwertigen Datenstand machen – sonst hilft der Spiegel
 * nichts.
 */
async function writeMirror(
  sourceId: string,
  events: CalendarEvent[],
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  await writeFile(
    mirrorPath(sourceId),
    JSON.stringify({ sourceId, range: RANGE, fetchedAt, events }),
    'utf8',
  );
}

test('eine blockierte Quelle wird aus dem Spiegel bedient', async () => {
  const source = hangingSource(`mirror-${counter++}`);
  const id = source.definition.id;
  await writeMirror(id, [sampleEvent(id, { title: 'Aus dem Spiegel' })]);

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Aus dem Spiegel');
  assert.equal(result.sources[0].status, 'ok', 'ein frischer Spiegel ist ein echter Stand');
});

test('ein alter Spiegel liefert Termine, gilt aber als veraltet', async () => {
  const source = hangingSource(`mirror-old-${counter++}`);
  const id = source.definition.id;
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await writeMirror(id, [sampleEvent(id)], threeDaysAgo);

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });

  assert.equal(result.events.length, 1);
  assert.equal(result.sources[0].status, 'stale');
  assert.equal(result.sources[0].fetchedAt, threeDaysAgo, 'der Zeitpunkt der Erhebung zählt');
});

test('der Spiegel liefert nur Termine im abgefragten Zeitraum', async () => {
  const source = hangingSource(`mirror-range-${counter++}`);
  const id = source.definition.id;
  await writeMirror(id, [
    sampleEvent(id, { id: `${id}:innen`, start: '2026-10-10T19:00:00+02:00' }),
    sampleEvent(id, { id: `${id}:aussen`, start: '2026-12-10T19:00:00+01:00' }),
  ]);

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });

  assert.deepEqual(
    result.events.map((event) => event.id),
    [`${id}:innen`],
  );
});

test('ein Spiegel mit fremder Quellen-ID wird verworfen', async () => {
  const source = hangingSource(`mirror-fremd-${counter++}`);
  const id = source.definition.id;
  await writeFile(
    mirrorPath(id),
    JSON.stringify({
      sourceId: 'andere-quelle',
      range: RANGE,
      fetchedAt: new Date().toISOString(),
      events: [sampleEvent('andere-quelle')],
    }),
    'utf8',
  );

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });

  assert.equal(result.events.length, 0, 'lieber keine Termine als falsch zugeordnete');
  assert.equal(result.sources[0].status, 'error');
});

test('der eigene Cache gewinnt, wenn er jünger ist als der Spiegel', async () => {
  const source = hangingSource(`mirror-cache-${counter++}`);
  const id = source.definition.id;
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await writeMirror(id, [sampleEvent(id, { title: 'Aus dem Spiegel' })], lastWeek);
  // Abgelaufen, aber vorhin erhoben – und mit `force` fällt der Weg über den
  // veralteten Cache oben weg, es entscheidet also wirklich der Zeitpunkt.
  await writeCache(`${id}_${RANGE.from}_${RANGE.to}`, [sampleEvent(id)], -1);

  const result = await aggregateEvents(RANGE, {
    cityId: 'muenchen',
    sources: [source],
    force: true,
  });

  assert.equal(result.events[0].title, 'Aus dem Zwischenspeicher');
  assert.equal(result.sources[0].status, 'stale');
});
