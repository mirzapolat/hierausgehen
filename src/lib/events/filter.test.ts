import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFeedFilter, feedSearchParams, matchesText, parseFeedFilter } from './filter.ts';
import type { CalendarEvent } from './types.ts';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'staatsoper:1',
    sourceId: 'staatsoper',
    title: 'Ariadne auf Naxos',
    start: '2026-10-14T19:00:00+02:00',
    allDay: false,
    venue: { name: 'Nationaltheater' },
    availability: 'available',
    url: 'https://www.staatsoper.de/stueck/ariadne',
    category: 'Oper',
    ...overrides,
  };
}

const events = [
  event(),
  event({ id: 'unterfahrt:1', sourceId: 'unterfahrt', title: 'Jazz Session', category: 'Konzert', categoryLabel: 'Live Music', availability: 'soldout' }),
  event({ id: 'milla:1', sourceId: 'milla', title: 'Lesung', category: undefined, notes: ['Eintritt frei'], availability: 'unknown' }),
];

const ids = (list: CalendarEvent[]) => list.map((e) => e.id);

test('matchesText sucht in Titel, Ort, Art und Wortlaut der Quelle', () => {
  assert.ok(matchesText(events[0], 'national', 'de'));
  assert.ok(matchesText(events[1], 'live music', 'de'));
  assert.ok(matchesText(events[1], 'concert', 'en', () => 'Concert'));
  assert.ok(!matchesText(events[0], 'jazz', 'de'));
  assert.ok(matchesText(events[0], '   ', 'de'));
});

test('ein Abo ohne Filter enthält alles', () => {
  assert.deepEqual(ids(applyFeedFilter(events, {})), ids(events));
});

test('Quellen, Arten, Karten, Eintritt und Text schränken ein', () => {
  assert.deepEqual(ids(applyFeedFilter(events, { sources: ['unterfahrt'] })), ['unterfahrt:1']);
  assert.deepEqual(ids(applyFeedFilter(events, { categories: ['Oper', ''] })), ['staatsoper:1', 'milla:1']);
  assert.deepEqual(ids(applyFeedFilter(events, { skipCategories: ['Oper'] })), ['unterfahrt:1', 'milla:1']);
  assert.deepEqual(ids(applyFeedFilter(events, { ticketsOnly: true })), ['staatsoper:1']);
  assert.deepEqual(ids(applyFeedFilter(events, { freeOnly: true })), ['milla:1']);
  // Englische Namen der Arten zählen auch im Abo.
  assert.deepEqual(ids(applyFeedFilter(events, { query: 'opera' })), ['staatsoper:1']);
});

test('eine Auswahl von Arten sticht die ausgeschlossenen', () => {
  assert.deepEqual(
    ids(applyFeedFilter(events, { categories: ['Oper'], skipCategories: ['Oper'] })),
    ['staatsoper:1'],
  );
});

test('die Adresse eines Abos übersteht den Weg hin und zurück', () => {
  const filter = {
    sources: ['unterfahrt', 'milla'],
    skipCategories: ['Kino', ''],
    ticketsOnly: true,
    freeOnly: false,
    query: ' jazz ',
  };
  const params = feedSearchParams('muenchen', filter);
  assert.equal(params.get('city'), 'muenchen');
  // Sortiert: dieselbe Auswahl ergibt dieselbe Adresse.
  assert.equal(params.get('source'), 'milla,unterfahrt');
  assert.equal(params.get('free'), null);

  const parsed = parseFeedFilter(new URLSearchParams(params.toString()));
  assert.deepEqual(parsed.sources, ['milla', 'unterfahrt']);
  assert.deepEqual(parsed.skipCategories, ['', 'Kino']);
  assert.equal(parsed.categories, undefined);
  assert.equal(parsed.ticketsOnly, true);
  assert.equal(parsed.freeOnly, false);
  assert.equal(parsed.query, 'jazz');
});

test('ohne Filter steht nur die Stadt in der Adresse', () => {
  assert.equal(feedSearchParams('glasgow', { skipCategories: [], query: '' }).toString(), 'city=glasgow');
});
