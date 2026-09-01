import assert from 'node:assert/strict';
import test from 'node:test';

// Kein Cache auf Platte und eine kurze Frist – sonst dauern die Tests so lange
// wie im Betrieb. Muss vor dem Import der Module gesetzt sein.
process.env.EVENT_CACHE_DISK = '0';
process.env.EVENT_SOURCE_DEADLINE_MS = '300';

const { aggregateEvents } = await import('./aggregate.ts');
const { writeCache } = await import('./cache.ts');
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
      group: 'Theater' as const,
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
    definition: { id, name: id, cityId: 'muenchen', group: 'Theater', homepage: 'https://example.invalid' },
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
      homepage: 'https://example.invalid',
    },
    ttlSeconds: 60,
    async fetchEvents() {
      return [sampleEvent(id, { category: undefined })];
    },
  };

  const result = await aggregateEvents(RANGE, { cityId: 'muenchen', sources: [source] });

  // Auch der Fallback der Quelle läuft durch den Wortschatz: "Schauspiel"
  // ist dort eine Schreibweise von "Theater".
  assert.equal(result.events[0].category, 'Theater');
  assert.equal(result.events[0].categoryLabel, undefined);
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
        group: 'Oper & Ballett',
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
      group: 'Theater',
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
