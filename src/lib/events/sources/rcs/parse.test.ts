import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attribute, buildEvents, parseEvents, parseInstances } from '../spektrix.ts';
import {
  type EventCard,
  LIST_URL,
  TIME_ZONE,
  idPrefix,
  parseDetail,
  parseEventList,
  titleKey,
} from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 4.9.2026 geholt: die Übersicht hat 5 Seiten mit 93
 * Karten (4 × 20 + 13), Spektrix führt dieselben 93 Produktionen und im
 * Oktober 2026 34 Vorstellungen. Januar 2020 liegt vor dem
 * Aufbewahrungsfenster und ist leer.
 */
const page1 = () => parseEventList(fixture('liste-seite-1.html'));
const page5 = () => parseEventList(fixture('liste-seite-5.html'));
const productions = () => parseEvents(fixture('events.json'));
const october = () => parseInstances(fixture('instances-2026-10.json'));

/** Wie `index.ts` Karten und Produktionen zusammenbringt. */
function matched(): Map<string, EventCard> {
  const cards = [...page1().cards, ...page5().cards];
  const productionOf = new Map<string, string>();
  for (const instance of october()) {
    const prefix = idPrefix(instance.id);
    if (prefix) productionOf.set(prefix, instance.eventId);
  }
  const byTitle = new Map(productions().map((event) => [titleKey(event.name), event.id]));
  const result = new Map<string, EventCard>();
  for (const card of cards) {
    const id =
      (card.bookingId ? productionOf.get(card.bookingId) : undefined) ??
      byTitle.get(titleKey(card.title));
    if (id && !result.has(id)) result.set(id, card);
  }
  return result;
}

/** Wie `index.ts` die Termine baut – ohne Netz und mit fester Uhr. */
function built() {
  const cards = matched();
  return buildEvents({
    sourceId: 'rcs',
    timeZone: TIME_ZONE,
    events: productions(),
    instances: october(),
    include: () => true,
    category: (event) => cards.get(event.id)?.genre ?? attribute(event, 'Discipline'),
    venue: () => 'Royal Conservatoire of Scotland',
    url: (event) => cards.get(event.id)?.url ?? LIST_URL,
    ticketUrl: (event, instance) => {
      const card = cards.get(event.id);
      const prefix = idPrefix(instance.id);
      return card && prefix ? `${card.url.replace(/\/?$/, '/')}book/${prefix}/` : undefined;
    },
    now: new Date('2026-09-04T09:00:00Z'),
  });
}

test('liest Karten und Blätterung der Übersicht', () => {
  const first = page1();
  assert.equal(first.recognised, true);
  assert.equal(first.pageCount, 5);
  assert.equal(first.cards.length, 20);
  assert.equal(page5().cards.length, 13);
});

test('jenseits der letzten Seite steht gar keine Liste mehr', () => {
  // Kein leerer Container, keine Blätterleiste – die Quelle liefert dort
  // nichts, was nach Übersicht aussieht. Der Adapter fragt solche Seiten gar
  // nicht erst an, er blättert nur bis `pageCount`.
  const beyond = parseEventList(fixture('liste-seite-6-ohne-liste.html'));
  assert.equal(beyond.cards.length, 0);
  assert.equal(beyond.recognised, false);
});

test('leeres und kaputtes HTML meldet sich als unerkannt', () => {
  for (const html of ['', '<html><body>Wartung</body></html>']) {
    assert.equal(parseEventList(html).recognised, false);
    assert.deepEqual(parseEventList(html).cards, []);
  }
});

test('liest eine Karte vollständig', () => {
  assert.deepEqual(page1().cards[0], {
    title: 'Blithe Spirit',
    url: 'https://www.rcs.ac.uk/whats-on/blithe-spirit/',
    genre: 'Drama',
    // Ein Lauf über mehrere Tage verweist auf seine Terminliste statt auf die
    // Kasse – deshalb keine Buchungsnummer.
    bookingId: undefined,
    soldOut: true,
  });

  const einzelabend = page1().cards[3];
  assert.equal(einzelabend.title, 'Peter and the Wolf with Lumas Winds and Lucy Drever');
  assert.equal(einzelabend.genre, 'Classical Music');
  assert.equal(einzelabend.bookingId, '669606');
  assert.equal(einzelabend.soldOut, false);

  // Genau die drei mehrtägigen Schauspielproduktionen tragen keine Nummer.
  assert.deepEqual(
    page1().cards.filter((card) => !card.bookingId).map((card) => card.title),
    ['Blithe Spirit', 'Travesties', 'Pomona'],
  );
});

test('ein leerer Zeitraum ist gültig, eine Antwort ohne Liste wirft', () => {
  assert.equal(productions().length, 93);
  assert.equal(october().length, 34);
  assert.deepEqual(parseInstances(fixture('instances-2020-01-leer.json')), []);
  assert.throws(() => parseEvents('<html>503</html>'), /kein JSON/);
  assert.throws(() => parseInstances('{"error":1}'), /keine Liste/);
});

