import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseDetailPage, parseListPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

/**
 * Die Fixtures wurden am 3.9.2026 geholt: Oktober 2026 hat 7 Ergebnisseiten
 * mit 83 Karten (6 × 12 + 11), Dezember 2029 ist noch leer.
 */
const first = () => parseListPage(fixture('liste-2026-10-seite-1.html'));
const last = () => parseListPage(fixture('liste-2026-10-seite-7.html'));

test('liest die Trefferliste und die Zahl der Seiten', () => {
  const page = first();
  assert.equal(page.recognised, true);
  assert.equal(page.pageCount, 7);
  assert.equal(page.skipped, 0);
  // 12 Karten, davon eine wöchentliche Reihe mit 23 Terminen.
  assert.equal(page.events.length, 34);

  const tail = last();
  assert.equal(tail.pageCount, 7);
  assert.equal(tail.skipped, 0);
  assert.equal(tail.events.length, 11);
});

test('normalisiert einen Einzeltermin vollständig', () => {
  const event = last().events.find((e) => e.title === 'Arlo Parks - Desire Tour');
  assert.ok(event, 'Arlo Parks am 24.10. gefunden');
  assert.equal(event.id, 'glasgowlife:2026-10-24-1900-arlo-parks-desire-tour');
  assert.equal(event.sourceId, 'glasgowlife');
  assert.equal(event.start, '2026-10-24T19:00:00+01:00');
  assert.equal(event.end, undefined);
  assert.equal(event.allDay, false);
  assert.equal(event.venue.name, 'Old Fruitmarket');
  assert.equal(event.venue.city, undefined);
  assert.equal(event.category, undefined, 'die Seite nennt keine Gattung');
  assert.equal(event.availability, 'unknown');
  assert.equal(event.ticketUrl, undefined);
  assert.equal(event.url, 'https://www.glasgowlife.org.uk/event/1/arlo-parks-desire-tour');
  assert.deepEqual(event.notes, ['Glasgow Life Tickets']);
});

test('rechnet die Sommerzeit richtig', () => {
  // Die britischen Uhren gehen am 25.10.2026 zurück: gleicher Wortlaut,
  // anderer Offset.
  const events = last().events;
  const bst = events.find((e) => e.title.startsWith('RSNO 2026/27: Brahms'));
  const gmt = events.find((e) => e.title === 'The Shamrocks');
  assert.equal(bst?.start, '2026-10-24T19:30:00+01:00');
  assert.equal(gmt?.start, '2026-10-25T19:30:00+00:00');
});

test('macht aus einem Lauf einen ganztägigen Termin mit Ende', () => {
  const event = first().events.find((e) => e.title === 'UK AIDS Memorial Quilt');
  assert.ok(event);
  assert.equal(event.allDay, true);
  assert.equal(event.start, '2026-09-12T00:00:00+01:00');
  assert.equal(event.end, '2026-10-04T23:59:00+01:00');
  // Die Laufzeit steckt in Beginn und Ende; als Zusatzinfo stünde sie doppelt.
  assert.deepEqual(event.notes, ['Tramway']);
});

test('erbt Monat und Jahr vom rechten Rand eines Laufs', () => {
  // "Friday 30th - Saturday 31st Oct 2026" – links steht nur der Tag.
  const event = last().events.find((e) => e.title.startsWith('Cade & MacAskill with Yas Clarke'));
  assert.ok(event);
  assert.equal(event.start, '2026-10-30T00:00:00+00:00');
  assert.equal(event.end, '2026-10-31T23:59:00+00:00');
});

test('rollt eine wöchentliche Reihe in Einzeltermine aus', () => {
  const series = first().events.filter((e) => e.title === 'Art for Baby at GoMA');
  // "Every week on Friday from 17th Jul 2026 until 19th Dec 2026" – 23 Freitage.
  assert.equal(series.length, 23);
  assert.equal(series[0].start.slice(0, 10), '2026-07-17');
  assert.equal(series.at(-1)?.start.slice(0, 10), '2026-12-18');
  assert.ok(series.every((e) => e.allDay), 'die Liste nennt für die Reihe keine Uhrzeit');
  assert.equal(new Set(series.map((e) => e.id)).size, 23);
});

test('vergibt eindeutige IDs über beide Seiten hinweg', () => {
  const events = [...first().events, ...last().events];
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.ok(events.every((e) => e.title && e.venue.name && e.url.startsWith('https://')));
});

test('die Liste selbst nennt keine Ticketlage', () => {
  const events = [...first().events, ...last().events];
  const states = new Set(events.map((e) => e.availability));
  assert.deepEqual([...states], ['unknown']);
});

test('ein Zeitraum ohne Treffer ist kein Fehler', () => {
  // Dezember 2029: die Seitenhülle steht, die Trefferliste fehlt ganz.
  const page = parseListPage(fixture('leer-2029-12.html'));
  assert.equal(page.recognised, true);
  assert.equal(page.pageCount, 1);
  assert.equal(page.events.length, 0);
  assert.equal(page.skipped, 0);
});

test('leeres und kaputtes HTML gilt als nicht erkannt', () => {
  for (const html of ['', '<html><body><p>Wartung</p></body></html>', '<div class="card">']) {
    const page = parseListPage(html);
    assert.equal(page.recognised, false);
    assert.equal(page.events.length, 0);
  }
});

