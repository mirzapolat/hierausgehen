import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetail, parseListPage, parseTeaserFragment } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Geholt am 8.11.2026: `/veranstaltungen/?date_start=2026-11-01&date_end=2026-11-30`
 * meldet 108 Treffer und trägt die ersten 24; der Rest kommt in Schritten zu
 * 24 über `admin-ajax.php` (`more-2026-11-offset96` sind die letzten 12).
 */
const november = () => parseListPage(fixture('list-2026-11.html'));

test('Monatsseite: erste 24 Termine, Gesamtzahl und Nachlade-Schlüssel', () => {
  const page = november();
  assert.equal(page.empty, false);
  assert.equal(page.skipped, 0);
  assert.equal(page.events.length, 24);
  assert.equal(page.found, 108);
  assert.ok(page.hash && page.hash.length > 40);
});

test('IDs sind eindeutig', () => {
  const events = [
    ...november().events,
    ...parseTeaserFragment(fixture('more-2026-11-offset96.html')).events,
  ];
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
});

test('ein vollständiger Termin', () => {
  const event = november().events.find((e) => e.id === 'werksviertel-mitte:bjoern-von-morgenstern');
  assert.deepEqual(event, {
    id: 'werksviertel-mitte:bjoern-von-morgenstern',
    sourceId: 'werksviertel-mitte',
    title: 'Björn von Morgenstern',
    start: '2026-11-11T20:00:00+01:00',
    allDay: false,
    venue: { name: 'WERK7 theater' },
    availability: 'not_on_sale',
    availabilityLabel: 'Verlegt',
    url: 'https://www.werksviertel-mitte.de/veranstaltungen/bjoern-von-morgenstern/',
    category: 'Lesung & Vortrag',
  });
});

test('mehrtägig, Untertitel, ohne Schlagwort', () => {
  const event = november().events.find((e) => e.id === 'werksviertel-mitte:winterwunderwerk-2026');
  assert.ok(event);
  assert.equal(event.title, 'WinterWunderWERK 2026');
  assert.equal(event.subtitle, 'der Winterzauber im Werksviertel-Mitte');
  assert.equal(event.start, '2026-11-12T16:00:00+01:00');
  assert.equal(event.end, '2026-12-20T23:59:00+01:00');
  assert.equal(event.category, undefined);
  assert.equal(event.venue.name, 'Knödelplatz');
});

test('Gratis ist ein Hinweis, keine Art; mehrere Arten bleiben im Wortlaut', () => {
  const events = [
    ...november().events,
    ...parseTeaserFragment(fixture('more-2026-11-offset96.html')).events,
  ];
  const free = events.filter((e) => e.notes?.includes('Gratis'));
  assert.ok(free.length > 0);
  for (const event of free) assert.ok(!/gratis/i.test(event.category ?? ''));
  const labels = new Set(events.map((e) => e.category ?? '(keine)'));
  assert.ok(labels.has('Kunst & Kultur'));
  assert.ok(labels.has('Konzert'));
});

test('Nachlade-Fragment: Verschoben, Verteilung der Ticketlage', () => {
  const page = parseTeaserFragment(fixture('more-2026-11-offset96.html'));
  assert.equal(page.events.length, 12);
  assert.equal(page.skipped, 0);
  const marco = page.events.find((e) => e.id === 'werksviertel-mitte:marco-gianni');
  assert.equal(marco?.availability, 'not_on_sale');
  assert.equal(marco?.availabilityLabel, 'Verschoben');
  const states: Record<string, number> = {};
  for (const e of page.events) states[e.availability] = (states[e.availability] ?? 0) + 1;
  assert.deepEqual(states, { unknown: 11, not_on_sale: 1 });
});

test('Ende der Liste: leere Antwort', () => {
  const page = parseTeaserFragment(fixture('more-2026-12-offset87-end.html'));
  assert.deepEqual(page, { events: [], skipped: 0, empty: true });
});

test('leerer Zeitraum: Filterleiste ohne Liste', () => {
  const page = parseListPage(fixture('list-empty-2028-06.html'));
  assert.equal(page.events.length, 0);
  assert.equal(page.empty, true);
});

test('kaputtes HTML: nichts erkannt, nicht leer', () => {
  assert.equal(parseListPage('<html><body>Wartung</body></html>').empty, false);
  assert.equal(parseTeaserFragment('<p>Fehler</p>').empty, false);
  assert.equal(parseDetail('<html></html>'), undefined);
});

test('Detailseite: Text, Einlass, Preis, Veranstalter, Ticket', () => {
  const detail = parseDetail(fixture('detail-the-sheepdogs.html'));
  assert.ok(detail?.description?.startsWith('Präsentiert von Classic Rock'));
  assert.deepEqual(detail?.notes, [
    'Einlass: 19:00 Uhr',
    'Preis: 33.7€',
    'Veranstalter: target Concerts GmbH',
  ]);
  assert.equal(detail?.ticketUrl, 'https://www.eventim.de/event/the-sheepdogs-live-2026-technikum-20949617/');
  assert.equal(detail?.availability, 'available');
});

test('Detailseite verlegt: kein Ticketknopf', () => {
  const detail = parseDetail(fixture('detail-bjoern-von-morgenstern-verlegt.html'));
  assert.deepEqual(detail?.notes, ['Veranstalter: S-PROMOTION Event GmbH']);
  assert.equal(detail?.ticketUrl, undefined);
  assert.equal(detail?.availability, undefined);
});