test('ordnet die Karte über die Buchungsnummer zu, nicht über den Titel', () => {
  // Die Zifferngruppe der Vorstellungs-ID steht in der Buchungsadresse.
  assert.equal(idPrefix('652210ANBHBQCDMGTDLRVMTDGMRKCKCJPGH'), '652210');
  assert.equal(idPrefix('ohne-ziffern'), undefined);

  // "Erik Chisholm" heisst in der Kasse anders als auf der Website – über den
  // Titel allein wäre die Karte nicht zu finden.
  const chisholm = built().find((event) => event.title.includes('Erik Chisholm'));
  assert.ok(chisholm);
  assert.equal(
    chisholm.url,
    'https://www.rcs.ac.uk/whats-on/art-sung-erik-chisholm-a-scottish-modernist-with-a-highland-heart/',
  );
});

test('normalisiert einen Termin vollständig', () => {
  const event = built().find((e) => e.id === 'rcs:661606ASMNQVHPGVLBKRSJBDDLTSCHVJR');
  assert.ok(event);
  assert.equal(event.sourceId, 'rcs');
  assert.equal(event.title, 'Art Sung – Erik Chisholm: A Scottish Modernist with a Highland Heart');
  assert.equal(event.start, '2026-10-01T18:00:00+01:00');
  // Ende aus der Spieldauer der Produktion (75 Minuten).
  assert.equal(event.end, '2026-10-01T19:15:00+01:00');
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Royal Conservatoire of Scotland');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.category, 'Classical Music');
  // Die Kasse verkauft erst ab dem 7.9. – das weiss nur sie, die Website
  // zeigt daneben unbesehen einen Ticketknopf.
  assert.equal(event.availability, 'not_on_sale');
  assert.equal(event.availabilityLabel, 'Not yet on sale');
  assert.equal(
    event.ticketUrl,
    'https://www.rcs.ac.uk/whats-on/art-sung-erik-chisholm-a-scottish-modernist-with-a-highland-heart/book/661606/',
  );
});

test('übernimmt die Gattung im Wortlaut des Hauses', () => {
  const genres = new Set([...page1().cards, ...page5().cards].map((card) => card.genre));
  for (const genre of ['Drama', 'Classical Music', 'Jazz', 'Talk', 'Opera And Vocal']) {
    assert.equal(genres.has(genre), true, genre);
  }
  // Ohne Karte bleibt die grobe Sparte der Kasse.
  const ohneKarte = built().filter((event) => event.url === LIST_URL);
  assert.equal(
    ohneKarte.every((event) => event.category !== undefined),
    true,
  );
});

test('vergibt eindeutige IDs und Pflichtfelder', () => {
  const events = built();
  assert.equal(events.length, 34);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(event.title, event.id);
    assert.equal(event.venue.name, 'Royal Conservatoire of Scotland');
    assert.ok(event.url.startsWith('https://www.rcs.ac.uk/'), event.url);
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  }
});

test('rechnet über die Zeitumstellung hinweg richtig', () => {
  // Die britischen Uhren gehen am 25.10.2026 zurück.
  const events = built();
  const bst = events.filter((e) => e.start < '2026-10-25');
  const gmt = events.filter((e) => e.start >= '2026-10-26');
  assert.equal(bst.every((e) => e.start.endsWith('+01:00')), true);
  assert.equal(gmt.length > 0 && gmt.every((e) => e.start.endsWith('+00:00')), true);
});

test('erkennt einen ausverkauften Lauf an der Karte', () => {
  // Nur der tote Knopf zählt: "Tickets" steht auch an Terminen, deren
  // Verkauf laut Kasse erst in Tagen beginnt.
  const soldOut = [...page1().cards, ...page5().cards].filter((card) => card.soldOut);
  assert.deepEqual(soldOut.map((card) => card.title), ['Blithe Spirit', 'Pomona']);
});

test('holt den Programmtext von der Veranstaltungsseite', () => {
  // Die Kasse führt zu keiner der 93 Produktionen einen Text – bei allen ist
  // das Feld leer. Er steht nur im WordPress.
  assert.equal(
    productions().every((event) => !event.htmlDescription?.replace(/<[^>]+>|\s/g, '')),
    true,
    'Spektrix liefert hier keinen Programmtext',
  );

  const detail = parseDetail(fixture('detail-blithe-spirit.html'));
  assert.ok(detail);
  assert.match(detail.description ?? '', /Charles Condomine is a successful novelist/);
  assert.equal(detail.description?.includes('<'), false, 'ohne Auszeichnungen');
  // Besetzung und Kurzbiografien stehen in eigenen Blöcken und bleiben
  // draussen.
  assert.equal(detail.description?.includes('View full profile'), false);
  assert.deepEqual(detail.notes, ['Tickets: £5 – £17']);
});

test('leere und kaputte Detailseiten liefern nichts, werfen aber nicht', () => {
  assert.equal(parseDetail(''), undefined);
  assert.equal(parseDetail('<html><body>Wartung</body></html>'), undefined);
});
