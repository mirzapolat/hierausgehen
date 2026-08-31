import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetailDescription, parseSchedulePage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const october = () => parseSchedulePage(fixture('spielplan-2026-10.html'), '2026-10');

test('liest alle Termine des Monats', () => {
  const { events, skipped, empty } = october();
  assert.equal(events.length, 63);
  assert.equal(skipped, 0);
  assert.equal(empty, false);
  // Die Monatsseite enthält ausschliesslich Tage dieses Monats.
  for (const event of events) assert.ok(event.start.startsWith('2026-10'), event.start);
});

test('normalisiert eine Premiere vollständig', () => {
  const { events } = october();
  const lolita = events.find((e) => e.id === 'residenztheater:8876');
  assert.ok(lolita, 'Bye Bye Lolita am 1.10. gefunden');
  assert.equal(lolita.title, 'Bye Bye Lolita');
  assert.match(lolita.subtitle!, /^nach dem gleichnamigen Roman von Lea Ruckpaul/);
  assert.match(lolita.description!, /^Vladimir Nabokovs Roman/);
  assert.match(lolita.description!, /Dolores Haze/);
  assert.equal(lolita.start, '2026-10-01T19:30:00+02:00');
  assert.equal(lolita.allDay, false);
  assert.equal(lolita.venue.name, 'Cuvilliéstheater');
  assert.equal(lolita.venue.city, undefined);
  assert.equal(lolita.availability, 'available');
  assert.equal(lolita.availabilityLabel, 'Karten');
  assert.match(lolita.ticketUrl!, /^https:\/\/tickets\.staatstheater\.bayern\/rth\.webshop\//);
  assert.equal(lolita.url, 'https://www.residenztheater.de/stuecke/detail/bye-bye-lolita');
  assert.match(lolita.icsUrl!, /^https:\/\/www\.residenztheater\.de\/calendarics\.ics\?/);
  assert.deepEqual(lolita.notes, ['Premiere', 'Uraufführung', 'Preise H: 21 bis 64 €']);
});

test('übernimmt die Endzeit, wenn die Quelle eine nennt', () => {
  const { events } = october();
  const mercury = events.find((e) => e.id === 'residenztheater:9104');
  assert.ok(mercury);
  assert.equal(mercury.start, '2026-10-03T19:00:00+02:00');
  assert.equal(mercury.end, '2026-10-03T20:45:00+02:00');
  // Der Zusatz hinter dem zweiten "|" ist ein Hinweis, keine Spielstätte.
  assert.equal(mercury.venue.name, 'Marstall');
  assert.ok(mercury.notes?.includes('Publikumsgespräch im Anschluss'));
});

test('erkennt Ausverkauftes am deaktivierten Knopf', () => {
  const { events } = october();
  const soldout = events.find((e) => e.id === 'residenztheater:9091');
  assert.ok(soldout);
  assert.equal(soldout.availability, 'soldout');
  assert.equal(soldout.availabilityLabel, 'Ausverkauft');
  assert.equal(soldout.ticketUrl, undefined, 'kein Kartenlink bei ausverkauft');
});

test('bildet alle Verfügbarkeitszustände ab', () => {
  const { events } = october();
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.availability] = (acc[e.availability] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { available: 55, soldout: 2, limited: 1, not_on_sale: 3, unknown: 2 });

  const september = parseSchedulePage(fixture('spielplan-2026-09.html'), '2026-09');
  assert.equal(september.events.filter((e) => e.availability === 'soldout').length, 4);
});

test('erfindet für Gastspiele keine Stadt', () => {
  const { events } = october();
  const gastspiel = events.find((e) => e.id === 'residenztheater:9113');
  assert.ok(gastspiel);
  assert.equal(gastspiel.venue.name, 'Gastspiel');
  assert.equal(gastspiel.venue.city, undefined);
  assert.equal(gastspiel.availability, 'unknown', 'kein Kartenverkauf über das Haus');
  assert.ok(gastspiel.notes?.some((n) => n.includes('Bozen')));
});

test('vergibt eindeutige IDs und gültige Zeitstempel', () => {
  const { events } = october();
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const event of events) {
    assert.ok(!Number.isNaN(Date.parse(event.start)), `${event.id} hat gültiges Datum`);
    assert.ok(event.title.length > 0);
    assert.ok(event.url.startsWith('https://'));
  }
});

test('leitet das Jahr aus dem angefragten Monat ab', () => {
  // Ein Januartermin auf einer Dezemberseite gehört ins Folgejahr.
  const html = `<div class="schedule"><article class="schedule-act">
    <h2 class="schedule-act__date">Fr. 22 Jan</h2>
    <div class="schedule-act__details">Residenztheater, 19.30 Uhr</div>
    <h3 class="schedule-act__title"><a href="/stuecke/detail/x">Testtermin</a></h3>
  </article></div>`;
  assert.equal(parseSchedulePage(html, '2026-12').events[0].start, '2027-01-22T19:30:00+01:00');
  assert.equal(parseSchedulePage(html, '2027-01').events[0].start, '2027-01-22T19:30:00+01:00');
});

test('liest langen Programmtext von der Stückseite', () => {
  const description = parseDetailDescription(`<main>
    <div class="component-container reduced-width">
      <p>Vladimir Nabokovs Roman war und ist einer der meistdiskutierten Texte des 20. Jahrhunderts.</p>
    </div>
    <div class="show-more__content">
      <p>Dies ist ein deutlich längerer Programmtext aus der Detailseite, der nicht nur die kurze Inhaltsangabe aus dem Spielplan wiederholt, sondern Kontext und Motive der Inszenierung genauer beschreibt.</p>
    </div>
    <footer><p>Newsletter Anmeldung und andere Seitentexte</p></footer>
  </main>`);

  assert.match(description!, /^Vladimir Nabokovs Roman/);
  assert.match(description!, /Kontext und Motive der Inszenierung/);
});

test('erkennt einen leeren Monat und meldet ihn nicht als Fehler', () => {
  const result = parseSchedulePage(fixture('spielplan-leer-2026-08.html'), '2026-08');
  assert.deepEqual(result, { events: [], skipped: 0, empty: true });
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  // Ohne Container ist "empty" bewusst false – das ist ein Layoutfehler.
  assert.deepEqual(parseSchedulePage('', '2026-10'), { events: [], skipped: 0, empty: false });
  assert.deepEqual(parseSchedulePage('<div class="schedule"><article class="schedule-act"></article></div>', '2026-10'), {
    events: [],
    skipped: 1,
    empty: true,
  });
});
