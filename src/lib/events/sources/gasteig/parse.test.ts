import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CalendarEvent } from '../../types.ts';
import { applyEnrichment, parseTeaserFragment, parseUpcomingFeed } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const isarphilharmonie = () => parseTeaserFragment(fixture('teasers-isarphilharmonie-2026-11.html'));
const musikTanz = () => parseTeaserFragment(fixture('teasers-musik-tanz-2026-11.html'));
const feed = () => parseUpcomingFeed(fixture('upcoming-2026-11.json'));

/** Der Monat so, wie der Adapter ihn zusammensetzt: beide Filtersätze plus Feed. */
function november(): CalendarEvent[] {
  const united = new Map<string, CalendarEvent>();
  for (const event of [...isarphilharmonie().events, ...musikTanz().events]) {
    united.set(event.id, event);
  }
  return applyEnrichment([...united.values()], feed());
}

const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[key(item)] = (acc[key(item)] ?? 0) + 1;
    return acc;
  }, {});

test('liest jeden Teaser des Monats genau einmal', () => {
  const isar = isarphilharmonie();
  assert.equal(isar.blocks, 29);
  assert.equal(isar.events.length, 29);
  assert.equal(isar.skipped, 0);
  assert.equal(isar.excluded, 0);
  assert.equal(isar.empty, false);

  const events = november();
  // 29 Isarphilharmonie + 40 aus Musik/Tanz, davon 28 doppelt.
  assert.equal(events.length, 41);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test('laesst kreativ und kinder-jugend weg', () => {
  const { blocks, events, excluded } = musikTanz();

  assert.equal(blocks, 50);
  assert.equal(events.length, 40);
  assert.equal(excluded, 10);

  // "Beats & Recording Lab" (kreativ) und "Matze taucht ab" (kinder-jugend).
  const ids = new Set(events.map((event) => event.id));
  assert.equal(ids.has('gasteig:189555'), false);
  assert.equal(ids.has('gasteig:165949'), false);
});

test('normalisiert einen Termin vollstaendig', () => {
  const langLang = november().find((event) => event.id === 'gasteig:182195');

  assert.ok(langLang, 'Klavierabend von Lang Lang gefunden');
  assert.equal(langLang.title, 'Lang Lang');
  assert.equal(langLang.subtitle, 'Klavierabend');
  assert.equal(langLang.category, 'Musik');
  assert.equal(langLang.start, '2026-11-01T20:00:00+01:00');
  assert.equal(langLang.end, '2026-11-01T22:15:00+01:00');
  assert.equal(langLang.allDay, false);
  assert.equal(langLang.venue.name, 'Isarphilharmonie, Gasteig HP8');
  assert.equal(langLang.venue.city, undefined);
  assert.equal(langLang.availability, 'available');
  assert.equal(langLang.ticketUrl, 'https://www.muenchenticket.de/event/lang-lang-37535/');
  assert.equal(langLang.url, 'https://www.gasteig.de/veranstaltungen/recital-lang-lang/');
  assert.match(langLang.description ?? '', /^Lang Lang, ein Weltstar am Klavier\./);
  assert.deepEqual(langLang.notes, ['Klassik', 'Preis ab 74,30 €', 'Veranstaltet von MünchenMusik']);
});

test('bildet die Ticketlage aus dem Angebot des Feeds ab', () => {
  const events = november();

  assert.deepEqual(countBy(events, (event) => event.availability), {
    available: 38,
    unknown: 3,
  });

  // Ohne Angebot im Feed gibt es weder Lage noch Ticketlink – nichts erfinden.
  const ohneAngebot = events.filter((event) => event.availability === 'unknown');
  assert.deepEqual(
    ohneAngebot.map((event) => event.ticketUrl),
    [undefined, undefined, undefined],
  );
});

test('nimmt als Ticketlink nur den fremden Shop', () => {
  const events = november();
  const shops = new Set(
    events
      .map((event) => event.ticketUrl)
      .filter((url): url is string => Boolean(url))
      .map((url) => new URL(url).host),
  );

  assert.equal(shops.has('www.gasteig.de'), false);
  assert.equal(shops.has('www.muenchenticket.de'), true);
});

test('setzt Saal und Haus als Spielstaette zusammen', () => {
  assert.deepEqual(countBy(november(), (event) => event.venue.name), {
    'Isarphilharmonie, Gasteig HP8': 29,
    'Saal X, Gasteig HP8': 8,
    'Halle E, Gasteig HP8': 2,
    'Kleiner Saal, Gasteig HP8': 1,
    'Gasteig Motorama': 1,
  });
});

test('haelt Programmtext, Genre und Preis auseinander', () => {
  const events = november();

  // Der Feed deckt den ganzen Monat ab – Kurztext hat jeder Termin.
  assert.equal(events.filter((event) => !event.description).length, 0);

  const gratis = events.find((event) => event.id === 'gasteig:185825');
  assert.equal(gratis?.notes?.includes('Eintritt frei'), true);
  assert.equal(gratis?.notes?.some((note) => note.startsWith('Preis')), false);
});

test('uebernimmt eine Endzeit nur fuer denselben Abend', () => {
  const dauerformat = parseUpcomingFeed(
    JSON.stringify({
      events: [
        {
          url: 'https://www.gasteig.de/veranstaltungen/rallye/',
          startDate: '2026-11-02T10:00:00+01:00',
          endDate: '2027-09-13T23:59:00+02:00',
        },
        {
          url: 'https://www.gasteig.de/veranstaltungen/konzert/',
          startDate: '2026-11-02T20:00:00+01:00',
          endDate: '2026-11-02T22:00:00+01:00',
        },
      ],
    }),
  );

  assert.equal(dauerformat.get('https://www.gasteig.de/veranstaltungen/rallye')?.end, undefined);
  assert.equal(
    dauerformat.get('https://www.gasteig.de/veranstaltungen/konzert')?.end,
    '2026-11-02T22:00:00+01:00',
  );
});

test('laesst Termine ohne Feed-Eintrag unveraendert', () => {
  const roh = musikTanz().events;
  const gleich = applyEnrichment(roh, new Map());

  assert.deepEqual(gleich, roh);
  assert.equal(gleich.every((event) => event.availability === 'unknown'), true);
  assert.equal(gleich.every((event) => event.description === undefined), true);
});

test('erkennt den leeren Monat an der leeren Antwort', () => {
  const leer = parseTeaserFragment(fixture('teasers-leer-2027-08.html'));

  assert.deepEqual(leer, { events: [], skipped: 0, excluded: 0, empty: true, blocks: 0 });
  assert.equal(parseUpcomingFeed(fixture('upcoming-leer-2027-08.json')).size, 0);
});

test('meldet Inhalt ohne Teaser als Layoutbruch', () => {
  const kaputt = parseTeaserFragment('<section><p>Die Seite konnte nicht geladen werden.</p></section>');

  assert.equal(kaputt.empty, false);
  assert.equal(kaputt.blocks, 0);
  assert.equal(kaputt.events.length, 0);
});

test('bleibt bei unbrauchbaren Antworten ruhig', () => {
  assert.deepEqual(parseTeaserFragment('   \n  '), {
    events: [],
    skipped: 0,
    excluded: 0,
    empty: true,
    blocks: 0,
  });
  assert.equal(parseUpcomingFeed('kein JSON').size, 0);
  assert.equal(parseUpcomingFeed('{"events":"nichts"}').size, 0);
});

test('nimmt bei mehreren Gattungen die einschlaegige', () => {
  // Die Seite führt "Star Wars in Concert" als `film,musik`.
  const { events } = parseTeaserFragment(fixture('teaser-film-und-musik-2027-01.html'));

  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Star Wars in Concert');
  assert.equal(events[0].category, 'Musik');
});
