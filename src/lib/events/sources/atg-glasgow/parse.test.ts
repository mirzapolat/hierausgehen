import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type ShowCard,
  overlapsRange,
  parseListPage,
  parsePerformances,
  parseRun,
  parseSeasonPage,
  parseShowDetail,
} from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 4.9.2026 geholt: die Übersicht meldet 101 Stücke auf
 * 5 Seiten (4 × 24 + 5), Seite 6 gibt es nicht mehr und antwortet mit einer
 * leeren Trefferliste. „Six" spielt achtmal, „Aladdin" siebzigmal, „Alan Carr"
 * ist ausverkauft.
 */
const page1 = () => parseListPage(fixture('liste-seite-1.html'));
const page5 = () => parseListPage(fixture('liste-seite-5.html'));

/** Die Stücke, deren Termindatei als Fixture vorliegt. */
const six = () => page1().shows.find((show) => show.titleSlug === 'six')!;
const card = (over: Partial<ShowCard>): ShowCard => ({ ...six(), ...over });

test('liest die Trefferliste und die Blätterung', () => {
  const first = page1();
  assert.equal(first.recognised, true);
  assert.equal(first.pageCount, 5);
  assert.equal(first.found, 101);
  assert.equal(first.shows.length, 24);

  const last = page5();
  assert.equal(last.pageCount, 5);
  assert.equal(last.shows.length, 5);
});

test('eine leere Trefferliste ist gültig, kein Ausfall', () => {
  // Seite 6 von 5: die Seitenhülle steht, `"cards":[]` ist leer.
  const beyond = parseListPage(fixture('liste-seite-6-leer.html'));
  assert.equal(beyond.recognised, true);
  assert.equal(beyond.shows.length, 0);
  assert.equal(beyond.pageCount, 5);
});

test('leeres und kaputtes HTML meldet sich als unerkannt', () => {
  for (const html of ['', '<html><body>Wartungsarbeiten</body></html>', '<script>self.__next_f.push([1,"kaputt'])
    assert.equal(parseListPage(html).recognised, false, html.slice(0, 20));
});

test('liest eine Karte vollständig', () => {
  const show = page1().shows.find((s) => s.title === 'High Society');
  assert.ok(show);
  assert.equal(show.titleSlug, 'high-society');
  assert.equal(show.venueSlug, 'kings-theatre-glasgow');
  assert.equal(show.venue, "King's Theatre, Glasgow");
  assert.deepEqual(show.genre, ['Musicals']);
  assert.equal(show.url, 'https://www.atgtickets.com/shows/high-society/kings-theatre-glasgow/');
});

test('übersetzt alle vier Formen der Laufzeit', () => {
  assert.deepEqual(parseRun('Fri 4 Sep 2026'), { runFrom: '2026-09-04', runTo: '2026-09-04' });
  // Das Jahr steht nur rechts und gilt für beide Ränder.
  assert.deepEqual(parseRun('Tue 8 Sep - Sat 19 Sep 2026'), {
    runFrom: '2026-09-08',
    runTo: '2026-09-19',
  });
  assert.deepEqual(parseRun('Sat 21 Nov 2026 - Sun 3 Jan 2027'), {
    runFrom: '2026-11-21',
    runTo: '2027-01-03',
  });
  // Ein laufendes Stück: der Beginn liegt vor dem Abruf und fehlt deshalb.
  assert.deepEqual(parseRun('Until Sat 5 Sep 2026'), { runTo: '2026-09-05' });
  assert.deepEqual(parseRun(''), {});
});

test('jede Karte der Übersicht trägt eine lesbare Laufzeit', () => {
  const shows = [...page1().shows, ...page5().shows];
  const ohne = shows.filter((show) => !show.runFrom && !show.runTo);
  assert.deepEqual(ohne, [], 'keine Karte ohne erkannte Laufzeit');
});

test('lässt nur Stücke durch, die in den Zeitraum ragen', () => {
  const lauf = card({ runFrom: '2026-11-21', runTo: '2027-01-03' });
  assert.equal(overlapsRange(lauf, '2026-12-01', '2026-12-31'), true);
  assert.equal(overlapsRange(lauf, '2027-02-01', '2027-02-28'), false);
  assert.equal(overlapsRange(lauf, '2026-10-01', '2026-10-31'), false);
  // Ohne lesbare Laufzeit wird nachgefragt statt ausgelassen.
  assert.equal(overlapsRange(card({ runFrom: undefined, runTo: undefined }), '2030-01-01', '2030-01-31'), true);
});

