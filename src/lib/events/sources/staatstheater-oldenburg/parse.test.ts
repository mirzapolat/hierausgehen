import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCalendarMonths, parseCalendarPage, parseDetailDescription } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const october = () => parseCalendarPage(fixture('monat-2026-10.html'));

test('liest jeden Monat einmal, obwohl die Seite jeden Tag doppelt rendert', () => {
  // Gegen die Website gezählt: 69 Einträge im Oktober, davon eine
  // geschlossene Veranstaltung und eine Vorstellung, die zweimal im selben
  // Slot steht.
  const oct = october();
  assert.equal(oct.events.length, 67);
  assert.equal(oct.excluded, 1);
  assert.equal(oct.skipped, 0);
  assert.equal(oct.empty, false);
  assert.equal(new Set(oct.events.map((event) => event.start.slice(0, 10))).size, 28);

  assert.equal(parseCalendarPage(fixture('kalender-2026-09.html')).events.length, 12);
  assert.equal(parseCalendarPage(fixture('monat-2027-01.html')).events.length, 52);
});

test('normalisiert eine Vorstellung vollständig', () => {
  const play = october().events.find((event) => event.id === 'staatstheater-oldenburg:20640');
  assert.deepEqual(play, {
    id: 'staatstheater-oldenburg:20640',
    sourceId: 'staatstheater-oldenburg',
    title: 'Bondi Beach',
    subtitle: undefined,
    description: 'Komödie von Rebekka Kricheldorf',
    category: 'Schauspiel',
    start: '2026-10-03T20:00:00+02:00',
    end: '2026-10-03T21:35:00+02:00',
    allDay: false,
    venue: { name: 'Kleines Haus' },
    availability: 'available',
    availabilityLabel: 'Karten',
    ticketUrl: 'https://tickets.staatstheater.de/eventim.webshop/webticket/shop?event=20640',
    url: 'https://staatstheater.de/programm/schauspiel/spielzeit-2526/bondi-beach',
    notes: undefined,
  });
});

test('bildet die Ticketlage aus Klasse und Text ab', () => {
  const { events } = october();
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.availability] = (acc[event.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { available: 48, limited: 5, soldout: 4, unknown: 10 });

  const rest = events.find((event) => event.id === 'staatstheater-oldenburg:20373');
  assert.equal(rest?.availability, 'limited');
  assert.equal(rest?.availabilityLabel, 'Restkarten');

  const soldout = events.find((event) => event.id === 'staatstheater-oldenburg:2026-10-07-1030-peggy-packer');
  assert.equal(soldout?.availability, 'soldout');
  assert.equal(soldout?.availabilityLabel, 'Derzeit ausverkauft');
  assert.equal(soldout?.ticketUrl, undefined);

  // Ohne Kartenverkauf (Anmeldung per Mail) bleibt die Lage offen.
  const signup = events.find((event) => event.id === 'staatstheater-oldenburg:2026-10-05-1000-babykonzerte');
  assert.equal(signup?.availability, 'unknown');
  assert.equal(signup?.venue.name, 'Stadtteiltreff Kreyenbrück');
});

test('legt eine doppelt geführte Vorstellung zusammen und behält den Verkauf', () => {
  const cabaret = october().events.filter(
    (event) => event.title === 'Cabaret' && event.start === '2026-10-11T18:00:00+02:00',
  );
  assert.equal(cabaret.length, 1);
  assert.equal(cabaret[0].id, 'staatstheater-oldenburg:20729');
  assert.equal(cabaret[0].availability, 'limited');
  assert.equal(cabaret[0].availabilityLabel, 'Nur noch Stehplätze');
});

test('nimmt geschlossene Veranstaltungen nicht auf', () => {
  assert.equal(
    october().events.some((event) => event.title.includes('Kulturfrühstück')),
    false,
  );
});

test('vergibt eindeutige IDs, auch ohne Eventim-Nummer', () => {
  const { events } = october();
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  const blood = events.find((event) => event.title.startsWith('Blutspende'));
  assert.equal(blood?.id, 'staatstheater-oldenburg:2026-10-19-1500-blutspende-des-deutschen-roten-kreuz');
  // Ohne eigene Seite verweist der Termin auf den Kalender.
  assert.equal(blood?.url, 'https://staatstheater.de/kalender');
});

test('liest die Sparte aus dem Pfad und Status als Hinweis', () => {
  const { events } = october();
  const genres = new Set(events.map((event) => event.category));
  for (const genre of ['Schauspiel', 'Musiktheater', 'Ballett', 'Konzert', 'Junges Staatstheater', 'Sparte 7']) {
    assert.ok(genres.has(genre), genre);
  }
  // Veranstaltungen ohne Spartenpfad fallen auf die Definition zurück.
  const soiree = events.find((event) => event.title === 'Soirée');
  assert.equal(soiree?.category, undefined);

  const premiere = events.find((event) => event.notes?.includes('Premiere'));
  assert.ok(premiere, 'eine Premiere trägt ihren Status als Hinweis');
});

test('erkennt den Monat ohne Vorstellungen als leer, nicht als kaputt', () => {
  assert.deepEqual(parseCalendarPage(fixture('leer-2026-08.html')), {
    events: [],
    skipped: 0,
    excluded: 0,
    empty: true,
  });
  assert.deepEqual(parseCalendarPage(''), { events: [], skipped: 0, excluded: 0, empty: false });
  assert.deepEqual(parseCalendarPage('<html><body><p>Wartung</p>'), {
    events: [],
    skipped: 0,
    excluded: 0,
    empty: false,
  });
});

test('liest die freigeschalteten Monate aus der Monatsleiste', () => {
  const months = parseCalendarMonths(fixture('monat-2026-10.html'));
  assert.deepEqual(months, [
    '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02',
    '2027-03', '2027-04', '2027-05', '2027-06', '2027-07',
  ]);
  // Die nächste Spielzeit steht unverlinkt in der Leiste und zählt nicht.
  assert.equal(parseCalendarMonths(fixture('kalender-2026-09.html')).includes('2027-08'), false);
  assert.deepEqual(parseCalendarMonths('<html></html>'), []);
});

test('liest den Programmtext der Produktionsseite ohne Pressestimmen', () => {
  const description = parseDetailDescription(fixture('detail-bondi-beach.html'));
  assert.match(description!, /^Zoe, Fiffy, Nico, Tristan und Dennis sind befreundet\./);
  assert.ok(!description!.includes('NWZ'));
  assert.equal(parseDetailDescription('<div class="beschreibung"><p>kurz</p></div>'), undefined);
});
