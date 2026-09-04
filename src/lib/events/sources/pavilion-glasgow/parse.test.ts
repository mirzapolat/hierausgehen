import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type ShowCard,
  announcedEvent,
  lastDayOf,
  overlapsRange,
  parseDescription,
  parseListPage,
  parsePerformances,
} from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 4.9.2026 geholt. Die Übersicht führte 109 Stücke –
 * drei ausverkauft, dreizehn „Selling Fast", eines „On sale soon" –, die
 * Weihnachtspantomime 68 Vorstellungen.
 */
const list = () => parseListPage(fixture('liste-whats-on.html'));
const show = (title: string): ShowCard => {
  const found = list().shows.find((entry) => entry.title.startsWith(title));
  assert.ok(found, `Stück "${title}" steht nicht in der Übersicht`);
  return found;
};

test('liest alle Stücke der Übersicht', () => {
  const parsed = list();
  assert.equal(parsed.recognised, true);
  // "Load more" blendet nur ein, was längst im HTML steht: ein Abruf reicht.
  assert.equal(parsed.shows.length, 109);
  assert.equal(new Set(parsed.shows.map((entry) => entry.id)).size, 109);
});

test('legt Anzeigekarte und Stammdaten zusammen', () => {
  assert.deepEqual(show('The Journey Back'), {
    id: '31884',
    title: 'The Journey Back',
    categories: ['Play'],
    promoter: 'Stuart Hay Productions Ltd',
    venue: 'The Pavilion Theatre',
    subVenue: 'Main Auditorium',
    minPrice: 15,
    url: 'https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB/event/play/the-journey-back-tickets',
    runLabel: 'Fri 4 - Sat 5 Sep 2026',
    runFrom: '2026-09-04',
    runTo: '2026-09-05',
    firstStart: '2026-09-04T18:30:00.000Z',
    allSoldOut: false,
    fewLeft: true,
    onSaleSoon: false,
  });
});

test('kennt zu jedem Stück eine Laufzeit', () => {
  const shows = list().shows;
  assert.equal(shows.filter((entry) => !entry.runFrom || !entry.runTo).length, 0);
  assert.equal(shows.filter((entry) => entry.allSoldOut).length, 3);
  assert.equal(shows.filter((entry) => entry.fewLeft).length, 13);
  assert.equal(shows.filter((entry) => entry.onSaleSoon).length, 1);
});

test('liest den rechten Rand der Laufzeit-Beschriftung', () => {
  // Links steht nicht immer ein Monat ("Fri 4 - Sat 5 Sep 2026") – der linke
  // Rand kommt deshalb aus `startDate`, der rechte aus der Beschriftung.
  assert.equal(lastDayOf('Fri 4 -\n Sat 5 Sep 2026'), '2026-09-05');
  assert.equal(lastDayOf('Mon 12 Oct 2026'), '2026-10-12');
  assert.equal(lastDayOf('Thu 26 Nov 2026 -\n Sun 10 Jan 2027'), '2027-01-10');
  assert.equal(lastDayOf('demnächst'), undefined);

  const panto = show('Goldilocks');
  assert.equal(panto.runFrom, '2026-11-26');
  assert.equal(panto.runTo, '2027-01-10');
  assert.equal(overlapsRange(panto, '2026-12-01', '2026-12-31'), true);
  assert.equal(overlapsRange(panto, '2026-09-01', '2026-09-30'), false);
});

test('macht aus einem Lauf alle Abende', () => {
  const events = parsePerformances(fixture('detail-goldilocks-lauf.html'), show('Goldilocks'));
  // Die Karte nennt nur "Thu 26 Nov 2026 - Sun 10 Jan 2027"; die Abende
  // stehen einzeln im schema.org-Block.
  assert.equal(events.length, 68);
  assert.equal(new Set(events.map((event) => event.id)).size, 68);
  assert.equal(
    events.every((event) => /^pavilion-glasgow:\d+$/.test(event.id)),
    true,
  );
  assert.equal(events[0].start, '2026-11-26T19:00:00+00:00');
  assert.equal(events.at(-1)?.start, '2027-01-10T17:00:00+00:00');
});

test('normalisiert einen Abend vollständig', () => {
  const event = parsePerformances(
    fixture('detail-jonathan-pie-ausverkauft.html'),
    show('Jonathan Pie'),
  )[0];

  assert.deepEqual(
    { ...event, description: undefined },
    {
      id: 'pavilion-glasgow:65351',
      sourceId: 'pavilion-glasgow',
      title: 'Jonathan Pie',
      description: undefined,
      category: 'Comedy',
      start: '2026-11-07T19:30:00+00:00',
      allDay: false,
      venue: { name: 'The Pavilion Theatre – Main Auditorium' },
      availability: 'soldout',
      availabilityLabel: 'Sold out',
      ticketUrl:
        'https://booking.trafalgartickets.com/en/pavilion-theatre-glasgow/buyingflow/tickets/32449/65351/',
      url: 'https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB/event/comedy/jonathan-pie-tickets',
      notes: ['Tickets from £26.00', 'Presented by Phil McIntyre Live Ltd'],
    },
  );
  assert.ok((event.description?.length ?? 0) > 200, 'der lange Text hängt am Termin');
});