test('normalisiert einen Termin vollständig', () => {
  const events = parsePerformances(fixture('termine-six.json'), six());
  assert.equal(events.length, 8);

  const event = events[0];
  assert.equal(event.id, 'atg-glasgow:FC821EE3-A4DE-4248-834A-696A57DB78C2');
  assert.equal(event.sourceId, 'atg-glasgow');
  assert.equal(event.title, 'Six');
  assert.equal(event.category, 'Musicals / Family');
  assert.equal(event.allDay, false);
  assert.equal(event.end, undefined, 'der Kalenderdienst nennt keine Endzeit');
  assert.equal(event.venue.name, 'Theatre Royal Glasgow');
  assert.equal(event.venue.city, undefined);
  assert.equal(
    event.ticketUrl,
    'https://www.atgtickets.com/shows/six/theatre-royal-glasgow/tickets/FC821EE3-A4DE-4248-834A-696A57DB78C2',
  );
  assert.equal(event.url, 'https://www.atgtickets.com/shows/six/theatre-royal-glasgow/');
  assert.deepEqual(event.notes, ['Tickets from £145.00']);
});

test('rechnet UTC in Ortszeit um, über die Zeitumstellung hinweg', () => {
  // "2026-09-29T19:00:00.000Z" ist Sommerzeit – die Produktionsseite sagt
  // dazu "Tue and Thu at 20:00".
  const sommer = parsePerformances(fixture('termine-six.json'), six());
  assert.equal(sommer[0].start, '2026-09-29T20:00:00+01:00');
  assert.equal(sommer[6].start, '2026-10-03T16:00:00+01:00');

  // Aladdin spielt von November bis Januar, also durchgehend in Winterzeit.
  const winter = parsePerformances(fixture('termine-aladdin.json'), aladdin());
  assert.equal(winter[0].start, '2026-11-21T14:00:00+00:00');
  assert.equal(winter.at(-1)!.start, '2027-01-03T17:00:00+00:00');
});

test('holt auch lange Läufe vollständig', () => {
  // Die Produktionsseite trägt nur die nächsten neun Vorstellungen im HTML;
  // der Kalenderdienst kennt alle siebzig.
  const events = parsePerformances(fixture('termine-aladdin.json'), aladdin());
  assert.equal(events.length, 70);
  assert.equal(new Set(events.map((e) => e.id)).size, 70, 'IDs sind eindeutig');
});

test('unterscheidet die Ticketlage', () => {
  const verteilung = (events: { availability: string }[]) => {
    const zaehler: Record<string, number> = {};
    for (const event of events) zaehler[event.availability] = (zaehler[event.availability] ?? 0) + 1;
    return zaehler;
  };

  assert.deepEqual(verteilung(parsePerformances(fixture('termine-six.json'), six())), {
    soldout: 6,
    limited: 2,
  });
  // "MEDIUM" ist kein Restkartenzustand, sondern der normale Fall.
  assert.deepEqual(verteilung(parsePerformances(fixture('termine-aladdin.json'), aladdin())), {
    available: 70,
  });

  const carr = parsePerformances(
    fixture('termine-alan-carr-ausverkauft.json'),
    card({ titleSlug: 'alan-carr-have-i-said-too-much' }),
  );
  assert.deepEqual(verteilung(carr), { soldout: 3 });
  assert.equal(carr[0].availabilityLabel, 'Sold out');
});

test('ein Stück ohne Termine ist ein Fehler, keine leere Liste', () => {
  assert.throws(
    () => parsePerformances(fixture('termine-unbekannt.json'), six()),
    /Kalenderdienst ohne Termine/,
  );
  assert.throws(() => parsePerformances('<html>503</html>', six()), /kein JSON/);
});

test('löst eine Sammelkarte in ihre Produktionen auf', () => {
  const serie = parseSeasonPage(fixture('saison-scottish-ballet-emergence.html'));
  assert.deepEqual(serie, [
    {
      title: 'Scottish Ballet - Emergence',
      venue: 'Theatre Royal Glasgow',
      titleSlug: 'scottish-ballet-emergence',
      venueSlug: 'theatre-royal-glasgow',
      runLabel: 'Thu 10 Sep - Sat 12 Sep 2026',
    },
    {
      title: 'Scottish Ballet - Emergence: Talk Ballet',
      venue: 'Theatre Royal Glasgow',
      titleSlug: 'scottish-ballet-emergence-talk-ballet',
      venueSlug: 'theatre-royal-glasgow',
      runLabel: 'Fri 11 Sep 2026',
    },
  ]);
  assert.deepEqual(parseSeasonPage('<html></html>'), []);
});

test('liest Programmtext und Spieldauer von der Produktionsseite', () => {
  const detail = parseShowDetail(fixture('detail-six.html'));
  assert.ok(detail);
  assert.match(detail.description ?? '', /^Winner of over 35 international awards/);
  assert.match(detail.description ?? '', /girl power/);
  assert.equal(detail.description?.includes('<'), false, 'ohne Auszeichnungen');
  assert.deepEqual(detail.notes, ['Duration: 1 hour 20 minutes']);
  assert.equal(parseShowDetail('<html></html>'), undefined);
});

const aladdin = () =>
  card({
    title: 'Aladdin (Pantomime)',
    titleSlug: 'aladdin-pantomime',
    venueSlug: 'kings-theatre-glasgow',
    venue: "King's Theatre, Glasgow",
    genre: ['Pantomime'],
    url: 'https://www.atgtickets.com/shows/aladdin-pantomime/kings-theatre-glasgow/',
  });
