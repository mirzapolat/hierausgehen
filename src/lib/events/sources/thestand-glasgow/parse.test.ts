import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { monthUrl, parseDetailDescription, parseMonth, showKey } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 4.9.2026 geholt. Die Website zählt im Oktober 2026
 * 38 Abende, im August 2026 (vergangen, „Show archive") 35, und für August
 * 2027 schreibt sie „No performances listed".
 */
const october = () => parseMonth(fixture('liste-2026-10.html'));
const august = () => parseMonth(fixture('liste-2026-08-archiv.html'));

test('liest alle Abende des angefragten Monats', () => {
  const parsed = october();
  assert.equal(parsed.recognised, true);
  assert.equal(parsed.empty, false);
  assert.equal(parsed.events.length, 38);
});

test('nimmt nur das Raster des angefragten Monats', () => {
  const outside = october().events.filter((event) => !event.start.startsWith('2026-10'));
  assert.deepEqual(outside, [], 'Folgemonate stehen als "supplemental" auf derselben Seite');

  // Der leere Monat ist der Beweis: dort steht ausser einer Karte des
  // Folgemonats nichts auf der Seite.
  const empty = parseMonth(fixture('liste-2027-08-leer.html'));
  assert.equal(empty.recognised, true);
  assert.equal(empty.empty, true, 'die Quelle sagt es selbst: "No performances listed"');
  assert.deepEqual(empty.events, []);
});

test('normalisiert einen Abend vollständig', () => {
  const event = october().events[0];
  assert.deepEqual(event, {
    id: 'thestand-glasgow:21324',
    sourceId: 'thestand-glasgow',
    title: 'Sandro Ford: Lager Than Life',
    subtitle: undefined,
    start: '2026-10-01T20:00:00+01:00',
    end: '2026-10-01T21:40:00+01:00',
    allDay: false,
    venue: { name: 'The Stand Comedy Club Glasgow' },
    availability: 'soldout',
    availabilityLabel: 'Sold Out',
    url: 'https://www.thestand.co.uk/performance/21324/sandro-ford-lager-than-life/20261001/glasgow',
    notes: ['Doors: 19:00', 'Duration: 100 mins'],
  });
});

test('führt die auftretenden Comedians als Untertitel', () => {
  const mixed = august().events.find((event) => event.title === 'The Early Saturday Show');
  assert.equal(mixed?.subtitle, 'Kim Blythe, Kate Hammer, Weegie Hink Ae That');
});

test('rechnet Ende und Sommerzeit über die Zeitzone', () => {
  const events = october().events;
  // In der Nacht zum 25.10.2026 wird zurückgestellt – davor +01:00, danach Z.
  const before = events.find((event) => event.start.startsWith('2026-10-24T20'));
  const after = events.find((event) => event.start.startsWith('2026-10-26T20'));
  assert.equal(before?.start, '2026-10-24T20:00:00+01:00');
  assert.equal(after?.start, '2026-10-26T20:00:00+00:00');
  assert.equal(
    events.every((event) => event.end && event.end > event.start),
    true,
    'die Spieldauer der Karte ergibt das Ende',
  );
});

test('unterscheidet Ticketlage, Ausverkauft und Archiv', () => {
  const upcoming = october().events;
  const counted = (events: typeof upcoming) =>
    events.reduce<Record<string, number>>((acc, event) => {
      acc[event.availability] = (acc[event.availability] ?? 0) + 1;
      return acc;
    }, {});

  assert.deepEqual(counted(upcoming), { soldout: 2, available: 36 });
  // Ein gespielter Abend trägt "Show archive" – die Quelle sagt zur
  // Ticketlage dann nichts mehr, und der Adapter erfindet nichts dazu.
  assert.deepEqual(counted(august().events), { unknown: 35 });
});

test('vergibt eindeutige IDs je Vorstellung', () => {
  const ids = october().events.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    ids.every((id) => /^thestand-glasgow:\d+$/.test(id)),
    true,
  );
});

test('entdoppelt den Programmtext über das Stück, nicht den Abend', () => {
  const events = october().events;
  const keys = new Set(events.map((event) => showKey(event.url)));
  assert.equal(keys.size, 21, '38 Abende, aber nur 21 Stücke – so viele Detailabrufe');
  assert.equal(
    showKey('https://www.thestand.co.uk/performance/21389/phil-ellis-bath-mat/20260905/glasgow'),
    'phil-ellis-bath-mat',
  );
  assert.equal(showKey('https://www.thestand.co.uk/whats-on/glasgow'), undefined);
});

test('liest den Ankündigungstext der Vorstellungsseite', () => {
  const description = parseDetailDescription(fixture('detail-phil-ellis.html'));
  assert.match(description ?? '', /^Multi-award winning 'comic genius'/);
  assert.match(description ?? '', /Bath Mat/);
  assert.equal(description?.includes('<'), false, 'ohne Auszeichnungen');
});

test('baut die Monatsadresse', () => {
  assert.equal(monthUrl('2026-10'), 'https://www.thestand.co.uk/whats-on/glasgow/october/2026');
  assert.equal(monthUrl('2027-01'), 'https://www.thestand.co.uk/whats-on/glasgow/january/2027');
});

test('meldet leeres und kaputtes HTML als nicht erkannt', () => {
  for (const html of ['', '<html><body>Wartung</body></html>', '<div class="new-start-card">']) {
    const parsed = parseMonth(html);
    assert.equal(parsed.recognised, false);
    assert.deepEqual(parsed.events, []);
  }
  assert.equal(parseDetailDescription('<html></html>'), undefined);
});
