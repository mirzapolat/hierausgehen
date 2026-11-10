import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEventsPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/** Abgerufen am 8.11.2026: alle kommenden Termine auf einer Seite. */
const page = () => parseEventsPage(fixture('events-ab-2026-11.html'));

test('liest alle angekündigten Termine aus den Warmup-Daten', () => {
  const { events, skipped, empty, hasMore } = page();
  assert.equal(events.length, 5);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  assert.equal(hasMore, false);
  assert.deepEqual(
    events.map((event) => event.start),
    [
      '2026-11-12T19:00:00+01:00',
      '2026-11-20T19:00:00+01:00',
      '2026-11-26T20:00:00+01:00',
      '2026-12-07T18:00:00+01:00',
      '2026-12-12T18:00:00+01:00',
    ],
  );
});

test('bildet einen Termin vollständig ab', () => {
  const event = page().events.find((e) => e.id.endsWith('cb21bdcf-cebc-4b29-9668-7e59e32a7544'));
  assert.deepEqual(event, {
    id: 'friends-studios:cb21bdcf-cebc-4b29-9668-7e59e32a7544',
    sourceId: 'friends-studios',
    title: 'The View - X-Mas',
    description:
      'THE VIEW\n+ ROOF TOP 6 PM - 2 AM\n+ HOUSE + TECH HOUSE\n\nDRESSCODE: ALL BLACK or X-MAS OUTFIT',
    start: '2026-12-12T18:00:00+01:00',
    end: '2026-12-13T02:00:00+01:00',
    allDay: false,
    venue: { name: 'Aahhh - Rooftop', city: 'München' },
    availability: 'available',
    ticketUrl: 'https://www.friends-studios.com/event-details/the-view-x-mas',
    url: 'https://www.friends-studios.com/event-details/the-view-x-mas',
    notes: ['Preise: €8.20 – €10.25'],
  });
});

test('erkennt die Ticketlage und eindeutige IDs', () => {
  const { events } = page();
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.availability] = (counts[event.availability] ?? 0) + 1;
  assert.deepEqual(counts, { soldout: 3, available: 2 });
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  const lab = events.find((e) => e.url.endsWith('the-lab-2026-12-07-18-00'));
  assert.equal(lab?.availabilityLabel, 'Ausverkauft');
  assert.equal(lab?.ticketUrl, undefined);
  assert.deepEqual(lab?.notes, ['Preis: €0']);
});

test('leere Widget-Liste ist leer, nicht kaputt', () => {
  const html =
    '<script type="application/json" id="wix-warmup-data">' +
    '{"appsWarmupData":{"app":{"widget":{"events":{"events":[],"hasMore":false}}}}}</script>';
  const result = parseEventsPage(html);
  assert.equal(result.events.length, 0);
  assert.equal(result.empty, true);
});

test('Seite ohne Warmup-Daten wird nicht erkannt', () => {
  for (const html of ['', '<html><body>nichts</body></html>', '<script id="wix-warmup-data">{kaputt</script>']) {
    const result = parseEventsPage(html);
    assert.equal(result.events.length, 0);
    assert.equal(result.empty, false);
  }
});
