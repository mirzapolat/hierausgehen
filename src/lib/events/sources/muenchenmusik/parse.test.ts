import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CalendarEvent } from '../../types.ts';
import { parseDetailDescription, parseListPage } from './parse.ts';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, `__fixtures__/${name}`), 'utf8');

const page = (n: number) => parseListPage(fixture(`veranstaltungen-2026-11-seite-${n}.html`));

/** November 2026 so, wie der Adapter die drei Seiten aneinanderhängt. */
function november(): CalendarEvent[] {
  return [0, 1, 2].flatMap((n) => page(n).events);
}

const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[key(item)] = (acc[key(item)] ?? 0) + 1;
    return acc;
  }, {});

test('blaettert bis zur letzten Seite und liest jeden Termin einmal', () => {
  assert.deepEqual(
    [0, 1, 2].map((n) => {
      const result = page(n);
      return { blocks: result.blocks, skipped: result.skipped, next: result.hasNextPage };
    }),
    [
      { blocks: 10, skipped: 0, next: true },
      { blocks: 10, skipped: 0, next: true },
      { blocks: 3, skipped: 0, next: false },
    ],
  );

  const events = november();
  assert.equal(events.length, 23);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test('normalisiert einen Termin vollstaendig', () => {
  const langLang = november().find((event) => event.id === 'muenchenmusik:6983');

  assert.ok(langLang, 'Klavierabend von Lang Lang gefunden');
  assert.equal(langLang.title, 'Lang Lang');
  assert.equal(langLang.subtitle, 'Klavierabend');
  assert.equal(langLang.start, '2026-11-01T20:00:00+01:00');
  assert.equal(langLang.allDay, false);
  assert.equal(langLang.end, undefined);
  assert.equal(langLang.venue.name, 'Isarphilharmonie (Gasteig HP8)');
  assert.equal(langLang.venue.city, undefined);
  assert.equal(langLang.category, undefined);
  assert.equal(langLang.availability, 'available');
  assert.equal(
    langLang.ticketUrl,
    'https://www.virtuopolis.de/apivtsmm/servlet/shop?handler=warenkorb&op=redirect-veranst&veranst=6983',
  );
  assert.equal(langLang.url, 'https://www.muenchenmusik.de/mm/veranstaltungen/lang-lang-11126');
});

test('rechnet die UTC-Angabe der Liste in Muenchner Zeit um', () => {
  const events = november();

  // Die Liste schreibt "2026-11-01T19:00:00Z" und zeigt 20:00 – Winterzeit.
  assert.equal(events[0].start, '2026-11-01T20:00:00+01:00');
  assert.equal(
    events.every((event) => event.start.endsWith('+01:00')),
    true,
    'November liegt vollständig in der Winterzeit',
  );
});

test('setzt die Besetzungszeilen als Untertitel zusammen', () => {
  const avital = november().find((event) => event.id === 'muenchenmusik:6932');

  assert.equal(avital?.title, 'Avi Avital');
  assert.equal(
    avital?.subtitle,
    'Kammerorchester des Symphonieorchesters des Bayerischen Rundfunks · Radoslaw Szulc, Leitung',
  );
  // Der versteckte Vorverkaufs-Hinweis gehört nicht dazu.
  assert.equal(avital?.subtitle?.includes('Vorverkauf'), false);
});

test('meldet die Ticketlage nur so genau, wie die Quelle sie kennt', () => {
  const events = november();

  // Die Liste hat weder "ausverkauft" noch "Restkarten": jeder Termin trägt
  // einen aktiven Kaufen-Knopf.
  assert.deepEqual(countBy(events, (event) => event.availability), { available: 23 });
  assert.equal(events.every((event) => event.availabilityLabel === undefined), true);
  assert.equal(
    events.every((event) => event.ticketUrl?.startsWith('https://www.virtuopolis.de/')),
    true,
  );
});

test('haelt Spielstaette und Adresse der Quelle', () => {
  assert.deepEqual(countBy(november(), (event) => event.venue.name), {
    'Isarphilharmonie (Gasteig HP8)': 11,
    Prinzregententheater: 8,
    'Allerheiligen-Hofkirche': 3,
    Scholastika: 1,
  });

  // Relative Links werden absolut, Termine der Schwestermarke bleiben extern.
  const hosts = new Set(november().map((event) => new URL(event.url).host));
  assert.deepEqual([...hosts].sort(), ['www.muenchenevent.de', 'www.muenchenmusik.de']);
});

test('liefert Pflichtfelder fuer jeden Termin', () => {
  for (const event of november()) {
    assert.ok(event.title, 'Titel');
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.ok(event.venue.name, `Spielstätte für ${event.title}`);
    assert.match(event.url, /^https:\/\//);
    assert.match(event.id, /^muenchenmusik:\d+$/);
  }
});

test('liest die Werkliste der Produktionsseite als Programmtext', () => {
  const text = parseDetailDescription(fixture('detail-muenchner-symphoniker-81026.html'));

  assert.equal(
    text,
    [
      'Louise Bertin: Ouvertüre zu „Fausto“',
      'John Adams: „Doctor Atomic Symphony“',
      'Beethoven: Symphonie Nr. 1 C-Dur op. 21',
      'Dukas: „Der Zauberlehrling“',
    ].join('\n'),
  );
});

test('liest auch den Fliesstext der Schwestermarke', () => {
  const text = parseDetailDescription(fixture('detail-top-gun-maverick.html')) ?? '';

  assert.match(text, /^Joseph Kosinskis Blockbuster „Top Gun: Maverick“/);
  // Keine Abo-Anzeigen, keine Terminliste, keine Empfehlungen.
  assert.equal(/Mehr zum Abonnement|Weitere Veranstaltungsempfehlungen/.test(text), false);
});

test('erkennt den ausdruecklich leeren Zeitraum', () => {
  const leer = parseListPage(fixture('veranstaltungen-leer-2026-09.html'));

  assert.equal(leer.events.length, 0);
  assert.equal(leer.blocks, 0);
  assert.equal(leer.empty, true);
  assert.equal(leer.rendered, true);
  assert.equal(leer.hasNextPage, false);
});

test('meldet eine Seite ohne Pager als Layoutbruch', () => {
  const kaputt = parseListPage('<main><p>Die Seite konnte nicht geladen werden.</p></main>');

  assert.equal(kaputt.rendered, false);
  assert.equal(kaputt.empty, false);
  assert.equal(kaputt.blocks, 0);
});

test('leeres oder kaputtes HTML wirft nicht', () => {
  assert.deepEqual(parseListPage(''), {
    events: [],
    skipped: 0,
    empty: false,
    blocks: 0,
    rendered: false,
    hasNextPage: false,
  });
  assert.equal(parseDetailDescription(''), undefined);
  assert.equal(parseDetailDescription('<html><body><p>nichts</p></body></html>'), undefined);
});