test('rechnet die Zeitpunkte über die Zeitzone, nicht durch Abschneiden des Z', () => {
  // Die Quelle meldet 19:00Z; im Mai gilt Sommerzeit, die Kasse schreibt
  // "08:00 PM".
  const event = parsePerformances(fixture('detail-dylan-moran.html'), show('Dylan Moran'))[0];
  assert.equal(event.start, '2027-05-16T20:00:00+01:00');

  // Derselbe Lauf über die Umstellung hinweg: der Winterabend bleibt bei Z.
  const winter = parsePerformances(fixture('detail-goldilocks-lauf.html'), show('Goldilocks'));
  assert.equal(
    winter.every((performance) => performance.start.endsWith('+00:00')),
    true,
    'die Pantomime läuft ganz in der Winterzeit',
  );
});

test('unterscheidet die Ticketlagen', () => {
  const soldOut = parsePerformances(
    fixture('detail-jonathan-pie-ausverkauft.html'),
    show('Jonathan Pie'),
  );
  assert.deepEqual(
    soldOut.map((event) => event.availability),
    ['soldout'],
  );

  const panto = parsePerformances(fixture('detail-goldilocks-lauf.html'), show('Goldilocks'));
  assert.deepEqual(new Set(panto.map((event) => event.availability)), new Set(['available']));

  // "Selling Fast" hängt am Stück. Bei einem Abend meint es diesen einen …
  const single = parsePerformances(fixture('detail-dylan-moran.html'), {
    ...show('Dylan Moran'),
    fewLeft: true,
  });
  assert.equal(single[0].availability, 'limited');
  assert.equal(single[0].availabilityLabel, 'Selling fast');
  // … bei achtundsechzig Abenden sagt es über den einzelnen nichts.
  const many = parsePerformances(fixture('detail-goldilocks-lauf.html'), {
    ...show('Goldilocks'),
    fewLeft: true,
  });
  assert.deepEqual(new Set(many.map((event) => event.availability)), new Set(['available']));
});

test('liest jede Gattung, nicht nur TheaterEvent', () => {
  // Der schema.org-Block heisst nach der Gattung. Solange nur "TheaterEvent"
  // galt, fehlten sieben von zweiundzwanzig Septemberterminen.
  const music = parsePerformances(fixture('detail-katzeye-vorverkauf.html'), show('Katzeye'));
  assert.equal(music.length, 1, 'die Seite führt einen MusicEvent-Block');
  assert.equal(music[0].category, 'Music');
  assert.equal(
    music[0].ticketUrl,
    'https://booking.trafalgartickets.com/en/pavilion-theatre-glasgow/buyingflow/tickets/34824/70934/',
  );
});

test('meldet ein Stück vor dem Vorverkauf als noch nicht buchbar', () => {
  const katzeye = show('Katzeye');
  assert.equal(katzeye.onSaleSoon, true);

  // Das Angebot steht schon auf der Seite und meldet `InStock`, verkauft wird
  // aber erst ab dem 11.9. – die Karte weiss es besser als das Angebot.
  const event = parsePerformances(fixture('detail-katzeye-vorverkauf.html'), katzeye)[0];
  assert.equal(event.availability, 'not_on_sale');
  assert.equal(event.availabilityLabel, 'On sale soon');
});

test('baut aus der Karte einen Termin, wenn die Seite gar keinen Block trägt', () => {
  // Der Rückfall für eine Produktionsseite ohne schema.org-Block: den Abend
  // kennt die Übersicht, verlorengehen soll er nicht.
  const announced = announcedEvent(show('Katzeye'));
  assert.equal(announced?.id, 'pavilion-glasgow:group-34824');
  assert.equal(announced?.start, '2027-04-01T19:00:00+01:00');
  assert.equal(announced?.availability, 'not_on_sale');
  assert.equal(announced?.category, 'Music');
  assert.equal(announced?.ticketUrl, undefined);
});

test('liest den langen Ankündigungstext, nicht den SEO-Einzeiler', () => {
  const long = parseDescription(fixture('detail-goldilocks-lauf.html'));
  assert.match(long ?? '', /^Bringing Glasgow together once again/);
  assert.ok((long?.length ?? 0) > 1000);
  assert.equal(long?.includes('Book your tickets to'), false);
  assert.equal(long?.includes('<'), false, 'ohne Auszeichnungen');
});

test('führt die Gattungen im Wortlaut der Quelle', () => {
  const counted = list().shows.reduce<Record<string, number>>((acc, entry) => {
    const key = entry.categories.join(' / ') || '(ohne)';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counted, {
    Music: 42,
    Comedy: 30,
    Other: 17,
    Play: 13,
    Musical: 3,
    Dance: 2,
    Family: 1,
    Pantomime: 1,
  });
});

test('meldet leeres und kaputtes HTML als nicht erkannt', () => {
  for (const html of ['', '<html><body>Wartung</body></html>', '<script>self.__next_f=[]</script>']) {
    const parsed = parseListPage(html);
    assert.equal(parsed.recognised, false);
    assert.deepEqual(parsed.shows, []);
  }
  assert.deepEqual(parsePerformances('<html></html>', show('Dylan Moran')), []);
  assert.equal(parseDescription('<html></html>'), undefined);
});
