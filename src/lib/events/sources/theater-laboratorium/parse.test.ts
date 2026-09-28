import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseMonth, parseOfferedMonths } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const dezember = () => parseMonth(fixture('kalender-2026-12.html'), '2026-12');

test('liest einen vollen Monat über beide Spielorte', () => {
  const { events, skipped, empty } = dezember();
  assert.equal(events.length, 40);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  const orte = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.venue.name] = (acc[e.venue.name] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(orte, { 'Theater Laboratorium': 23, Limonadenfabrik: 17 });
});

test('normalisiert eine Vorstellung vollständig', () => {
  const krimi = dezember().events.find((e) => e.id === 'theater-laboratorium:1399');
  assert.ok(krimi);
  assert.equal(krimi.title, 'Ein tödliches Geheimnis');
  assert.equal(krimi.subtitle, 'Eine Krimikomödie');
  assert.equal(krimi.category, 'Theater');
  assert.equal(krimi.start, '2026-12-04T20:00:00+01:00');
  assert.equal(krimi.allDay, false);
  assert.deepEqual(krimi.venue, { name: 'Theater Laboratorium' });
  assert.equal(krimi.availability, 'available');
  assert.equal(
    krimi.ticketUrl,
    'https://theater-laboratorium.eventim-inhouse.de/webshop/webticket/shop?event=1399',
  );
  assert.equal(
    krimi.url,
    'https://www.theater-laboratorium.org/index.php?r=visitorrepertoire%2Fentry&progtitle_id=77',
  );
});

test('ohne Stückseite verweist der Termin auf den Monat', () => {
  const konzert = dezember().events.find((e) => e.id === 'theater-laboratorium:1449');
  assert.equal(konzert!.venue.name, 'Limonadenfabrik');
  assert.equal(konzert!.url, 'https://www.theater-laboratorium.org/index.php?r=site%2Fcalender&month_id=12');
});

test('vergibt eindeutige IDs', () => {
  const { events } = dezember();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.ok(events.every((e) => e.start.startsWith('2026-12-')));
});

test('ein Monat ohne Vorstellung ist leer, kein Fehler', () => {
  const html = fixture('kalender-leer-2026-09.html');
  assert.deepEqual(parseMonth(html, '2026-09'), { events: [], skipped: 0, empty: true });
  assert.deepEqual(parseOfferedMonths(html), [10, 11, 12, 1]);
});

test('leeres oder fremdes HTML wird nicht als leerer Monat gemeldet', () => {
  assert.deepEqual(parseMonth('', '2026-12'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseMonth('<html><body>Fehler</body></html>', '2026-12'), {
    events: [],
    skipped: 0,
    empty: false,
  });
  assert.deepEqual(parseOfferedMonths(''), []);
});

test('liest den Programmtext ohne Besetzung und Produktion', () => {
  const text = parseDetailDescription(fixture('stueck-toedliches-geheimnis.html'))!;
  assert.match(text, /^Ein wohliges Kaminzimmer/);
  assert.match(text, /Dauer: 90 min \+ 30 min Pause/);
  assert.ok(!text.includes('Regie'), 'der Abspann gehört nicht zum Text');
  assert.equal(parseDetailDescription('<html></html>'), undefined);
});
