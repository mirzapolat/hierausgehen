import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFeedFilter,
  feedSearchParams,
  matchesText,
  matchesTimeOfDay,
  parseFeedFilter,
  normalizeTimeOfDayStarts,
  TIME_OF_DAY_START,
  timeOfDay,
} from './filter.ts';
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

/** Minuten aus der Uhrzeit des ISO-Strings – die Zeitzone steht schon darin. */
const clock = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

test('Tageszeiten folgen dem Ausgehen: Nachts reicht über Mitternacht', () => {
  assert.equal(timeOfDay(5 * 60), 'day');
  assert.equal(timeOfDay(16 * 60 + 59), 'day');
  assert.equal(timeOfDay(17 * 60), 'evening');
  assert.equal(timeOfDay(21 * 60 + 59), 'evening');
  assert.equal(timeOfDay(22 * 60), 'night');
  assert.equal(timeOfDay(60), 'night');
  assert.equal(timeOfDay(4 * 60 + 59), 'night');
});

test('Tageszeit: keine oder alle heisst ohne Einschränkung, Ganztägiges fällt sonst heraus', () => {
  const evening = { start: '2026-10-14T19:00:00+02:00', allDay: false };
  const allDay = { start: '2026-10-14T00:00:00+02:00', allDay: true };
  assert.ok(matchesTimeOfDay(evening, [], clock));
  assert.ok(matchesTimeOfDay(allDay, ['day', 'evening', 'night'], clock));
  assert.ok(matchesTimeOfDay(evening, ['evening', 'night'], clock));
  assert.ok(!matchesTimeOfDay(evening, ['day'], clock));
  assert.ok(!matchesTimeOfDay(allDay, ['day'], clock));
});

test('das Abo filtert nach Tageszeit, wenn es die Uhr der Stadt kennt', () => {
  const list = [
    event({ id: 'a', start: '2026-10-14T11:00:00+02:00' }),
    event({ id: 'b', start: '2026-10-14T23:30:00+02:00' }),
  ];
  assert.deepEqual(ids(applyFeedFilter(list, { timesOfDay: ['night'] }, clock)), ['b']);
  // Ohne Uhr bleibt die Tageszeit unberücksichtigt.
  assert.deepEqual(ids(applyFeedFilter(list, { timesOfDay: ['night'] })), ['a', 'b']);
});

test('Tageszeiten stehen in der Adresse – alle drei gar nicht', () => {
  const params = feedSearchParams('muenchen', { timesOfDay: ['night', 'evening'] });
  assert.equal(params.get('time'), 'evening,night');
  assert.deepEqual(parseFeedFilter(params).timesOfDay, ['evening', 'night']);
  assert.equal(feedSearchParams('muenchen', { timesOfDay: ['day', 'evening', 'night'] }).get('time'), null);
  assert.deepEqual(parseFeedFilter(new URLSearchParams('time=evening,mittags')).timesOfDay, ['evening']);
});

test('eigene Grenzen der Tageszeiten', () => {
  const starts = { day: 7, evening: 18, night: 23 };
  assert.equal(timeOfDay(6 * 60, starts), 'night');
  assert.equal(timeOfDay(17 * 60 + 30, starts), 'day');
  assert.equal(timeOfDay(22 * 60 + 30, starts), 'evening');
  assert.equal(timeOfDay(23 * 60, starts), 'night');
});

test('ungültige Grenzen fallen auf die Werte ab Werk zurück', () => {
  assert.deepEqual(normalizeTimeOfDayStarts({ day: 7, evening: 18, night: 23 }), { day: 7, evening: 18, night: 23 });
  assert.equal(normalizeTimeOfDayStarts({ day: 18, evening: 7, night: 23 }), TIME_OF_DAY_START);
  assert.equal(normalizeTimeOfDayStarts({ day: 5, evening: 17, night: 24 }), TIME_OF_DAY_START);
  assert.equal(normalizeTimeOfDayStarts({ day: 5.5, evening: 17, night: 22 }), TIME_OF_DAY_START);
  assert.equal(normalizeTimeOfDayStarts(undefined), TIME_OF_DAY_START);
});

test('das Abo trägt eigene Grenzen nur, wenn sie zählen', () => {
  const starts = { day: 7, evening: 18, night: 23 };
  const params = feedSearchParams('muenchen', { timesOfDay: ['night'], timeOfDayStarts: starts });
  assert.equal(params.get('hours'), '7,18,23');
  assert.deepEqual(parseFeedFilter(params).timeOfDayStarts, starts);
  assert.equal(feedSearchParams('muenchen', { timesOfDay: ['night'], timeOfDayStarts: TIME_OF_DAY_START }).get('hours'), null);
  assert.equal(feedSearchParams('muenchen', { timeOfDayStarts: starts }).get('hours'), null);
});