test('nimmt die Gattung aus Programmschiene und Titel', () => {
  const events = [...first().events, ...last().events];
  const of = (title: string) => events.find((e) => e.title.startsWith(title))?.category;

  // Die Schiene: RSNO, SCO und BBC SSO sind Orchester.
  assert.equal(of('RSNO 2026/27: Shostakovich'), 'Concert');
  assert.equal(of('SCO 26/27: Barber'), 'Concert');
  assert.equal(of('BBC SSO 2026/27'), 'Concert');
  // Der Titel sagt es selbst.
  assert.equal(of('The Witcher in Concert'), 'Concert');
  assert.equal(of('KC Community Choir'), 'Concert');
  assert.equal(of('Exhibition : Sandy Moffat'), 'Exhibition');
  // Form vor Zielgruppe, Zielgruppe vor dem Allerweltswort Konzert.
  assert.equal(of("Children's Classic Concerts"), 'Family');
  // Wo nichts dasteht, wird nichts geraten – der Quellen-Fallback greift.
  assert.equal(of('Arlo Parks'), undefined);
  assert.equal(of('Hue and Cry'), undefined);
});

test('liest Preise, Ticketlink und Ticketlage von der Detailseite', () => {
  const detail = parseDetailPage(fixture('detail-david-essex.html'));
  assert.ok(detail);
  assert.equal(detail.availability, 'available');
  assert.equal(detail.availabilityLabel, 'Buy tickets now');
  assert.equal(detail.ticketUrl, 'https://tickets.glasgowlife.org.uk/39381/39382');
  assert.deepEqual(detail.notes, [
    'Tickets: £56.94, £40.70, VIP £115.50 (includes booking fee and restoration fund)',
  ]);
});

test('erkennt „ausverkauft" an der vorangestellten Zeile im Programmtext', () => {
  // Der Ticketkasten lässt den Kaufknopf stehen; das einzige Signal ist
  // "- Sold out -" als eigene Zeile am Anfang des Textes.
  const detail = parseDetailPage(fixture('detail-ausverkauft.html'));
  assert.ok(detail);
  assert.equal(detail.availability, 'soldout');
  assert.equal(detail.availabilityLabel, 'Sold out');
  assert.ok(detail.ticketUrl, 'der Kaufknopf steht trotzdem noch da');
});

test('„sold out" im Fliesstext ist kein Zustand', () => {
  // "He has consistently sold out concert halls" ist eine Biografie.
  const detail = parseDetailPage(fixture('detail-david-essex.html'));
  assert.equal(detail?.availability, 'available');
  const text = parseDetailDescription(fixture('detail-ausverkauft.html'));
  assert.ok(text?.toLowerCase().includes('sold out'));
});

test('ohne Kaufknopf verkauft die Seite nicht', () => {
  const detail = parseDetailPage(fixture('detail-ohne-verkauf.html'));
  assert.ok(detail);
  assert.equal(detail.availability, 'not_on_sale');
  assert.equal(detail.availabilityLabel, 'Free - Drop-in - no ticket required');
  assert.equal(detail.ticketUrl, undefined);
  assert.deepEqual(detail.notes, ['Tickets: Free - Drop-in - no ticket required']);
});

test('„Check venue opening times" heisst Ausstellung', () => {
  // Der Kasten „Dates and times" unterscheidet im selben Haus die Ausstellung
  // vom Gastspiel – genauer als jede Tabelle von Spielstätten.
  const detail = parseDetailPage(fixture('detail-ohne-verkauf.html'));
  assert.equal(detail?.category, 'Exhibition');
  assert.equal(detail?.startTime, undefined);
});

test('„Doors: 7pm" ist ein Konzert', () => {
  // Die Einlasszeit schreibt die Quelle nur zu Auftritten – und trifft damit
  // genau die Popkonzerte, deren Titel nur der Künstlername ist.
  assert.equal(parseDetailPage(fixture('detail-konzert-doors.html'))?.category, 'Concert');
  // Nicht am blossen Wort: `.text()` klebt Blockelemente aneinander
  // ("…Concert HallDoors: 7pm"), geprüft wird die aufbereitete Fassung.
  assert.ok(parseDetailDescription(fixture('detail-konzert-doors.html'))?.includes('Doors: 7pm'));
  assert.equal(parseDetailPage(fixture('detail-ohne-verkauf.html'))?.category, 'Exhibition');
});

test('holt die Uhrzeit nach, die die Liste verschweigt', () => {
  // Die Karte nennt für „An Evening with …" nur den Tag, die Detailseite 7:30pm.
  assert.equal(parseDetailPage(fixture('detail-ausverkauft.html'))?.startTime, '19:30');
  assert.equal(parseDetailPage(fixture('detail-david-essex.html'))?.startTime, '19:00');
});

test('eine Seite ohne Ticketkasten und ohne Text ergibt nichts', () => {
  assert.equal(parseDetailPage('<html><body><p>Wartung</p></body></html>'), undefined);
});

test('nimmt von der Detailseite den Ankündigungstext', () => {
  const text = parseDetailDescription(fixture('detail-david-essex.html'));
  assert.ok(text, 'Ankündigungstext gefunden');
  assert.ok(text.startsWith('David Essex Thanks for the Memories'));
  assert.ok(text.includes('Singer, composer and actor David Essex OBE'));
  // Die Aufklappkästen zu Anfahrt und Barrierefreiheit gehören nicht dazu.
  assert.ok(!text.includes('Accessibility guides'));
  assert.equal(parseDetailDescription('<html><body></body></html>'), undefined);
});
